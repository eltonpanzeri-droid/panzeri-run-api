// Referencias ANTERIORES a cada observacao (27/10/2026, nova interface de Evolucao do painel).
//
// Pergunta que isto responde: "como este registro se compara ao historico que existia ANTES dele?". Para cada observacao da serie:
//   - a propria observacao NUNCA entra na referencia dela (ela passa a compor as referencias das observacoes SEGUINTES);
//   - observacoes com o MESMO instante compartilham a mesma referencia (congelada antes do grupo): a ordem de processamento nao muda o resultado;
//   - media historica = todas as observacoes anteriores; medias moveis de 7, 21, 60 e 200 UNIDADES; faixa habitual = P10-P90 das anteriores na janela de 200 unidades
//     (mesma funcao habitualRange do backend — nenhuma formula nova, so' o corte "somente o que veio antes").
// A UNIDADE da janela depende da periodicidade da variavel (dias para diarias/noturnas; registros, semanas ou ciclos nas demais) e sempre acompanha o rotulo.
// Sem base suficiente a faixa NAO existe (basis 'none'): ausencia de referencia nunca e' tratada como "normal".
// Nada aqui decide prescricao, carga ou bom/ruim: o sinal so' diz de que lado da faixa o valor ficou.

import { MathLayerService, SeriesPoint, WindowSpec } from './math-layer.service';
import { LongitudinalDynamicsService } from './longitudinal-dynamics.service';
import type { VariableDefinition } from './variable-registry';

export const REFERENCE_WINDOW_SIZES = [7, 21, 60, 200] as const;
export type ReferenceWindowKey = 'mm7' | 'mm21' | 'mm60' | 'mm200';
const WINDOW_KEYS: Record<(typeof REFERENCE_WINDOW_SIZES)[number], ReferenceWindowKey> = { 7: 'mm7', 21: 'mm21', 60: 'mm60', 200: 'mm200' };

// Faixa habitual: >= 12 registros anteriores = individual; 4 a 11 = limitada (base pequena); menos que 4 = sem faixa. Mesma graduacao que a classificacao de mudanca ja usa (12 / 4).
export const BAND_INDIVIDUAL_MIN = 12;
export const BAND_LIMITED_MIN = 4;

export type ReferenceUnit = 'dias' | 'noites' | 'registros' | 'semanas' | 'ciclos';
export type BandBasis = 'individual' | 'limited' | 'none';
export type ReferenceSignal = 'above' | 'below' | 'within' | 'no_reference';

export interface ReferenceWindowValue { value: number | null; n: number; isPartialWindow: boolean }
export interface ReferencePoint {
  timestamp: string;
  value: number;
  /** Quantas observacoes anteriores existiam quando esta foi registrada. */
  priorN: number;
  historicalMean: { value: number | null; n: number };
  movingAverages: Record<ReferenceWindowKey, ReferenceWindowValue>;
  band: { lower: number | null; upper: number | null; median: number | null; n: number; basis: BandBasis; isPartialWindow: boolean };
  /** Lado da faixa em que o valor ficou. NEUTRO: nao significa melhora nem piora. */
  signal: ReferenceSignal;
  /** Distancia alem do limite da faixa mais proximo (positiva acima, negativa abaixo); null dentro da faixa ou sem faixa. */
  outsideBy: number | null;
}
export interface ReferenceSeries {
  version: 1;
  method: 'prior_observations_only';
  unit: ReferenceUnit;
  windowKind: WindowSpec['kind'];
  windows: Array<{ key: ReferenceWindowKey; size: number; label: string }>;
  bandPolicy: { method: 'empirical_percentile_p10_p90'; windowSize: number; individualMin: number; limitedMin: number };
  points: ReferencePoint[];
}

export function referenceUnitOf(definition: Pick<VariableDefinition, 'expectedFrequency'>): ReferenceUnit {
  switch (definition.expectedFrequency) {
    case 'per_day': return 'dias';
    case 'per_night': return 'noites';
    case 'per_week': return 'semanas';
    case 'per_cycle': return 'ciclos';
    default: return 'registros';
  }
}

// Diarias e noturnas: janelas em dias corridos (como sempre foi no backend). Semanais, por ciclo e por treino: janelas por NUMERO de observacoes (uma semana = um ponto).
function windowKindOf(unit: ReferenceUnit): WindowSpec['kind'] {
  return unit === 'dias' || unit === 'noites' ? 'calendar_days' : 'observation_count';
}

export function buildReferenceSeries(
  series: SeriesPoint[],
  definition: Pick<VariableDefinition, 'expectedFrequency'>,
  mathLayer: MathLayerService,
  dynamics: LongitudinalDynamicsService,
): ReferenceSeries {
  const unit = referenceUnitOf(definition);
  const kind = windowKindOf(unit);
  const sorted = [...series].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const windows = REFERENCE_WINDOW_SIZES.map((size) => ({ key: WINDOW_KEYS[size], size, label: `MM${size} ${unit}` }));
  const bandWindow: WindowSpec = { kind, size: 200 };
  const points: ReferencePoint[] = [];
  let firstOfGroup = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const point = sorted[i];
    if (i === 0 || sorted[i - 1].timestamp.getTime() !== point.timestamp.getTime()) firstOfGroup = i;
    const prior = sorted.slice(0, firstOfGroup); // estritamente anteriores ao instante (empates ficam todos de fora)
    const asOf = kind === 'calendar_days' ? point.timestamp : undefined;
    const movingAverages = {} as Record<ReferenceWindowKey, ReferenceWindowValue>;
    for (const { key, size } of windows) {
      const result = prior.length ? mathLayer.movingAverage(prior, { kind, size }, asOf) : null;
      movingAverages[key] = result ? { value: result.value, n: result.n, isPartialWindow: result.isPartialWindow } : { value: null, n: 0, isPartialWindow: true };
    }
    const range = prior.length ? dynamics.habitualRange(prior, bandWindow, asOf) : null;
    const bandN = range?.n ?? 0;
    const basis: BandBasis = bandN >= BAND_INDIVIDUAL_MIN ? 'individual' : bandN >= BAND_LIMITED_MIN ? 'limited' : 'none';
    const lower = basis === 'none' ? null : range!.lower;
    const upper = basis === 'none' ? null : range!.upper;
    let signal: ReferenceSignal = 'no_reference';
    let outsideBy: number | null = null;
    if (lower != null && upper != null) {
      if (point.value > upper) { signal = 'above'; outsideBy = point.value - upper; }
      else if (point.value < lower) { signal = 'below'; outsideBy = point.value - lower; }
      else signal = 'within';
    }
    points.push({
      timestamp: point.timestamp.toISOString(),
      value: point.value,
      priorN: prior.length,
      historicalMean: mathLayer.periodMean(prior),
      movingAverages,
      band: { lower, upper, median: basis === 'none' ? null : range!.median, n: bandN, basis, isPartialWindow: range?.isPartialWindow ?? true },
      signal,
      outsideBy,
    });
  }
  return {
    version: 1,
    method: 'prior_observations_only',
    unit,
    windowKind: kind,
    windows,
    bandPolicy: { method: 'empirical_percentile_p10_p90', windowSize: 200, individualMin: BAND_INDIVIDUAL_MIN, limitedMin: BAND_LIMITED_MIN },
    points,
  };
}
