import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { compareObservations, IdentityComparison, ObservedActivity, observerKeyOf } from './physical-activity-identity';
import { CanonicalCandidateInput, selectCanonicalObservation } from './physical-canonical';
import { resolvePrimarySource } from './athlete-primary-source';

// Janela de busca de candidatos (so' performance — quem decide e' compareObservations; a janela larga tolera diferenca de fuso).
const CANDIDATE_WINDOW_MS = 12 * 60 * 60 * 1000;
const MAX_HISTORY_BATCH = 1000;

export type PhysicalIdentityStatus = 'unique' | 'matched' | 'ambiguous';

export interface PhysicalIdentityResult {
  activityLogId: string;
  status: PhysicalIdentityStatus;
  physicalEventId: string | null;
  memberCount: number;
}

type Row = {
  id: string;
  userId: string;
  provider: string;
  sport: string | null;
  startedAt: Date;
  durationSec: number | null;
  distanceMeters: number | null;
  caloriesKcal: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  cadenceAvg: number | null;
  powerAvgWatts: number | null;
  elevationGainMeters: number | null;
  hasRoute: boolean | null;
  providerMetrics: Prisma.JsonValue | null;
  physicalEventId: string | null;
  physicalIdentityStatus: string | null;
  physicalCanonicalActivityLogId: string | null;
  physicalCanonicalReason: Prisma.JsonValue | null;
};

const SELECT = {
  id: true, userId: true, provider: true, sport: true, startedAt: true, durationSec: true, distanceMeters: true,
  caloriesKcal: true, avgHeartRateBpm: true, maxHeartRateBpm: true, cadenceAvg: true, powerAvgWatts: true, elevationGainMeters: true, hasRoute: true,
  providerMetrics: true, physicalEventId: true, physicalIdentityStatus: true, physicalCanonicalActivityLogId: true, physicalCanonicalReason: true,
} as const;

function toObserved(row: Row): ObservedActivity {
  const endedAtRaw = (row.providerMetrics as { endedAt?: unknown } | null)?.endedAt;
  const endedAt = typeof endedAtRaw === 'string' && !Number.isNaN(new Date(endedAtRaw).getTime()) ? new Date(endedAtRaw) : null;
  return {
    id: row.id, userId: row.userId, provider: row.provider, sport: row.sport, startedAt: row.startedAt,
    durationSec: row.durationSec, distanceMeters: row.distanceMeters, endedAt, observerKey: observerKeyOf(row.provider, row.providerMetrics),
  };
}

function toCandidate(row: Row): CanonicalCandidateInput {
  return {
    id: row.id, provider: row.provider, providerMetrics: row.providerMetrics, durationSec: row.durationSec, distanceMeters: row.distanceMeters,
    caloriesKcal: row.caloriesKcal, avgHeartRateBpm: row.avgHeartRateBpm, maxHeartRateBpm: row.maxHeartRateBpm, cadenceAvg: row.cadenceAvg,
    powerAvgWatts: row.powerAvgWatts, elevationGainMeters: row.elevationGainMeters, hasRoute: row.hasRoute,
  };
}

// uuid deterministico (v5-like) a partir do menor id de ActivityLog do grupo — so' para grupos NOVOS; grupos existentes mantem seu id.
function deterministicEventId(minMemberId: string): string {
  const hex = createHash('sha1').update(`physical-event:${minMemberId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Agrupamento persistente e idempotente de ActivityLog que sao observacoes do MESMO evento fisico (Apple Etapa 2) + selecao da
// observacao canonica de cada evento (Etapa 3A).
//  - NUNCA apaga, funde ou reescreve ActivityLog/RawExternalActivity: so' preenche as colunas physical*. A canonica e' uma observacao REAL
//    e nenhuma metrica de outro provider e' copiada para ela.
//  - DETERMINISMO: identidade e canonica sao FUNCOES PURAS do conjunto de observacoes (e do primario vigente na data do evento), nao da
//    ordem de chegada. Cada avaliacao recomputa o cluster (alvo + vizinhas 'same'/'ambiguous' + membros de grupos gravados que se tocam),
//    os componentes conexos por 'same', e componente com dois registros do mesmo observador e' contestado e fica 'ambiguous'.
//  - Nao toca executionClassification, SessionExecutionLink nem nenhum consumidor (Training Intelligence, evolucao, aderencia).
//  - Avaliacoes do mesmo usuario sao serializadas por advisory lock transacional.
@Injectable()
export class PhysicalActivityIdentityService {
  private readonly logger = new Logger(PhysicalActivityIdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async evaluate(activityLogId: string): Promise<PhysicalIdentityResult | null> {
    const first = await this.prisma.activityLog.findUnique({ where: { id: activityLogId }, select: { userId: true } });
    if (!first) return null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'physical-identity:' + first.userId}))`;
      const target = (await tx.activityLog.findUnique({ where: { id: activityLogId }, select: SELECT })) as Row | null;
      if (!target) return null;

      const windowRows = (await tx.activityLog.findMany({
        where: {
          userId: target.userId,
          startedAt: { gte: new Date(target.startedAt.getTime() - CANDIDATE_WINDOW_MS), lte: new Date(target.startedAt.getTime() + CANDIDATE_WINDOW_MS) },
        },
        select: SELECT,
      })) as Row[];
      const rows = new Map<string, Row>(windowRows.map((r) => [r.id, r]));
      rows.set(target.id, target);

      // Membros de grupos ja' gravados que tocam a janela mas ficaram fora dela (raro): entram para nunca deixar grupo velho pela metade.
      const groupIdsInWindow = [...new Set([...rows.values()].map((r) => r.physicalEventId).filter((g): g is string => Boolean(g)))];
      if (groupIdsInWindow.length > 0) {
        const extra = (await tx.activityLog.findMany({ where: { userId: target.userId, physicalEventId: { in: groupIdsInWindow } }, select: SELECT })) as Row[];
        for (const row of extra) if (!rows.has(row.id)) rows.set(row.id, row);
      }

      // Comparacoes par a par (n pequeno: so' o mesmo usuario na mesma janela).
      const observed = new Map([...rows.values()].map((r) => [r.id, toObserved(r)]));
      const ids = [...rows.keys()].sort();
      const verdicts = new Map<string, IdentityComparison>();
      const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) verdicts.set(key(ids[i], ids[j]), compareObservations(observed.get(ids[i])!, observed.get(ids[j])!));
      }
      const verdictOf = (a: string, b: string) => verdicts.get(key(a, b))!;
      const related = (id: string) => ids.filter((other) => other !== id && verdictOf(id, other).verdict !== 'distinct');

      // Cluster do alvo: fecho transitivo por vereditos 'same'/'ambiguous' + membros do mesmo grupo ja' gravado.
      const cluster = new Set<string>([target.id]);
      const queue = [target.id];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const next = related(current);
        const currentGroup = rows.get(current)!.physicalEventId;
        if (currentGroup) for (const row of rows.values()) if (row.physicalEventId === currentGroup) next.push(row.id);
        for (const id of next) if (!cluster.has(id)) { cluster.add(id); queue.push(id); }
      }

      // Componentes conexos por 'same' dentro do cluster (union-find, raiz = menor id).
      const clusterIds = [...cluster].sort();
      const parent = new Map(clusterIds.map((id) => [id, id]));
      const find = (id: string): string => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; return root; };
      for (let i = 0; i < clusterIds.length; i++) {
        for (let j = i + 1; j < clusterIds.length; j++) {
          if (verdictOf(clusterIds[i], clusterIds[j]).verdict === 'same') {
            const a = find(clusterIds[i]);
            const b = find(clusterIds[j]);
            if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
          }
        }
      }
      const components = new Map<string, string[]>();
      for (const id of clusterIds) {
        const root = find(id);
        components.set(root, [...(components.get(root) ?? []), id]);
      }

      // Estado desejado de cada membro do cluster (funcao pura do conjunto de observacoes).
      const desired = new Map<string, { status: PhysicalIdentityStatus; groupId: string | null; size: number }>();
      const claimedGroupIds = new Set<string>();
      for (const members of [...components.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (members.length >= 2) {
          const observers = members.map((id) => observed.get(id)!.observerKey);
          const contested = new Set(observers).size !== observers.length;
          if (contested) {
            for (const id of members) desired.set(id, { status: 'ambiguous', groupId: null, size: members.length });
            continue;
          }
          const existing = members
            .map((id) => rows.get(id)!.physicalEventId)
            .filter((g): g is string => g !== null && !claimedGroupIds.has(g))
            .sort()[0];
          const groupId = existing ?? deterministicEventId(members[0]);
          claimedGroupIds.add(groupId);
          for (const id of members) desired.set(id, { status: 'matched', groupId, size: members.length });
        } else {
          const id = members[0];
          const hasAmbiguousEdge = related(id).some((other) => verdictOf(id, other).verdict === 'ambiguous');
          desired.set(id, { status: hasAmbiguousEdge ? 'ambiguous' : 'unique', groupId: null, size: 1 });
        }
      }

      // Grava so' o que mudou (o alvo sempre atualiza evidencia/horario da avaliacao).
      const now = new Date();
      for (const id of clusterIds) {
        const row = rows.get(id)!;
        const want = desired.get(id)!;
        const isTarget = id === target.id;
        if (!isTarget && row.physicalEventId === want.groupId && row.physicalIdentityStatus === want.status) continue;
        const comparisons = related(id).map((other) => ({
          activityLogId: other, provider: rows.get(other)!.provider, verdict: verdictOf(id, other).verdict, reason: verdictOf(id, other).reason, criteria: verdictOf(id, other).evidence,
        }));
        await tx.activityLog.update({
          where: { id },
          data: {
            physicalEventId: want.groupId,
            physicalIdentityStatus: want.status,
            physicalIdentityEvidence: { version: 1, evaluatedAt: now.toISOString(), comparisons } as unknown as Prisma.InputJsonValue,
            physicalIdentityEvaluatedAt: now,
          },
        });
      }

      // Observacao canonica de cada evento do cluster (3A) — sobre o estado de identidade recem-decidido.
      const byGroup = new Map<string, Row[]>();
      const singles: Row[] = [];
      const withoutIdentity: Row[] = [];
      for (const id of clusterIds) {
        const want = desired.get(id)!;
        const row = rows.get(id)!;
        if (want.status === 'matched' && want.groupId) byGroup.set(want.groupId, [...(byGroup.get(want.groupId) ?? []), row]);
        else if (want.status === 'unique') singles.push(row);
        else withoutIdentity.push(row);
      }
      await this.applyCanonical(tx, target.userId, [...byGroup.values()], singles, withoutIdentity);

      const mine = desired.get(target.id)!;
      return { activityLogId, status: mine.status, physicalEventId: mine.groupId, memberCount: mine.status === 'matched' ? mine.size : 0 };
    });
  }

  // Escolhe e grava a canonica de cada evento. Idempotente: so' escreve quando a canonica ou o motivo mudam. 'ambiguous' / sem identidade
  // ficam sem canonica (null) — ainda nao ha um evento fisico para representar.
  private async applyCanonical(tx: Prisma.TransactionClient, userId: string, groups: Row[][], singles: Row[], withoutIdentity: Row[]) {
    const write = async (row: Row, canonicalId: string | null, reason: unknown) => {
      const same = row.physicalCanonicalActivityLogId === canonicalId && JSON.stringify(row.physicalCanonicalReason ?? null) === JSON.stringify(reason ?? null);
      if (same) return;
      await tx.activityLog.update({
        where: { id: row.id },
        data: { physicalCanonicalActivityLogId: canonicalId, physicalCanonicalReason: (reason === null ? Prisma.JsonNull : (reason as Prisma.InputJsonValue)) },
      });
    };
    for (const members of [...groups, ...singles.map((row) => [row])]) {
      // Fonte primaria vigente NA DATA DO EVENTO (inicio mais antigo entre as observacoes), nao a preferencia de hoje.
      const eventTime = new Date(Math.min(...members.map((m) => m.startedAt.getTime())));
      const primary = await resolvePrimarySource(tx, userId, eventTime);
      const selection = selectCanonicalObservation(members.map(toCandidate), primary);
      if (!selection) continue;
      const reason = JSON.parse(JSON.stringify(selection.reason));
      for (const row of members) await write(row, selection.canonicalId, reason);
    }
    for (const row of withoutIdentity) await write(row, null, null);
  }

  // Muda o ecossistema primario do atleta A PARTIR de uma data (padrao: agora) e recalcula as canonicas. Eventos anteriores a effectiveFrom
  // continuam resolvidos pelo periodo anterior — trocar de relogio nao reescreve a historia.
  async setPrimarySource(userId: string, provider: string, options: { effectiveFrom?: Date; origin: 'coach' | 'athlete'; note?: string }) {
    const effectiveFrom = options.effectiveFrom ?? new Date();
    const created = await this.prisma.athletePrimarySource.create({
      data: { userId, provider, effectiveFrom, origin: options.origin, note: options.note ?? null },
      select: { id: true, provider: true, effectiveFrom: true },
    });
    const recomputed = await this.recomputeCanonicalForUser(userId);
    return { ...created, recomputed };
  }

  // Recalcula a observacao canonica de TODOS os eventos ja' avaliados do aluno (idempotente; nunca altera identidade nem observacoes).
  async recomputeCanonicalForUser(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'physical-identity:' + userId}))`;
      const logs = (await tx.activityLog.findMany({ where: { userId, physicalIdentityStatus: { in: ['matched', 'unique'] } }, select: SELECT, take: MAX_HISTORY_BATCH })) as Row[];
      const byGroup = new Map<string, Row[]>();
      const singles: Row[] = [];
      for (const row of logs) {
        if (row.physicalIdentityStatus === 'matched' && row.physicalEventId) byGroup.set(row.physicalEventId, [...(byGroup.get(row.physicalEventId) ?? []), row]);
        else singles.push(row);
      }
      await this.applyCanonical(tx, userId, [...byGroup.values()], singles, []);
      return { events: byGroup.size + singles.length };
    });
  }

  // Best-effort para os adapters de ingestao: falha de identidade NUNCA derruba a ingestao.
  async evaluateSafely(activityLogId: string): Promise<void> {
    try {
      await this.evaluate(activityLogId);
    } catch (error) {
      this.logger.warn(`Falha ao avaliar identidade fisica da atividade ${activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Backfill sob demanda do historico de UM aluno (nao ha migration de dados nem processamento massivo automatico).
  async evaluateUserHistory(userId: string) {
    const logs = await this.prisma.activityLog.findMany({ where: { userId }, orderBy: { startedAt: 'asc' }, select: { id: true }, take: MAX_HISTORY_BATCH });
    const results: PhysicalIdentityResult[] = [];
    for (const log of logs) {
      const result = await this.evaluate(log.id);
      if (result) results.push(result);
    }
    // Estado FINAL (grupos podem ter sido unidos/desfeitos durante o lote): conta eventos pelo que esta gravado agora.
    const grouped = await this.prisma.activityLog.findMany({ where: { userId, physicalEventId: { not: null } }, select: { physicalEventId: true } });
    return {
      evaluated: results.length,
      matchedEvents: new Set(grouped.map((row) => row.physicalEventId)).size,
      ambiguous: results.filter((r) => r.status === 'ambiguous').length,
      unique: results.filter((r) => r.status === 'unique').length,
    };
  }
}
