import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeHrDecoupling, HR_DECOUPLING_ALGORITHM_VERSION, HrDecouplingCategory, HrDecouplingExclusionReason, HrDecouplingResult } from './hr-decoupling';

// Guarda e le o desacoplamento da FC por corrida (03/11/2026). A tabela ActivityHrDecoupling e' DERIVADA da serie temporal: uma linha por atividade e versao do algoritmo, recalculada quando a
// versao muda ou a quantidade de pontos da serie muda. Idempotente (upsert) e segura contra corrida concorrente: se duas leituras calculam ao mesmo tempo o valor e' o mesmo, e a que perde o
// upsert usa o resultado que acabou de calcular. Nenhuma chamada externa; nada aqui decide treino.

const logger = new Logger('HrDecouplingStore');

export interface HrDecouplingRow extends HrDecouplingResult {
  activityLogId: string;
  category: HrDecouplingCategory | null;
  exclusionReason: HrDecouplingExclusionReason | null;
}

type StoredRow = Omit<HrDecouplingRow, 'category' | 'exclusionReason' | 'qualityStatus'> & { category: string | null; exclusionReason: string | null; qualityStatus: string | null; pointCount: number };

function toRow(stored: StoredRow): HrDecouplingRow {
  return { ...stored, category: stored.category as HrDecouplingCategory | null, exclusionReason: stored.exclusionReason as HrDecouplingExclusionReason | null, qualityStatus: stored.qualityStatus as HrDecouplingRow['qualityStatus'] };
}

function dataOf(result: HrDecouplingResult) {
  const { eligible, exclusionReason, category, analyzedStartSec, analyzedEndSec, movingSec, meanSpeed1, meanSpeed2, meanHr1, meanHr2, r1, r2, decouplingPct, speedCvPct, halfDiffPct,
    coverageHr1, coverageHr2, coverageSpeed1, coverageSpeed2, validHrSamples, validSpeedSamples, discardedHrSamples, discardedSpeedSamples, gapCount, pointCount,
    qualityStatus, transientEventCount, transientEventSec, excludedSec, excludedPct, sustainedEventCount } = result;
  return { eligible, exclusionReason, category, analyzedStartSec, analyzedEndSec, movingSec, meanSpeed1, meanSpeed2, meanHr1, meanHr2, r1, r2, decouplingPct, speedCvPct, halfDiffPct,
    coverageHr1, coverageHr2, coverageSpeed1, coverageSpeed2, validHrSamples, validSpeedSamples, discardedHrSamples, discardedSpeedSamples, gapCount, pointCount,
    qualityStatus, transientEventCount, transientEventSec, excludedSec, excludedPct, sustainedEventCount };
}

export async function ensureHrDecouplings(prisma: PrismaService, activityLogIds: string[]): Promise<Map<string, HrDecouplingRow>> {
  const out = new Map<string, HrDecouplingRow>();
  if (activityLogIds.length === 0) return out;
  const counts = await prisma.activityTimeSeriesPoint.groupBy({ by: ['activityLogId'], where: { activityLogId: { in: activityLogIds } }, _count: { _all: true } });
  const pointCountOf = new Map(counts.map((c) => [c.activityLogId, c._count._all]));
  const existing = await prisma.activityHrDecoupling.findMany({ where: { activityLogId: { in: activityLogIds }, algorithmVersion: HR_DECOUPLING_ALGORITHM_VERSION } });
  const existingById = new Map(existing.map((row) => [row.activityLogId, row]));

  for (const activityLogId of activityLogIds) {
    const pointCount = pointCountOf.get(activityLogId) ?? 0;
    const stored = existingById.get(activityLogId);
    if (stored && stored.pointCount === pointCount) {
      out.set(activityLogId, toRow(stored as unknown as StoredRow));
      continue;
    }
    // Se coexistirem versoes de normalizacao da serie, vale a mais recente.
    const rows = pointCount === 0 ? [] : await prisma.activityTimeSeriesPoint.findMany({
      where: { activityLogId }, orderBy: { offsetSec: 'asc' }, select: { offsetSec: true, heartRateBpm: true, speedKmh: true, normalizationVersion: true },
    });
    const latest = rows.reduce((max, p) => Math.max(max, p.normalizationVersion), 0);
    const result = computeHrDecoupling(rows.filter((p) => p.normalizationVersion === latest));
    result.pointCount = pointCount;
    try {
      const saved = await prisma.activityHrDecoupling.upsert({
        where: { activityLogId_algorithmVersion: { activityLogId, algorithmVersion: HR_DECOUPLING_ALGORITHM_VERSION } },
        create: { activityLogId, algorithmVersion: HR_DECOUPLING_ALGORITHM_VERSION, ...dataOf(result) },
        update: dataOf(result),
      });
      out.set(activityLogId, toRow(saved as unknown as StoredRow));
    } catch (error) {
      logger.warn(`Desacoplamento da atividade ${activityLogId} calculado mas nao gravado: ${error instanceof Error ? error.message : String(error)}`);
      out.set(activityLogId, toRow({ ...result, activityLogId } as unknown as StoredRow));
    }
  }
  return out;
}
