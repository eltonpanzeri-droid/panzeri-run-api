import { PHASE_IDS, PHASE_LABEL, phaseOfDate, type PhaseId, type PhasedCycle } from './cycle-phases';

// Relatorio do ciclo por fase (19/11/2026, ordem de Elton). PARTE PURA: separa registros por fase do ciclo e resume; nao le banco, nao decide treino, nao diagnostica. Fases e limitacoes vem de cycle-phases.ts.
// Cada numero e' descritivo (media, contagem, soma); o quadro geral so' compara fases quando ha' dado suficiente nas duas e diz que e' uma leitura do que ela registrou.
export const MIN_POINTS_FOR_COMPARISON = 3;

export interface TimedValue { timestamp: Date; value: number }
export interface PhaseStat { n: number; mean: number | null }

const round1 = (value: number) => Math.round(value * 10) / 10;
export const meanOf = (values: number[]): number | null => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

export function bucketValuesByPhase(items: TimedValue[], cycles: PhasedCycle[], since: Date | null): Record<PhaseId, number[]> {
  const out: Record<PhaseId, number[]> = { menstruacao: [], folicular: [], ovulatoria: [], lutea: [] };
  for (const item of items) {
    if (since && item.timestamp.getTime() < since.getTime()) continue;
    if (!Number.isFinite(item.value)) continue;
    const phased = phaseOfDate(item.timestamp, cycles);
    if (phased) out[phased.phase].push(item.value);
  }
  return out;
}

export function statsByPhase(items: TimedValue[], cycles: PhasedCycle[], since: Date | null, digits = 1): Record<PhaseId, PhaseStat> {
  const buckets = bucketValuesByPhase(items, cycles, since);
  const factor = 10 ** digits;
  return Object.fromEntries(PHASE_IDS.map((phase) => {
    const mean = meanOf(buckets[phase]);
    return [phase, { n: buckets[phase].length, mean: mean == null ? null : Math.round(mean * factor) / factor }];
  })) as Record<PhaseId, PhaseStat>;
}

// Quantos dias do periodo observado caem em cada fase (da o contexto: fase com poucos dias tem numeros menos firmes).
export function daysPerPhase(cycles: PhasedCycle[], from: Date, to: Date): Record<PhaseId, number> {
  const out: Record<PhaseId, number> = { menstruacao: 0, folicular: 0, ovulatoria: 0, lutea: 0 };
  for (let time = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); time <= to.getTime(); time += 86_400_000) {
    const phased = phaseOfDate(new Date(time), cycles);
    if (phased) out[phased.phase] += 1;
  }
  return out;
}

export interface ComparableMetric { id: string; label: string; unit: string; stats: Record<PhaseId, PhaseStat>; higherMeans?: string; lowerMeans?: string }

// Frases do quadro geral: para cada metrica com dado suficiente em pelo menos duas fases, diz em qual fase a media foi mais alta e em qual foi mais baixa. Nunca causa: "no que voce registrou".
export function buildOverviewSentences(metrics: ComparableMetric[]): string[] {
  const sentences: string[] = [];
  for (const metric of metrics) {
    const usable = PHASE_IDS.filter((phase) => metric.stats[phase].n >= MIN_POINTS_FOR_COMPARISON && metric.stats[phase].mean != null);
    if (usable.length < 2) continue;
    const sorted = [...usable].sort((a, b) => (metric.stats[a].mean as number) - (metric.stats[b].mean as number));
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    const lowValue = metric.stats[low].mean as number;
    const highValue = metric.stats[high].mean as number;
    if (round1(highValue) === round1(lowValue)) continue;
    sentences.push(`${metric.label}: no que você registrou, a média foi mais alta na ${PHASE_LABEL[high].toLowerCase()} (${round1(highValue)}${metric.unit}) e mais baixa na ${PHASE_LABEL[low].toLowerCase()} (${round1(lowValue)}${metric.unit}).`);
  }
  return sentences;
}

export const FORMAT_PACE = (secondsPerKm: number | null): string | null => {
  if (secondsPerKm == null) return null;
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}/km`;
};
