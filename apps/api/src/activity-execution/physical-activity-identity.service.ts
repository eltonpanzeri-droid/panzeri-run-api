import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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

function summarize(row: Row, comparison: IdentityComparison) {
  return { activityLogId: row.id, provider: row.provider, verdict: comparison.verdict, reason: comparison.reason, criteria: comparison.evidence };
}

// Agrupamento persistente e idempotente de ActivityLog que sao observacoes do MESMO evento fisico (Apple Etapa 2).
//  - NUNCA apaga, funde ou reescreve ActivityLog/RawExternalActivity: so' preenche physicalEventId/Status/Evidence.
//  - Independe da ORDEM de chegada: toda nova observacao e' comparada contra TODAS as existentes da janela, e o grupo resultante
//    e' o mesmo particionamento seja qual for a ordem (grupos ja' formados que passam a se tocar sao unidos).
//  - Nao toca executionClassification, SessionExecutionLink nem nenhum consumidor (Training Intelligence, evolucao, aderencia).
//  - Avaliacoes do mesmo usuario sao serializadas por advisory lock transacional (duas ingestoes simultaneas nao criam dois grupos).
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
      const targetObserved = toObserved(target);

      const candidates = (await tx.activityLog.findMany({
        where: {
          userId: target.userId,
          id: { not: target.id },
          startedAt: { gte: new Date(target.startedAt.getTime() - CANDIDATE_WINDOW_MS), lte: new Date(target.startedAt.getTime() + CANDIDATE_WINDOW_MS) },
        },
        select: SELECT,
      })) as Row[];

      const comparisons = candidates.map((row) => ({ row, comparison: compareObservations(targetObserved, toObserved(row)) }));
      const same = comparisons.filter((c) => c.comparison.verdict === 'same');
      const ambiguous = comparisons.filter((c) => c.comparison.verdict === 'ambiguous');
      const now = new Date();

      if (same.length > 0) {
        // Membros do grupo resultante: o alvo, os candidatos 'same' e TODOS os membros dos grupos desses candidatos / do alvo.
        const groupIds = new Set<string>();
        if (target.physicalEventId) groupIds.add(target.physicalEventId);
        for (const { row } of same) if (row.physicalEventId) groupIds.add(row.physicalEventId);
        const members = new Map<string, Row>([[target.id, target]]);
        for (const { row } of same) members.set(row.id, row);
        if (groupIds.size > 0) {
          const groupRows = (await tx.activityLog.findMany({ where: { userId: target.userId, physicalEventId: { in: [...groupIds] } }, select: SELECT })) as Row[];
          for (const row of groupRows) members.set(row.id, row);
        }

        // Dois membros com o MESMO observador nao podem ser o mesmo evento: o grupo seria incoerente -> ambiguo, nao une.
        const observers = new Set<string>();
        let conflict = false;
        // Rival do mesmo observador: se uma contraparte 'same' tambem casa com OUTRO registro do mesmo observador do alvo, nao ha como
        // saber qual e' o evento (ex.: duas corridas seguidas do mesmo provider x um registro do HealthKit) -> ambiguo, simetrico
        // para todos os envolvidos, seja qual for a ordem em que foram avaliados.
        for (const { row } of same) {
          const counterpart = toObserved(row);
          const hasRival = candidates.some((other) => other.id !== row.id && observerKeyOf(other.provider, other.providerMetrics) === targetObserved.observerKey && compareObservations(counterpart, toObserved(other)).verdict === 'same');
          if (hasRival) { conflict = true; break; }
        }
        for (const row of members.values()) {
          if (conflict) break;
          const key = observerKeyOf(row.provider, row.providerMetrics);
          if (observers.has(key)) { conflict = true; break; }
          observers.add(key);
        }

        if (!conflict) {
          const physicalEventId = [...groupIds].sort()[0] ?? randomUUID();
          const evidence = { version: 1, evaluatedAt: now.toISOString(), comparisons: [...same, ...ambiguous].map((c) => summarize(c.row, c.comparison)) };
          for (const row of members.values()) {
            const isTarget = row.id === target.id;
            if (!isTarget && row.physicalEventId === physicalEventId && row.physicalIdentityStatus === 'matched') continue;
            await tx.activityLog.update({
              where: { id: row.id },
              data: {
                physicalEventId,
                physicalIdentityStatus: 'matched',
                ...(isTarget ? { physicalIdentityEvidence: evidence as unknown as Prisma.InputJsonValue, physicalIdentityEvaluatedAt: now } : {}),
              },
            });
          }
          return { activityLogId, status: 'matched' as const, physicalEventId, memberCount: members.size };
        }
        ambiguous.push(...same);
      }

      // Ja' pertence a um grupo: nunca desagrupa automaticamente (so' registra a reavaliacao).
      if (target.physicalEventId) {
        return { activityLogId, status: 'matched' as const, physicalEventId: target.physicalEventId, memberCount: 0 };
      }

      if (ambiguous.length > 0) {
        const evidence = { version: 1, evaluatedAt: now.toISOString(), comparisons: ambiguous.map((c) => summarize(c.row, c.comparison)) };
        await tx.activityLog.update({ where: { id: target.id }, data: { physicalIdentityStatus: 'ambiguous', physicalIdentityEvidence: evidence as unknown as Prisma.InputJsonValue, physicalIdentityEvaluatedAt: now } });
        // Simetria (independe da ordem): quem ainda nao tem contraparte e' marcado ambiguo tambem, sem tocar em grupos ja' formados.
        for (const { row, comparison } of ambiguous) {
          if (row.physicalEventId || row.physicalIdentityStatus === 'matched') continue;
          const reverseEvidence = { version: 1, evaluatedAt: now.toISOString(), comparisons: [{ activityLogId: target.id, provider: target.provider, verdict: comparison.verdict, reason: comparison.reason, criteria: comparison.evidence }] };
          await tx.activityLog.update({ where: { id: row.id }, data: { physicalIdentityStatus: 'ambiguous', physicalIdentityEvidence: reverseEvidence as unknown as Prisma.InputJsonValue, physicalIdentityEvaluatedAt: now } });
        }
        return { activityLogId, status: 'ambiguous' as const, physicalEventId: null, memberCount: 0 };
      }

      await tx.activityLog.update({ where: { id: target.id }, data: { physicalIdentityStatus: 'unique', physicalIdentityEvidence: { version: 1, evaluatedAt: now.toISOString(), comparisons: [] } as unknown as Prisma.InputJsonValue, physicalIdentityEvaluatedAt: now } });
      return { activityLogId, status: 'unique' as const, physicalEventId: null, memberCount: 0 };
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
    // Estado FINAL (grupos podem ter sido unidos durante o lote): conta eventos pelo que esta gravado agora.
    const grouped = await this.prisma.activityLog.findMany({ where: { userId, physicalEventId: { not: null } }, select: { physicalEventId: true } });
    return {
      evaluated: results.length,
      matchedEvents: new Set(grouped.map((row) => row.physicalEventId)).size,
      ambiguous: results.filter((r) => r.status === 'ambiguous').length,
      unique: results.filter((r) => r.status === 'unique').length,
    };
  }
}
