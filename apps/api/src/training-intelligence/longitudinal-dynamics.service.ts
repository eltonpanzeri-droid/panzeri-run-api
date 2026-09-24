// LongitudinalDynamicsService — segundo bloco da Camada Matematica Longitudinal (auditoria
// aprovada + validacao com dados reais aprovada 24/09/2026). Responde, de forma puramente
// descritiva e deterministica (fora do LLM), as perguntas de variabilidade/faixa habitual/
// persistencia/excursao/retorno da CAMADA_MATEMATICA_LONGITUDINAL.md — sem transformar nada disso
// em score, diagnostico ou regra de prescricao.
//
// CUIDADO COM ESCALAS ORDINAIS (pedido explicito): para uma escala 1-5, a distancia entre 1 e 2
// nao e' necessariamente equivalente, em magnitude "real", a distancia entre 4 e 5 — ainda assim
// aceitamos aritmetica de POSICAO (mediana, percentil por interpolacao, desvio absoluto da
// mediana) em vez de assumir uma distribuicao normal ou inventar uma escala de intervalo. Todo
// metodo usado e' declarado explicitamente na saida (`method`), nunca implicito.
//
// Nao usa desvio padrao/variancia classica (que presume dados de intervalo e sensibilidade a
// outliers menos apropriada aqui) — usa medidas robustas e livres de distribuicao: mediana, IQR
// (amplitude interquartil) e MAD (desvio absoluto da mediana). Funcionam igualmente bem pra
// ordinal_scale e numeric_continuous, e sao a razao de `variabilityStrategy` ter um unico valor
// real nesta rodada ('robust_distributional') — a interface ja permite adicionar uma segunda
// estrategia no futuro sem redesenho, mas so' criamos a segunda quando existir uma necessidade real.

import { Injectable } from '@nestjs/common';
import { MathLayerService, SeriesPoint, WindowSpec } from './math-layer.service';

export interface DispersionResult {
  window: WindowSpec;
  n: number;
  isPartialWindow: boolean;
  median: number | null;
  /** Desvio absoluto da mediana — medida robusta de dispersao, nao presume normalidade. */
  mad: number | null;
  /** Amplitude interquartil (Q3 - Q1). */
  iqr: number | null;
  range: number | null;
}

export interface HabitualRangeResult {
  method: 'empirical_percentile_linear_interpolation';
  window: WindowSpec;
  n: number;
  isPartialWindow: boolean;
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** Percentil 10 — limite inferior da faixa habitual individual. */
  lower: number | null;
  /** Percentil 90 — limite superior da faixa habitual individual. */
  upper: number | null;
  semanticCaution: string;
}

export interface VariabilityChangeResult {
  recent: DispersionResult;
  habitual: DispersionResult;
  /** recent.mad / habitual.mad — null quando nao calculavel (habitual.mad=0 e recent.mad!=0, ou n insuficiente). */
  madRatio: number | null;
  direction: 'increased' | 'decreased' | 'unchanged' | 'insufficient_data';
}

export interface PersistenceResult {
  /** null = nao ha dados suficientes (sem faixa habitual ou sem observacoes) pra avaliar. */
  currentlyOutsideHabitualRange: boolean | null;
  direction: 'above' | 'below' | null;
  startTimestamp: string | null;
  durationDays: number | null;
  observationCount: number | null;
}

export interface OvershootInfo {
  occurred: boolean;
  direction?: 'above' | 'below';
  magnitude?: number;
}

export interface ReturnDynamics {
  returned: boolean;
  returnTimestamp: string | null;
  timeToReturnDays: number | null;
  observationsToReturn: number;
  /** magnitude da excursao / timeToReturnDays — unidade da variavel por dia. Null se timeToReturnDays for 0 ou nulo. */
  returnVelocity: number | null;
  overshoot: OvershootInfo | null;
  levelRecovery: {
    evaluated: boolean;
    recovered: boolean | null;
    postReturnLevel: number | null;
    habitualMedian: number | null;
  };
  variabilityRecovery: {
    evaluated: boolean;
    recovered: boolean | null;
    postReturnMad: number | null;
    habitualMad: number | null;
    ratio: number | null;
  };
}

export interface Excursion {
  direction: 'above' | 'below';
  startTimestamp: string;
  endTimestamp: string;
  /** true quando a excursao ainda esta em curso na ultima observacao da serie (sem retorno observado ainda). */
  ongoing: boolean;
  durationDays: number;
  observationCount: number;
  peak: { value: number; timestamp: string };
  /** distancia do pico ate o limite da faixa habitual mais proximo (upper se 'above', lower se 'below'). */
  magnitude: number;
  /** null quando ongoing=true (ainda nao ha o que descrever sobre retorno). */
  returnDynamics: ReturnDynamics | null;
}

interface HabitualBounds {
  lower: number | null;
  upper: number | null;
}

const POST_RETURN_WINDOW_SIZE = 3;
const VARIABILITY_CHANGE_RATIO_THRESHOLD = 1.3; // acima disso = 'increased', abaixo do inverso = 'decreased'
const LEVEL_RECOVERY_UNIT_TOLERANCE = 0; // postReturnLevel precisa cair dentro de [lower, upper] pra contar como recuperado
const VARIABILITY_RECOVERY_RATIO_TOLERANCE = 1.5; // postReturnMad <= habitualMad * essa tolerancia conta como recuperado

function median(sortedValues: number[]): number | null {
  const n = sortedValues.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedValues[mid - 1] + sortedValues[mid]) / 2 : sortedValues[mid];
}

/** Percentil por interpolacao linear entre valores ordenados (metodo "type 7", o mesmo default do numpy). */
function percentile(sortedValues: number[], p: number): number | null {
  const n = sortedValues.length;
  if (n === 0) return null;
  if (n === 1) return sortedValues[0];
  const idx = (p / 100) * (n - 1);
  const lowerIdx = Math.floor(idx);
  const upperIdx = Math.ceil(idx);
  if (lowerIdx === upperIdx) return sortedValues[lowerIdx];
  const weight = idx - lowerIdx;
  return sortedValues[lowerIdx] * (1 - weight) + sortedValues[upperIdx] * weight;
}

@Injectable()
export class LongitudinalDynamicsService {
  constructor(private readonly mathLayer: MathLayerService) {}

  /** Mediana, MAD, IQR e amplitude de um conjunto de pontos — nao presume distribuicao. */
  dispersion(points: SeriesPoint[], window: WindowSpec, isPartialWindow: boolean): DispersionResult {
    const values = points.map((p) => p.value).sort((a, b) => a - b);
    const n = values.length;
    if (n === 0) {
      return { window, n: 0, isPartialWindow, median: null, mad: null, iqr: null, range: null };
    }
    const med = median(values);
    if (n === 1) {
      // Um unico ponto nao permite avaliar dispersao — reportar mediana (o proprio valor) mas
      // deixar mad/iqr/range null em vez de 0 (0 sugeriria "comprovadamente estavel", o que nao e verdade).
      return { window, n: 1, isPartialWindow, median: med, mad: null, iqr: null, range: null };
    }
    const q1 = percentile(values, 25)!;
    const q3 = percentile(values, 75)!;
    const absoluteDeviations = values.map((v) => Math.abs(v - med!)).sort((a, b) => a - b);
    const mad = median(absoluteDeviations);
    return {
      window,
      n,
      isPartialWindow,
      median: med,
      mad,
      iqr: q3 - q1,
      range: values[n - 1] - values[0],
    };
  }

  dispersionForWindow(series: SeriesPoint[], window: WindowSpec, asOf?: Date): DispersionResult {
    const selection = this.mathLayer.selectWindow(series, window, asOf);
    return this.dispersion(selection.points, selection.window, selection.isPartialWindow);
  }

  /**
   * Faixa habitual individual — derivada do proprio historico do atleta (P10/P90), nunca de um
   * threshold populacional. Metodo declarado explicitamente; nao assume normalidade.
   */
  habitualRange(series: SeriesPoint[], window: WindowSpec, asOf?: Date): HabitualRangeResult {
    const selection = this.mathLayer.selectWindow(series, window, asOf);
    const values = selection.points.map((p) => p.value).sort((a, b) => a - b);
    const n = values.length;
    return {
      method: 'empirical_percentile_linear_interpolation',
      window: selection.window,
      n,
      isPartialWindow: selection.isPartialWindow,
      median: median(values),
      q1: n > 0 ? percentile(values, 25) : null,
      q3: n > 0 ? percentile(values, 75) : null,
      lower: n > 0 ? percentile(values, 10) : null,
      upper: n > 0 ? percentile(values, 90) : null,
      semanticCaution:
        'Percentis calculados por interpolacao de posicao (nao presume distribuicao normal). Em ' +
        'escalas ordinais 1-5, a distancia entre valores adjacentes pode nao ser semanticamente ' +
        'uniforme — os limites abaixo sao posicionais, nao uma medida de magnitude biologica.',
    };
  }

  /** Compara variabilidade recente com a habitual (nunca confundir com comparacao de nivel/media). */
  variabilityChange(
    series: SeriesPoint[],
    recentWindow: WindowSpec,
    habitualWindow: WindowSpec,
    asOf?: Date,
  ): VariabilityChangeResult {
    const recent = this.dispersionForWindow(series, recentWindow, asOf);
    const habitual = this.dispersionForWindow(series, habitualWindow, asOf);

    let madRatio: number | null = null;
    if (recent.mad != null && habitual.mad != null) {
      if (habitual.mad === 0) {
        // Divisao por zero e' matematicamente indefinida quando o habitual nao tinha NENHUMA
        // variabilidade — a razao fica null (nao inventamos um numero), mas a DIRECAO ainda e'
        // decidivel sem razao (ver abaixo: zero->zero e' 'unchanged', zero->positivo e' 'increased').
        madRatio = recent.mad === 0 ? 1 : null;
      } else {
        madRatio = recent.mad / habitual.mad;
      }
    }

    let direction: VariabilityChangeResult['direction'] = 'insufficient_data';
    if (recent.n >= 3 && habitual.n >= 3 && recent.mad != null && habitual.mad != null) {
      if (habitual.mad === 0 && recent.mad === 0) {
        direction = 'unchanged';
      } else if (habitual.mad === 0 && recent.mad > 0) {
        direction = 'increased'; // baseline sem variabilidade nenhuma passou a ter — inequivoco mesmo sem razao numerica
      } else if (madRatio != null) {
        if (madRatio >= VARIABILITY_CHANGE_RATIO_THRESHOLD) direction = 'increased';
        else if (madRatio <= 1 / VARIABILITY_CHANGE_RATIO_THRESHOLD) direction = 'decreased';
        else direction = 'unchanged';
      }
    }

    return { recent, habitual, madRatio, direction };
  }

  /**
   * Detecta excursoes (trechos contiguos fora da faixa habitual) e, quando ha retorno observado,
   * descreve a dinamica do retorno — incluindo recuperacao de NIVEL e de VARIABILIDADE como duas
   * medidas independentes (nunca a mesma coisa).
   */
  excursions(series: SeriesPoint[], bounds: HabitualBounds): Excursion[] {
    if (bounds.lower == null || bounds.upper == null) return [];
    const sorted = [...series].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    type Side = 'above' | 'below' | 'inside';
    const sideOf = (value: number): Side => (value > bounds.upper! ? 'above' : value < bounds.lower! ? 'below' : 'inside');

    // Agrupa em segmentos contiguos: um ponto 'inside' sempre quebra o segmento; uma virada direta
    // de 'above' pra 'below' (sem passar por 'inside') tambem quebra — cada lado e' sua propria
    // excursao, o que permite depois ligar as duas como "overshoot" quando o retorno nao passa
    // observavelmente pela faixa habitual.
    const segments: { side: Side; points: SeriesPoint[] }[] = [];
    for (const point of sorted) {
      const side = sideOf(point.value);
      const current = segments[segments.length - 1];
      if (side !== 'inside' && current && current.side === side) {
        current.points.push(point);
      } else if (side !== 'inside') {
        segments.push({ side, points: [point] });
      } else {
        segments.push({ side: 'inside', points: [point] });
      }
    }

    const outsideSegments = segments.filter((s) => s.side !== 'inside') as { side: 'above' | 'below'; points: SeriesPoint[] }[];

    const excursionsRaw: Excursion[] = outsideSegments.map((segment) => {
      const boundary = segment.side === 'above' ? bounds.upper! : bounds.lower!;
      const peakPoint = segment.points.reduce((best, p) =>
        Math.abs(p.value - boundary) > Math.abs(best.value - boundary) ? p : best,
      );
      const start = segment.points[0];
      const end = segment.points[segment.points.length - 1];
      const durationDays = (end.timestamp.getTime() - start.timestamp.getTime()) / (24 * 60 * 60 * 1000);
      return {
        direction: segment.side,
        startTimestamp: start.timestamp.toISOString(),
        endTimestamp: end.timestamp.toISOString(),
        ongoing: sorted[sorted.length - 1].timestamp.getTime() === end.timestamp.getTime(),
        durationDays,
        observationCount: segment.points.length,
        peak: { value: peakPoint.value, timestamp: peakPoint.timestamp.toISOString() },
        magnitude: Math.abs(peakPoint.value - boundary),
        returnDynamics: null,
      };
    });

    // Para cada excursao (exceto a ultima, se ainda em curso), descreve o retorno usando o
    // segmento seguinte na lista COMPLETA de segmentos (que pode ser 'inside' = retorno real, ou
    // outra excursao de direcao oposta = overshoot sem passar observavelmente pela faixa habitual).
    for (let i = 0; i < outsideSegments.length; i++) {
      const exc = excursionsRaw[i];
      if (exc.ongoing) continue;

      const segmentIndex = segments.findIndex((s) => s === outsideSegments[i]);
      const nextSegment = segments[segmentIndex + 1];

      if (!nextSegment) continue; // nao deveria acontecer (ongoing ja cobre o caso de ser o ultimo)

      if (nextSegment.side === 'inside') {
        const returnPoint = nextSegment.points[0];
        const startMs = new Date(exc.startTimestamp).getTime();
        const daysToReturn = (returnPoint.timestamp.getTime() - startMs) / (24 * 60 * 60 * 1000);
        const returnVelocity = daysToReturn > 0 ? exc.magnitude / daysToReturn : null;

        // Recuperacao de nivel/variabilidade: olha pra uma janela de observacoes DEPOIS do retorno
        // (incluindo o proprio ponto de retorno), nunca reaproveitando pontos da propria excursao.
        const postReturnAllPoints = sorted.filter((p) => p.timestamp.getTime() >= returnPoint.timestamp.getTime());
        const postReturnWindow = postReturnAllPoints.slice(0, POST_RETURN_WINDOW_SIZE);
        const habitualDispersionForThisExcursion = this.dispersion(
          sorted.filter((p) => p.timestamp.getTime() < startMs),
          { kind: 'observation_count', size: sorted.length },
          true,
        );

        let levelRecovery: ReturnDynamics['levelRecovery'] = {
          evaluated: false,
          recovered: null,
          postReturnLevel: null,
          habitualMedian: habitualDispersionForThisExcursion.median,
        };
        let variabilityRecovery: ReturnDynamics['variabilityRecovery'] = {
          evaluated: false,
          recovered: null,
          postReturnMad: null,
          habitualMad: habitualDispersionForThisExcursion.mad,
          ratio: null,
        };

        if (postReturnWindow.length >= 2) {
          const postReturnDispersion = this.dispersion(postReturnWindow, { kind: 'observation_count', size: POST_RETURN_WINDOW_SIZE }, postReturnWindow.length < POST_RETURN_WINDOW_SIZE);
          levelRecovery = {
            evaluated: true,
            postReturnLevel: postReturnDispersion.median,
            habitualMedian: habitualDispersionForThisExcursion.median,
            recovered:
              postReturnDispersion.median != null && bounds.lower != null && bounds.upper != null
                ? postReturnDispersion.median >= bounds.lower - LEVEL_RECOVERY_UNIT_TOLERANCE &&
                  postReturnDispersion.median <= bounds.upper + LEVEL_RECOVERY_UNIT_TOLERANCE
                : null,
          };
          const ratio =
            postReturnDispersion.mad != null && habitualDispersionForThisExcursion.mad != null && habitualDispersionForThisExcursion.mad !== 0
              ? postReturnDispersion.mad / habitualDispersionForThisExcursion.mad
              : postReturnDispersion.mad === 0 && habitualDispersionForThisExcursion.mad === 0
                ? 1
                : null;
          variabilityRecovery = {
            evaluated: true,
            postReturnMad: postReturnDispersion.mad,
            habitualMad: habitualDispersionForThisExcursion.mad,
            ratio,
            recovered: ratio != null ? ratio <= VARIABILITY_RECOVERY_RATIO_TOLERANCE : null,
          };
        }

        exc.returnDynamics = {
          returned: true,
          returnTimestamp: returnPoint.timestamp.toISOString(),
          timeToReturnDays: daysToReturn,
          observationsToReturn: exc.observationCount,
          returnVelocity,
          overshoot: null,
          levelRecovery,
          variabilityRecovery,
        };
      } else {
        // Proxima excursao e' de direcao oposta, sem passar observavelmente por dentro da faixa —
        // isso E' o overshoot: o "retorno" ultrapassou direto pro outro lado.
        const nextExcursionIndex = outsideSegments.findIndex((s) => s === nextSegment);
        const nextExcursion = excursionsRaw[nextExcursionIndex];
        exc.returnDynamics = {
          returned: false,
          returnTimestamp: null,
          timeToReturnDays: null,
          observationsToReturn: exc.observationCount,
          returnVelocity: null,
          overshoot: nextExcursion
            ? { occurred: true, direction: nextExcursion.direction, magnitude: nextExcursion.magnitude }
            : { occurred: false },
          levelRecovery: { evaluated: false, recovered: null, postReturnLevel: null, habitualMedian: null },
          variabilityRecovery: { evaluated: false, recovered: null, postReturnMad: null, habitualMad: null, ratio: null },
        };
      }
    }

    return excursionsRaw;
  }

  /** Estado ATUAL de afastamento da faixa habitual (derivado da ultima excursao, se estiver em curso). */
  persistence(series: SeriesPoint[], bounds: HabitualBounds): PersistenceResult {
    if (series.length === 0 || bounds.lower == null || bounds.upper == null) {
      return { currentlyOutsideHabitualRange: null, direction: null, startTimestamp: null, durationDays: null, observationCount: null };
    }
    const all = this.excursions(series, bounds);
    const last = all[all.length - 1];
    if (last && last.ongoing) {
      return {
        currentlyOutsideHabitualRange: true,
        direction: last.direction,
        startTimestamp: last.startTimestamp,
        durationDays: last.durationDays,
        observationCount: last.observationCount,
      };
    }
    return { currentlyOutsideHabitualRange: false, direction: null, startTimestamp: null, durationDays: null, observationCount: null };
  }
}
