/* eslint-disable no-console */
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionMetricService } from '../evolution/evolution-metric.service';
import { MedalEvaluationService } from './medal-evaluation.service';
import {
  ExistingVolumeAward, planVolumeReconciliation, VOLUME_CATEGORIES,
  VolumeAction, withVolumeReconciliation,
} from './volume-reconciliation';

// Dry-run por padrão. Aplicação exige o hash do plano conferido e um backup já verificado.
// Não chama GET /me/medals nem evaluateForUser: ambos podem conceder medalhas.
async function main() {
  const apply = process.argv.includes('--apply');
  const hashIndex = process.argv.indexOf('--expected-sha256');
  const expectedHash = hashIndex >= 0 ? process.argv[hashIndex + 1] : null;
  if (apply && (!expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash) || !process.argv.includes('--backup-confirmed'))) {
    throw new Error('Para aplicar: --apply --expected-sha256 <hash-do-dry-run> --backup-confirmed.');
  }
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const evolution = new EvolutionMetricService(prisma);
    const evaluator = new MedalEvaluationService(prisma, evolution);
    const [users, catalog] = await Promise.all([
      prisma.user.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
      prisma.achievement.findMany({ where: { category: { in: [...VOLUME_CATEGORIES] } }, select: { id: true, code: true, category: true, threshold: true, criteria: true, ruleVersion: true, active: true } }),
    ]);
    const allActions: Array<VolumeAction & { userId: string }> = [];
    for (const user of users) {
      const [candidates, series, uncertainty, legacyCorrida, legacyEsteira, rows] = await Promise.all([
        evaluator.previewVolumeAwards(user.id),
        evolution.getRunSeries(user.id),
        evolution.getRunMedalUncertainty(user.id),
        evolution.getSeriesByModality(user.id, 'corrida'),
        evolution.getSeriesByModality(user.id, 'esteira'),
        prisma.userAchievement.findMany({
          where: { userId: user.id, achievement: { category: { in: [...VOLUME_CATEGORIES] } } },
          include: { achievement: true },
        }),
      ]);
      const existing: ExistingVolumeAward[] = rows.map((row) => ({
        id: row.id, code: row.achievement.code, category: row.achievement.category,
        threshold: row.achievement.threshold, criteria: row.achievement.criteria,
        catalogVersion: row.achievement.ruleVersion, awardedVersion: row.ruleVersionAtUnlock,
        value: row.value, periodStart: row.periodStart, periodEnd: row.periodEnd, evidence: row.evidence,
      }));
      allActions.push(...planVolumeReconciliation(existing, candidates, series, uncertainty, catalog,
        { corrida: legacyCorrida, esteira: legacyEsteira })
        .map((action) => ({ ...action, userId: user.id })));
    }
    const actionable = allActions.filter((action) => ['create', 'update', 'retract'].includes(action.kind));
    const fingerprint = createHash('sha256').update(JSON.stringify(allActions.map((action) => ({
      userId: action.userId, code: action.code, kind: action.kind, existingId: action.existing?.id,
      value: action.candidate?.value, periodStart: action.candidate?.periodStart?.toISOString(),
      periodEnd: action.candidate?.periodEnd?.toISOString(), reason: action.reason,
    })))).digest('hex');
    const counts = Object.fromEntries(['keep', 'create', 'update', 'retract', 'review'].map((kind) => [kind, allActions.filter((action) => action.kind === kind).length]));
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', users: users.length, counts, sha256: fingerprint }));
    if (!apply) return;
    if (fingerprint !== expectedHash) throw new Error('Plano mudou desde o dry-run. Nenhum dado foi alterado.');

    const checkedAt = new Date().toISOString();
    for (const user of users) {
      const actions = actionable.filter((action) => action.userId === user.id);
      if (!actions.length) continue;
      await prisma.$transaction(async (tx) => {
        for (const action of actions) {
          if (action.kind === 'create' && action.candidate) {
            const achievement = catalog.find((item) => item.code === action.code);
            if (!achievement) throw new Error('Medalha não encontrada no catálogo.');
            await tx.userAchievement.create({ data: {
              userId: user.id, achievementId: achievement.id, value: action.candidate.value,
              periodStart: action.candidate.periodStart, periodEnd: action.candidate.periodEnd,
              modality: action.candidate.modality, evidence: action.candidate.evidence as Prisma.InputJsonValue,
              ruleVersionAtUnlock: achievement.ruleVersion,
            } });
          } else if ((action.kind === 'update' || action.kind === 'retract') && action.existing) {
            const current = await tx.userAchievement.findUnique({ where: { id: action.existing.id } });
            if (!current || current.value !== action.existing.value ||
                current.periodStart?.getTime() !== action.existing.periodStart?.getTime() ||
                current.periodEnd?.getTime() !== action.existing.periodEnd?.getTime() ||
                JSON.stringify(current.evidence) !== JSON.stringify(action.existing.evidence)) {
              throw new Error('Concessão mudou durante a reconciliação. Transação cancelada.');
            }
            const original = {
              value: current.value, periodStart: current.periodStart,
              periodEnd: current.periodEnd, evidence: current.evidence,
            };
            if (action.kind === 'retract') {
              await tx.userAchievement.update({ where: { id: current.id }, data: {
                evidence: withVolumeReconciliation(current.evidence, 'retracted', original, checkedAt),
              } });
            } else if (action.candidate) {
              await tx.userAchievement.update({ where: { id: current.id }, data: {
                value: action.candidate.value, periodStart: action.candidate.periodStart,
                periodEnd: action.candidate.periodEnd, modality: action.candidate.modality,
                evidence: withVolumeReconciliation(action.candidate.evidence as Prisma.JsonValue, 'active', original, checkedAt),
              } });
            }
          }
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    console.log(JSON.stringify({ applied: true, changed: actionable.length, sha256: fingerprint }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`Reconciliação não concluída: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
