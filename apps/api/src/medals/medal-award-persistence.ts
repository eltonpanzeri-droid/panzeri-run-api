import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AwardAction } from './medal-award-decision';
import { isAwardRevoked, VOLUME_CATEGORIES, withVolumeReconciliation } from './volume-reconciliation';

// Persistencia TRANSACIONAL das decisoes sobre concessoes (15/10/2026). Aplica as acoes de planAwardReevaluation (e as concessoes/reativacoes dos gatilhos
// comuns) gravando, na MESMA transacao e sob trava por aluno, o novo estado E a transicao correspondente (append-only: granted | revoked | reactivated |
// adjusted, com motivo, causa, antes/depois e versao da regra). Nada e' apagado; reativar atualiza a MESMA linha (sem duplicar) e preserva unlockedAt.
// Compatibilidade: nas categorias de volume o marcador antigo (evidence._volumeReconciliation) continua ESPELHADO junto da coluna status, para o codigo
// anterior e a CLI de reconciliacao seguirem coerentes durante a transicao.

const VOLUME = new Set<string>(VOLUME_CATEGORIES);

export interface CatalogRef { id: string; code: string; ruleVersion: number }

export interface ApplyContext {
  // O que originou a avaliacao: gatilho comum ('workout_completed', 'week_closed'...) ou correcao ('link_correction', 'session_edit', 'identity_correction'...).
  trigger: string;
  cause: Record<string, unknown> | null;
  now?: Date;
}

export interface ApplyResult {
  granted: string[];
  reactivated: string[];
  revoked: string[];
  adjusted: string[];
  // Decisoes que NAO viraram escrita (incerteza, versao, fora do escopo, ausencia de dado): ficam so' no log do chamador.
  reviews: Array<{ code: string; reason: string; wouldRevoke?: boolean }>;
  // Concessoes que mudaram entre o planejamento e a escrita (nada foi aplicado para elas): a reavaliacao precisa rodar de novo.
  conflicts: string[];
}

type AwardRow = {
  id: string; userId?: string; status?: string | null; value: number | null; periodStart: Date | null; periodEnd: Date | null; modality?: string | null;
  evidence: Prisma.JsonValue; ruleVersionAtUnlock?: number;
};

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const snapshot = (row: AwardRow) => ({ status: isAwardRevoked({ evidence: row.evidence, status: row.status }) ? 'revoked' : 'active', value: row.value, periodStart: iso(row.periodStart), periodEnd: iso(row.periodEnd), evidence: row.evidence });
const sameState = (a: AwardRow, b: AwardRow) =>
  a.value === b.value && iso(a.periodStart) === iso(b.periodStart) && iso(a.periodEnd) === iso(b.periodEnd) && JSON.stringify(a.evidence) === JSON.stringify(b.evidence);
const original = (row: AwardRow) => ({ value: row.value, periodStart: row.periodStart, periodEnd: row.periodEnd, evidence: row.evidence });

async function withUserLock<T>(prisma: PrismaService, userId: string, work: (db: PrismaService) => Promise<T>): Promise<T> {
  if (typeof (prisma as { $transaction?: unknown }).$transaction !== 'function') return work(prisma);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'medals:' + userId}))`;
    return work(tx as unknown as PrismaService);
  }, { timeout: 30_000 });
}

export async function applyAwardActions(prisma: PrismaService, userId: string, actions: AwardAction[], catalog: CatalogRef[], context: ApplyContext): Promise<ApplyResult> {
  const result: ApplyResult = { granted: [], reactivated: [], revoked: [], adjusted: [], reviews: [], conflicts: [] };
  const writes = actions.filter((a) => ['create', 'reactivate', 'revoke', 'adjust'].includes(a.kind));
  for (const action of actions) if (action.kind === 'review') result.reviews.push({ code: action.code, reason: action.reason, wouldRevoke: action.wouldRevoke });
  if (writes.length === 0) return result;
  const byCode = new Map(catalog.map((c) => [c.code, c]));
  const now = context.now ?? new Date();
  const cause = (context.cause ?? Prisma.JsonNull) as Prisma.InputJsonValue;

  await withUserLock(prisma, userId, async (db) => {
    for (const action of writes) {
      const entry = byCode.get(action.code);
      if (action.kind === 'create') {
        if (!entry || !action.candidate) continue;
        const candidate = action.candidate;
        try {
          const created = await db.userAchievement.create({
            data: {
              userId, achievementId: entry.id, value: candidate.value, periodStart: candidate.periodStart, periodEnd: candidate.periodEnd, modality: candidate.modality,
              evidence: candidate.evidence as Prisma.InputJsonValue, ruleVersionAtUnlock: entry.ruleVersion, status: 'active',
            },
          });
          await db.userAchievementTransition.create({
            data: {
              userAchievementId: created.id, userId, type: 'granted', at: now, trigger: context.trigger, reason: action.reason, cause,
              before: Prisma.JsonNull, after: snapshot(created as AwardRow) as unknown as Prisma.InputJsonValue, ruleVersion: entry.ruleVersion,
            },
          });
          result.granted.push(action.code);
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue; // concorrencia: ja concedida
          throw error;
        }
        continue;
      }

      const existing = action.existing;
      if (!existing) continue;
      const current = (await db.userAchievement.findUnique({ where: { id: existing.id } })) as AwardRow | null;
      if (!current) { result.conflicts.push(action.code); continue; }
      const currentRevoked = isAwardRevoked({ evidence: current.evidence, status: current.status });
      const isVolume = VOLUME.has(existing.category);
      const ruleVersion = current.ruleVersionAtUnlock ?? existing.awardedVersion;
      const before = snapshot(current);

      if (action.kind === 'reactivate') {
        if (!currentRevoked || !action.candidate) { result.conflicts.push(action.code); continue; }
        const candidate = action.candidate;
        const updated = await db.userAchievement.update({
          where: { id: current.id },
          data: {
            status: 'active', revokedAt: null, revokedReason: null, statusChangedAt: now,
            value: candidate.value, periodStart: candidate.periodStart, periodEnd: candidate.periodEnd, modality: candidate.modality,
            evidence: (isVolume ? withVolumeReconciliation(candidate.evidence as Prisma.JsonValue, 'active', original(current), now.toISOString()) : candidate.evidence) as Prisma.InputJsonValue,
          },
        });
        await db.userAchievementTransition.create({
          data: { userAchievementId: current.id, userId, type: 'reactivated', at: now, trigger: context.trigger, reason: action.reason, cause, before: before as unknown as Prisma.InputJsonValue, after: snapshot(updated as AwardRow) as unknown as Prisma.InputJsonValue, ruleVersion },
        });
        result.reactivated.push(action.code);
        continue;
      }

      // revoke / adjust: so' se a concessao ainda e' exatamente a que foi planejada (nada mudou no meio).
      if (currentRevoked || !sameState(current, existing as unknown as AwardRow)) { result.conflicts.push(action.code); continue; }
      if (action.kind === 'revoke') {
        const updated = await db.userAchievement.update({
          where: { id: current.id },
          data: {
            status: 'revoked', revokedAt: now, revokedReason: action.reason, statusChangedAt: now,
            ...(isVolume ? { evidence: withVolumeReconciliation(current.evidence, 'retracted', original(current), now.toISOString()) } : {}),
          },
        });
        await db.userAchievementTransition.create({
          data: { userAchievementId: current.id, userId, type: 'revoked', at: now, trigger: context.trigger, reason: action.reason, cause, before: before as unknown as Prisma.InputJsonValue, after: snapshot(updated as AwardRow) as unknown as Prisma.InputJsonValue, ruleVersion },
        });
        result.revoked.push(action.code);
      } else if (action.kind === 'adjust' && action.candidate) {
        const candidate = action.candidate;
        const updated = await db.userAchievement.update({
          where: { id: current.id },
          data: {
            value: candidate.value, periodStart: candidate.periodStart, periodEnd: candidate.periodEnd, modality: candidate.modality,
            evidence: (isVolume ? withVolumeReconciliation(candidate.evidence as Prisma.JsonValue, 'active', original(current), now.toISOString()) : candidate.evidence) as Prisma.InputJsonValue,
          },
        });
        await db.userAchievementTransition.create({
          data: { userAchievementId: current.id, userId, type: 'adjusted', at: now, trigger: context.trigger, reason: action.reason, cause, before: before as unknown as Prisma.InputJsonValue, after: snapshot(updated as AwardRow) as unknown as Prisma.InputJsonValue, ruleVersion },
        });
        result.adjusted.push(action.code);
      }
    }
  });
  return result;
}
