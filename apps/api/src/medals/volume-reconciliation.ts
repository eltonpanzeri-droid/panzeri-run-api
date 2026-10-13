import { Prisma } from '@prisma/client';
import type { EvolutionSeries } from '../evolution/evolution.types';
import type { UnlockCandidate } from './medal-evaluation.service';

export const VOLUME_CATEGORIES = ['volume_semanal', 'volume_mensal', 'sustentacao_volume'] as const;
export const VOLUME_RECONCILIATION_KEY = '_volumeReconciliation';

export function isRetractedVolumeEvidence(evidence: Prisma.JsonValue): boolean {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  const marker = evidence[VOLUME_RECONCILIATION_KEY];
  return !!marker && typeof marker === 'object' && !Array.isArray(marker) && marker.status === 'retracted';
}

export function withVolumeReconciliation(
  evidence: Prisma.JsonValue,
  status: 'active' | 'retracted',
  original: { value: number | null; periodStart: Date | null; periodEnd: Date | null; evidence: Prisma.JsonValue },
  checkedAt: string,
): Prisma.InputJsonValue {
  const source = evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : {};
  const previousEvidence = original.evidence && typeof original.evidence === 'object' && !Array.isArray(original.evidence)
    ? original.evidence
    : {};
  const priorMarker = previousEvidence[VOLUME_RECONCILIATION_KEY];
  const priorOriginal = priorMarker && typeof priorMarker === 'object' && !Array.isArray(priorMarker)
    ? priorMarker.original
    : null;
  return {
    ...source,
    [VOLUME_RECONCILIATION_KEY]: {
      status,
      checkedAt,
      original: priorOriginal ?? {
        value: original.value,
        periodStart: original.periodStart?.toISOString() ?? null,
        periodEnd: original.periodEnd?.toISOString() ?? null,
        evidence: original.evidence,
      },
    },
  } as Prisma.InputJsonValue;
}

export interface ExistingVolumeAward {
  id: string;
  code: string;
  category: string;
  threshold: number | null;
  criteria: Prisma.JsonValue;
  catalogVersion: number;
  awardedVersion: number;
  value: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  evidence: Prisma.JsonValue;
}

export type VolumeAction = {
  kind: 'keep' | 'create' | 'update' | 'retract' | 'review';
  code: string;
  existing?: ExistingVolumeAward;
  candidate?: UnlockCandidate;
  reason: string;
};

const day = (date: Date | null): string | null => date?.toISOString().slice(0, 10) ?? null;

function awardPeriod(award: ExistingVolumeAward): string | null {
  const evidence = award.evidence && typeof award.evidence === 'object' && !Array.isArray(award.evidence)
    ? award.evidence : {};
  const key = award.category === 'volume_semanal' ? 'weekStart' : award.category === 'volume_mensal' ? 'month' : 'endWeek';
  const stored = award.category === 'sustentacao_volume' ? day(award.periodEnd) : day(award.periodStart);
  const fromEvidence = typeof evidence[key] === 'string' ? evidence[key] : null;
  if (fromEvidence && stored && !stored.startsWith(fromEvidence)) return null;
  return fromEvidence ?? (award.category === 'volume_mensal' ? stored?.slice(0, 7) ?? null : stored);
}

function uncertainInAwardPeriod(award: ExistingVolumeAward, weeks: Set<string>, months: Set<string>): boolean | null {
  const period = awardPeriod(award);
  if (!period) return null;
  if (award.category === 'volume_semanal') return weeks.has(period);
  if (award.category === 'volume_mensal') return months.has(period);
  const count = award.threshold;
  if (!count || !Number.isInteger(count)) return null;
  const end = Date.parse(`${period}T00:00:00Z`);
  if (!Number.isFinite(end)) return null;
  for (let index = 0; index < count; index++) {
    if (weeks.has(new Date(end - index * 7 * 86_400_000).toISOString().slice(0, 10))) return true;
  }
  return false;
}

function periodHasEvidence(award: ExistingVolumeAward, series: EvolutionSeries): boolean {
  const period = awardPeriod(award);
  if (!period) return false;
  if (award.category === 'volume_semanal') return series.weeks.some((week) => week.weekStart === period && week.kmPercorridos != null);
  if (award.category === 'volume_mensal') return series.months.some((month) => month.month === period && month.kmPercorridos != null);
  const count = award.threshold;
  if (!count || !Number.isInteger(count)) return false;
  const end = Date.parse(`${period}T00:00:00Z`);
  if (!Number.isFinite(end)) return false;
  for (let index = 0; index < count; index++) {
    const weekStart = new Date(end - index * 7 * 86_400_000).toISOString().slice(0, 10);
    if (!series.weeks.some((week) => week.weekStart === weekStart && week.kmPercorridos != null)) return false;
  }
  return true;
}

function matchesKnownDuplicate(award: ExistingVolumeAward, legacy: { corrida: EvolutionSeries; esteira: EvolutionSeries } | null): boolean {
  if (!legacy) return false;
  const period = awardPeriod(award);
  if (!period) return false;
  const weekly = (key: string) =>
    (legacy.corrida.weeks.find((week) => week.weekStart === key)?.kmPercorridos ?? 0) +
    (legacy.esteira.weeks.find((week) => week.weekStart === key)?.kmPercorridos ?? 0);
  if (award.category === 'volume_semanal') {
    return award.value != null && Math.abs(weekly(period) - award.value) <= 0.2;
  }
  if (award.category === 'volume_mensal') {
    const value = (legacy.corrida.months.find((month) => month.month === period)?.kmPercorridos ?? 0) +
      (legacy.esteira.months.find((month) => month.month === period)?.kmPercorridos ?? 0);
    return award.value != null && Math.abs(value - award.value) <= 0.2;
  }
  if (award.category === 'sustentacao_volume') {
    const count = award.threshold;
    const criteria = award.criteria && typeof award.criteria === 'object' && !Array.isArray(award.criteria) ? award.criteria : {};
    const threshold = criteria.weeklyKmThreshold;
    if (!count || !Number.isInteger(count) || typeof threshold !== 'number') return false;
    const end = Date.parse(`${period}T00:00:00Z`);
    if (!Number.isFinite(end)) return false;
    for (let index = 0; index < count; index++) {
      const week = new Date(end - index * 7 * 86_400_000).toISOString().slice(0, 10);
      if (weekly(week) < threshold) return false;
    }
    return true;
  }
  return false;
}

function earlierUncertainty(candidate: UnlockCandidate, category: string, weeks: Set<string>, months: Set<string>): boolean {
  const date = category === 'sustentacao_volume' ? day(candidate.periodEnd) : day(candidate.periodStart);
  if (!date) return true;
  if (category === 'volume_mensal') return [...months].some((month) => month < date.slice(0, 7));
  return [...weeks].some((week) => week <= date);
}

export function planVolumeReconciliation(
  existing: ExistingVolumeAward[], candidates: UnlockCandidate[], series: EvolutionSeries,
  uncertainty: { weeks: Set<string>; months: Set<string> },
  catalog: Array<{ code: string; category: string; active: boolean; ruleVersion: number }>,
  legacy: { corrida: EvolutionSeries; esteira: EvolutionSeries } | null = null,
): VolumeAction[] {
  const byCandidate = new Map(candidates.map((candidate) => [candidate.code, candidate]));
  const byCatalog = new Map(catalog.map((medal) => [medal.code, medal]));
  const byExisting = new Map(existing.map((award) => [award.code, award]));
  const actions: VolumeAction[] = [];

  for (const award of existing) {
    const candidate = byCandidate.get(award.code);
    const catalogMedal = byCatalog.get(award.code);
    if (!catalogMedal || award.awardedVersion !== award.catalogVersion || catalogMedal.ruleVersion !== award.awardedVersion) {
      actions.push({ kind: 'review', code: award.code, existing: award, reason: 'versão ou catálogo divergente' });
    } else if (candidate) {
      if (earlierUncertainty(candidate, award.category, uncertainty.weeks, uncertainty.months)) {
        actions.push({ kind: 'review', code: award.code, existing: award, candidate, reason: 'período anterior ou atual incerto' });
      } else if (isRetractedVolumeEvidence(award.evidence) || award.value !== candidate.value ||
                 day(award.periodStart) !== day(candidate.periodStart) || day(award.periodEnd) !== day(candidate.periodEnd)) {
        actions.push({ kind: 'update', code: award.code, existing: award, candidate, reason: 'alinhar concessão ao primeiro período comprovado' });
      } else {
        actions.push({ kind: 'keep', code: award.code, existing: award, reason: 'concessão comprovada' });
      }
    } else if (uncertainInAwardPeriod(award, uncertainty.weeks, uncertainty.months) !== false || !periodHasEvidence(award, series)) {
      actions.push({ kind: 'review', code: award.code, existing: award, reason: 'período incerto ou sem observações suficientes' });
    } else if (isRetractedVolumeEvidence(award.evidence)) {
      actions.push({ kind: 'keep', code: award.code, existing: award, reason: 'retração já registrada' });
    } else if (!matchesKnownDuplicate(award, legacy)) {
      actions.push({ kind: 'review', code: award.code, existing: award, reason: 'causa da concessão não comprovada pelo cálculo duplicado anterior' });
    } else {
      actions.push({ kind: 'retract', code: award.code, existing: award, reason: 'concessão reproduzida pelo cálculo duplicado anterior; limiar não demonstrado no cálculo canônico' });
    }
  }

  for (const candidate of candidates) {
    if (byExisting.has(candidate.code)) continue;
    const medal = byCatalog.get(candidate.code);
    if (!medal || !medal.active) continue;
    actions.push(earlierUncertainty(candidate, medal.category, uncertainty.weeks, uncertainty.months)
      ? { kind: 'review', code: candidate.code, candidate, reason: 'período anterior ou atual incerto' }
      : { kind: 'create', code: candidate.code, candidate, reason: 'conquista comprovada ainda não registrada' });
  }
  return actions;
}
