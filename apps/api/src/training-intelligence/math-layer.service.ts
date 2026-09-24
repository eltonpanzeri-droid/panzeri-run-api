// MathLayerService — camada matematica deterministica, fora do LLM (ver principio da prescricao no
// CLAUDE.md e secao 5 da DIRETRIZ_MESTRA_TRAINING_INTELLIGENCE.md).
//
// Escopo desta primeira rodada (ver CAMADA_MATEMATICA_LONGITUDINAL.md): media do periodo, media
// movel parametrizavel, baseline, desvio, tendencia. NAO implementa ainda variabilidade, faixa
// habitual, persistencia, excursao/retorno, recuperacao — mas a interface (SeriesPoint, WindowSpec,
// selectWindow) foi desenhada pra essas funcoes futuras se conectarem sem redesenho: qualquer
// analise sobre uma janela de observacoes passa por selectWindow(), e o resultado sempre carrega
// `n` e `isPartialWindow` (metadado de confianca), nunca so' um numero puro.
//
// Regra dura: nenhuma funcao aqui decide prescricao, carga ou "o que fazer" — apenas descreve o que
// os dados mostram. Interpretacao contextual continua sendo do agente de IA (ver Principio da
// Prescricao no CLAUDE.md).

import { Injectable } from '@nestjs/common';

export interface SeriesPoint {
  value: number;
  timestamp: Date;
}

/**
 * Janela cronologica (dias corridos) OU por contagem de observacoes — duas nocoes distintas
 * (ver CAMADA_MATEMATICA_LONGITUDINAL.md, "janela cronologica vs janela por numero de observacoes").
 */
export type WindowSpec =
  | { kind: 'calendar_days'; size: number }
  | { kind: 'observation_count'; size: number };

export interface PeriodSpec {
  from: Date;
  to: Date;
}

export interface WindowSelection {
  points: SeriesPoint[];
  window: WindowSpec;
  n: number;
  /** true quando a janela pedida e' maior do que o historico disponivel (dias ou observacoes). */
  isPartialWindow: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
}

export interface MeanResult {
  value: number | null;
  n: number;
}

export interface MovingAverageResult {
  window: WindowSpec;
  value: number | null;
  n: number;
  isPartialWindow: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
}

export type BaselineResult = MovingAverageResult;

export interface DeviationResult {
  current: number | null;
  baseline: number | null;
  absoluteDeviation: number | null;
  /** (current - baseline) / baseline. Null quando baseline e' null, 0 ou current e' null. */
  relativeDeviation: number | null;
}

export interface TrendResult {
  direction: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data';
  /** Inclinacao da regressao linear simples, em unidades da variavel por dia. Null se n < 2. */
  slopePerDay: number | null;
  window: WindowSpec;
  n: number;
}

/** Abaixo desta magnitude de inclinacao*dias a tendencia e' considerada estavel, nao um viezes numerico. */
const TREND_STABILITY_EPSILON_RATIO = 0.05; // 5% da amplitude observada na janela

@Injectable()
export class MathLayerService {
  /**
   * Seleciona os pontos de uma janela a partir de uma data de referencia (asOf, default = ultimo
   * ponto da serie). Primitiva unica reutilizada por movingAverage/baseline/trend hoje, e pelas
   * futuras (variabilidade, persistencia, excursao) sem precisar reimplementar windowing.
   */
  selectWindow(series: SeriesPoint[], window: WindowSpec, asOf?: Date): WindowSelection {
    const sorted = [...series].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (sorted.length === 0) {
      return { points: [], window, n: 0, isPartialWindow: true, windowStart: null, windowEnd: null };
    }
    const referenceDate = asOf ?? sorted[sorted.length - 1].timestamp;
    const upToReference = sorted.filter((p) => p.timestamp.getTime() <= referenceDate.getTime());

    if (window.kind === 'observation_count') {
      const points = upToReference.slice(-window.size);
      return {
        points,
        window,
        n: points.length,
        isPartialWindow: points.length < window.size,
        windowStart: points[0]?.timestamp ?? null,
        windowEnd: points[points.length - 1]?.timestamp ?? null,
      };
    }

    // calendar_days
    const windowStartMs = referenceDate.getTime() - window.size * 24 * 60 * 60 * 1000;
    const points = upToReference.filter((p) => p.timestamp.getTime() > windowStartMs);
    const earliestAvailable = sorted[0].timestamp.getTime();
    const isPartialWindow = earliestAvailable > windowStartMs;
    return {
      points,
      window,
      n: points.length,
      isPartialWindow,
      windowStart: points[0]?.timestamp ?? (points.length ? points[0].timestamp : null),
      windowEnd: points[points.length - 1]?.timestamp ?? null,
    };
  }

  /** Media simples de todos os pontos dentro de um periodo opcional (sem periodo = serie inteira). */
  periodMean(series: SeriesPoint[], period?: PeriodSpec): MeanResult {
    const points = period
      ? series.filter((p) => p.timestamp >= period.from && p.timestamp <= period.to)
      : series;
    if (points.length === 0) return { value: null, n: 0 };
    const sum = points.reduce((acc, p) => acc + p.value, 0);
    return { value: sum / points.length, n: points.length };
  }

  /** Media movel parametrizavel (cronologica ou por contagem), calculada a partir de asOf. */
  movingAverage(series: SeriesPoint[], window: WindowSpec, asOf?: Date): MovingAverageResult {
    const selection = this.selectWindow(series, window, asOf);
    const value =
      selection.points.length > 0
        ? selection.points.reduce((acc, p) => acc + p.value, 0) / selection.points.length
        : null;
    return {
      window: selection.window,
      value,
      n: selection.n,
      isPartialWindow: selection.isPartialWindow,
      windowStart: selection.windowStart,
      windowEnd: selection.windowEnd,
    };
  }

  /**
   * Baseline individual — mecanicamente identico a uma media movel, mas semanticamente distinto:
   * representa "o que e' normal para este atleta especifico", tipicamente numa janela mais longa.
   * Mantido como funcao propria (nao apenas um alias) porque baselines futuros podem incorporar
   * ponderacao/robustez que uma media movel simples nao usa.
   */
  baseline(series: SeriesPoint[], window: WindowSpec, asOf?: Date): BaselineResult {
    return this.movingAverage(series, window, asOf);
  }

  /** Desvio do valor atual em relacao a um baseline ja calculado. */
  deviation(current: number | null, baselineValue: number | null): DeviationResult {
    if (current == null || baselineValue == null) {
      return { current, baseline: baselineValue, absoluteDeviation: null, relativeDeviation: null };
    }
    const absoluteDeviation = current - baselineValue;
    const relativeDeviation = baselineValue !== 0 ? absoluteDeviation / baselineValue : null;
    return { current, baseline: baselineValue, absoluteDeviation, relativeDeviation };
  }

  /**
   * Tendencia por regressao linear simples (minimos quadrados) sobre a janela selecionada.
   * `stable` quando a variacao total estimada na janela e' pequena em relacao a amplitude
   * observada (evita chamar de "tendencia" um ruido numerico insignificante).
   */
  trend(series: SeriesPoint[], window: WindowSpec, asOf?: Date): TrendResult {
    const selection = this.selectWindow(series, window, asOf);
    const points = selection.points;
    if (points.length < 2) {
      return { direction: 'insufficient_data', slopePerDay: null, window: selection.window, n: points.length };
    }

    const t0 = points[0].timestamp.getTime();
    const xs = points.map((p) => (p.timestamp.getTime() - t0) / (24 * 60 * 60 * 1000)); // dias desde o primeiro ponto
    const ys = points.map((p) => p.value);
    const n = points.length;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
    const sumXX = xs.reduce((acc, x) => acc + x * x, 0);
    const denominator = n * sumXX - sumX * sumX;

    if (denominator === 0) {
      // Todos os pontos no mesmo instante (ou janela degenerada) — sem base temporal pra inclinacao.
      return { direction: 'insufficient_data', slopePerDay: null, window: selection.window, n };
    }

    const slopePerDay = (n * sumXY - sumX * sumY) / denominator;
    const totalSpanDays = xs[xs.length - 1] - xs[0];
    const estimatedTotalChange = slopePerDay * totalSpanDays;
    const amplitude = Math.max(...ys) - Math.min(...ys);
    const epsilon = amplitude > 0 ? amplitude * TREND_STABILITY_EPSILON_RATIO : 0.01;

    const direction =
      Math.abs(estimatedTotalChange) < epsilon
        ? 'stable'
        : estimatedTotalChange > 0
          ? 'increasing'
          : 'decreasing';

    return { direction, slopePerDay, window: selection.window, n };
  }
}
