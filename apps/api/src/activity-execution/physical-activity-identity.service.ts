import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { compareObservations, IdentityComparison, ObservedActivity, observerKeyOf } from './physical-activity-identity';

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
  providerMetrics: Prisma.JsonValue | null;
  physicalEventId: string | null;
  physicalIdentityStatus: string | null;
};

const SELECT = {
  id: true, userId: true, provider: true, sport: true, startedAt: true, durationSec: true, distanceMeters: true,
  providerMetrics: true, physicalEventId: true, physicalIdentityStatus: true,
} as const;

function toObserved(row: Row): ObservedActivity {
  const endedAtRaw = (row.providerMetrics as { endedAt?: unknown } | null)?.endedAt;
  const endedAt = typeof endedAtRaw === 'string' && !Number.isNaN(new Date(endedAtRaw).getTime()) ? new Date(endedAtRaw) : null;
  return {
    id: row.id, userId: row.userId, provider: row.provider, sport: row.sport, startedAt: row.startedAt,
    durationSec: row.durationSec, distanceMeters: row.distanceMeters, endedAt, observerKey: observerKeyOf(row.provider, row.providerMetrics),
  };
}

// uuid deterministico (v5-like) a partir do menor id de ActivityLog do grupo — so' para grupos NOVOS; grupos existentes mantem seu id.
function deterministicEventId(minMemberId: string): string {
  const hex = createHash('sha1').update(`physical-event:${minMemberId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Agrupamento persistente e idempotente de ActivityLog que sao observacoes do MESMO evento fisico (Apple Etapa 2).
//  - NUNCA apaga, funde ou reescreve ActivityLog/RawExternalActivity: so' preenche physicalEventId/Status/Evidence.
//  - DETERMINISMO (correcao 06/10/2026): o estado de identidade de um conjunto de observacoes e' uma FUNCAO PURA desse conjunto, nao
//    da ordem de chegada. Cada avaliacao recomputa, a partir de todas as observacoes do cluster (alvo + vizinhas 'same'/'ambiguous' +
//    membros de grupos ja' gravados que se tocam), os componentes conexos por veredito 'same'; componente com dois registros do mesmo
//    observador e' contestado e fica inteiro 'ambiguous' (inclusive desfazendo um grupo antigo que o novo registro contesta).
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

      const mine = desired.get(target.id)!;
      return { activityLogId, status: mine.status, physicalEventId: mine.groupId, memberCount: mine.status === 'matched' ? mine.size : 0 };
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
