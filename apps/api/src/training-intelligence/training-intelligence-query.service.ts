// TrainingIntelligenceQueryService — orquestra ObservationReader + MathLayer pra responder
// "como esta essa variavel, pra esse aluno, ate agora": o endpoint de validacao ponta a ponta
// pedido na auditoria (Prisma -> ObservationReader -> MathLayer -> resposta estruturada).
//
// Nao decide nada sobre prescricao/interpretacao — so descreve os dados. Variaveis categoricas
// (ex: painFlag) retornam as observacoes mas sem estatisticas numericas (MathLayer nesta rodada
// so cobre ordinal_scale/numeric_continuous — ver variable-registry.ts).

import { Injectable, NotFoundException } from '@nestjs/common';
import { ObservationReaderService, Observation } from './observation-reader.service';
import { MathLayerService, SeriesPoint, WindowSpec } from './math-layer.service';
import {
  LongitudinalDynamicsService,
  DispersionResult,
  HabitualRangeResult,
  VariabilityChangeResult,
  PersistenceResult,
  Excursion,
  HistoricalReturnBehavior,
} from './longitudinal-dynamics.service';
import { getVariableDefinition, VariableDefinition } from './variable-registry';

export interface VariableSnapshotResponse {
  variable: {
    id: string;
    domain: string;
    dataType: string;
    constructLabel?: string;
    scale?: { min: number; max: number; unit?: string };
    direction: string;
  };
  mathApplicable: boolean;
  mathSkippedReason?: string;
  current: number | null;
  /**
   * Auditoria Astra (29/09/2026), item 20 — metadados do context da observacao mais recente
   * (numerator/denominator/coveragePercent/isPartialWeek), usados hoje so por variaveis de
   * training_load (ver observation-reader.service.ts). Distinto de `isPartialWindow` (que descreve
   * a JANELA HISTORICA usada pra media/tendencia, ex: media movel de 21 dias com so 10 dias de
   * dado) — isto aqui descreve se a PROPRIA semana mais recente (o "current") ja terminou ou ainda
   * esta em andamento. As duas coisas sao reais e independentes: uma semana pode estar completa
   * (isPartialWeek=false) dentro de uma janela historica parcial (isPartialWindow=true), ou o
   * contrario. Null quando a variavel nao carrega esse context (a imensa maioria).
   */
  currentWeekContext?: {
    isPartialWeek: boolean;
    numerator: number | null;
    denominator: number | null;
    coveragePercent: number | null;
  } | null;
  mean: { value: number | null; n: number } | null;
  movingAverages: Record<string, ReturnType<MathLayerService['movingAverage']>> | null;
  /**
   * Serie da media movel (25/09/2026, Visualizacao Longitudinal) — mesma funcao movingAverage(),
   * reaplicada com asOf em cada data de observacao. `movingAverages` acima e' so' o valor ATUAL
   * (asOf = ultima observacao); isto aqui e' a curva inteira, pra plotar MM21/60/200 como linha ao
   * longo do tempo, nao so' um ponto. Nenhuma formula nova — mesma janela, mesmo calculo, reaplicado.
   */
  movingAverageSeries: Record<string, Array<{ timestamp: string; value: number | null; isPartialWindow: boolean }>> | null;
  baseline: ReturnType<MathLayerService['baseline']> | null;
  deviation: ReturnType<MathLayerService['deviation']> | null;
  trend: Record<string, ReturnType<MathLayerService['trend']>> | null;
  /**
   * Segundo bloco da Camada Matematica Longitudinal (24/09/2026) — dinamica longitudinal: quanto a
   * variavel oscila, se isso mudou, se ela saiu da faixa habitual e como se comportou ao retornar.
   * Tudo null quando variabilityStrategy da variavel e' 'not_applicable' (variaveis categoricas).
   */
  variability: Record<string, DispersionResult> | null;
  habitualRange: HabitualRangeResult | null;
  variabilityChange: VariabilityChangeResult | null;
  persistence: PersistenceResult | null;
  excursions: Excursion[] | null;
  /**
   * Bloco 2 (04/10/2026) — comportamento HISTORICO de retorno desta variavel, derivado dos proprios
   * `excursions` acima (nunca uma segunda fonte de verdade). Null exatamente quando `excursions` e
   * null (variavel categorica).
   */
  excursionHistory: HistoricalReturnBehavior | null;
  /**
   * Rastro ate o registro original (ver auditoria, item 10: "preserve a possibilidade de chegar
   * ao registro original"). Cada entrada e' a observacao bruta usada nos calculos acima, com o
   * mesmo context (sessionId/workoutCompletionId/checkinId) que ObservationReaderService anexou —
   * nada aqui e' recalculado, e' o mesmo dado que entrou no MathLayer.
   */
  observations: Array<{
    timestamp: string;
    // Auditoria Astra (29/09/2026), item 17: categorica (ex: workout.painFlag) carrega a categoria
    // como string aqui — nunca inventa numero pra ela (ver Observation.value).
    value: number | string;
    instrumentVersion: number;
    context: Observation['context'];
  }>;
  /** Modalidades presentes no historico COMPLETO (nao filtrado) desta variavel — pra montar o seletor. Vazio quando a variavel nao tem dimensao de modalidade (ex: checkin.* semanal). */
  availableModalities: string[];
  evidence: {
    n: number;
    observedSpan: { from: string | null; to: string | null };
    lastObservationAt: string | null;
    instrumentVersions: number[];
    comparabilityWarning: string | null;
  };
}

// Janelas padrao sugeridas pela Camada Matematica Longitudinal (secao de horizontes multiplos) —
// nao sao hardcode definitivo, sao o default desta primeira rodada; qualquer consumidor futuro pode
// pedir outras janelas chamando MathLayerService diretamente.
const DEFAULT_MOVING_AVERAGE_WINDOWS: Record<string, WindowSpec> = {
  short_21d: { kind: 'calendar_days', size: 21 },
  medium_60d: { kind: 'calendar_days', size: 60 },
  long_200d: { kind: 'calendar_days', size: 200 },
};
const BASELINE_WINDOW: WindowSpec = DEFAULT_MOVING_AVERAGE_WINDOWS.long_200d;
const TREND_WINDOWS: Record<string, WindowSpec> = {
  short_21d: DEFAULT_MOVING_AVERAGE_WINDOWS.short_21d,
  medium_60d: DEFAULT_MOVING_AVERAGE_WINDOWS.medium_60d,
};

@Injectable()
export class TrainingIntelligenceQueryService {
  constructor(
    private readonly observationReader: ObservationReaderService,
    private readonly mathLayer: MathLayerService,
    private readonly longitudinalDynamics: LongitudinalDynamicsService,
  ) {}

  /**
   * `modalities` (25/09/2026, Exploração Longitudinal) — filtro opcional por modalidade de sessão
   * (corrida/forca/fortalecimento_corredores/...), aplicado ANTES de qualquer calculo. Nao e' uma
   * segunda matematica: e' a MESMA pipeline (mean/movingAverage/baseline/trend/dispersion/
   * habitualRange/excursions), so' que sobre um subconjunto das observacoes escolhido pelo
   * treinador — pedido explicito (RPE de corrida e RPE de musculacao sao coisas distintas, misturar
   * os dois numa unica media/baseline seria uma composicao silenciosa). Variaveis sem dimensao de
   * modalidade (ex: checkin.* semanal, sem context.modality) ignoram o filtro.
   */
  async getVariableSnapshot(athleteId: string, variableId: string, modalities?: string[]): Promise<VariableSnapshotResponse> {
    const definition = getVariableDefinition(variableId);
    if (!definition) {
      throw new NotFoundException(`Variavel desconhecida no VariableRegistry: ${variableId}`);
    }

    const allObservations = await this.observationReader.getObservations(athleteId, variableId);
    const hasModalityDimension = allObservations.some((o) => o.context.modality != null);
    // 27/09/2026 (bug real achado validando Volume/Aderência/ACWR): algumas variáveis (ver
    // training_load em observation-reader.service.ts) precisam de um total GLOBAL genuinamente
    // recombinado (ex: aderência da semana somando corrida+força juntas), que é DIFERENTE de
    // qualquer modalidade isolada — não é só "não filtrar". Essas variáveis marcam essa entrada
    // combinada com context.modality==='global' (uma modalidade reservada, nunca uma real).
    // SEM filtro explícito de modalidade, essa é a série correta a usar (nunca a mistura de tudo).
    // Variáveis que nunca usam essa convenção (ex: RPE, onde cada sessão já tem UMA modalidade real
    // e "Global" = todas as sessões juntas sem filtro) continuam exatamente como antes — este branch
    // só existe quando 'global' está de fato presente.
    const hasExplicitGlobalTag = allObservations.some((o) => o.context.modality === 'global');
    const observations =
      modalities && modalities.length > 0 && hasModalityDimension
        ? allObservations.filter((o) => o.context.modality != null && modalities.includes(o.context.modality))
        : hasExplicitGlobalTag
          ? allObservations.filter((o) => o.context.modality === 'global')
          : allObservations;
    const availableModalities = [...new Set(allObservations.map((o) => o.context.modality).filter((m): m is string => m != null && m !== 'global'))].sort();
    const evidence = this.buildEvidence(observations, definition);
    const traceable = this.describeObservations(observations);
    const currentWeekContext = this.extractCurrentWeekContext(observations);

    if (definition.allowedMathStrategy !== 'ordinal_or_continuous_stats') {
      return {
        variable: this.describeVariable(definition),
        mathApplicable: false,
        mathSkippedReason:
          `Variavel categorica ('${definition.dataType}') — MathLayer desta rodada so cobre ` +
          'ordinal_scale/numeric_continuous (ver variable-registry.ts).',
        current: null,
        currentWeekContext,
        mean: null,
        movingAverages: null,
        movingAverageSeries: null,
        baseline: null,
        deviation: null,
        trend: null,
        variability: null,
        habitualRange: null,
        variabilityChange: null,
        persistence: null,
        excursions: null,
        excursionHistory: null,
        observations: traceable,
        availableModalities,
        evidence,
      };
    }

    // Chegamos aqui so quando allowedMathStrategy === 'ordinal_or_continuous_stats' (o branch
    // categorico ja retornou acima) — o.value e' sempre number nesse caso, nunca string. O filtro
    // abaixo e' so uma guarda de tipo, nao uma decisao de negocio nova.
    const series: SeriesPoint[] = observations
      .filter((o): o is Observation & { value: number } => typeof o.value === 'number')
      .map((o) => ({ value: o.value, timestamp: o.timestamp }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const current = series.length > 0 ? series[series.length - 1].value : null;
    const mean = this.mathLayer.periodMean(series);

    const movingAverages: VariableSnapshotResponse['movingAverages'] = {};
    const movingAverageSeries: VariableSnapshotResponse['movingAverageSeries'] = {};
    for (const [label, window] of Object.entries(DEFAULT_MOVING_AVERAGE_WINDOWS)) {
      movingAverages[label] = this.mathLayer.movingAverage(series, window);
      movingAverageSeries[label] = series.map((point) => {
        const atPoint = this.mathLayer.movingAverage(series, window, point.timestamp);
        return { timestamp: point.timestamp.toISOString(), value: atPoint.value, isPartialWindow: atPoint.isPartialWindow };
      });
    }

    const baselineResult = this.mathLayer.baseline(series, BASELINE_WINDOW);
    const deviationResult = this.mathLayer.deviation(current, baselineResult.value);

    const trend: VariableSnapshotResponse['trend'] = {};
    for (const [label, window] of Object.entries(TREND_WINDOWS)) {
      trend[label] = this.mathLayer.trend(series, window);
    }

    // Dinamica longitudinal (variabilidade/faixa habitual/persistencia/excursao/retorno). So
    // chegamos neste ramo quando allowedMathStrategy === 'ordinal_or_continuous_stats', que e'
    // exatamente a condicao que getVariabilityStrategy() (variable-registry.ts) mapeia pra
    // 'robust_distributional' — por isso a estrategia esta implicitamente garantida aqui.
    const variability: VariableSnapshotResponse['variability'] = {};
    for (const [label, window] of Object.entries(DEFAULT_MOVING_AVERAGE_WINDOWS)) {
      variability[label] = this.longitudinalDynamics.dispersionForWindow(series, window);
    }

    const habitualRangeResult = this.longitudinalDynamics.habitualRange(series, BASELINE_WINDOW);
    const variabilityChangeResult = this.longitudinalDynamics.variabilityChange(
      series,
      DEFAULT_MOVING_AVERAGE_WINDOWS.short_21d,
      BASELINE_WINDOW,
    );
    const bounds = { lower: habitualRangeResult.lower, upper: habitualRangeResult.upper };
    const persistenceResult = this.longitudinalDynamics.persistence(series, bounds);
    const excursionsResult = this.longitudinalDynamics.excursions(series, bounds);
    const excursionHistoryResult = this.longitudinalDynamics.historicalReturnBehavior(excursionsResult);

    return {
      variable: this.describeVariable(definition),
      mathApplicable: true,
      current,
      currentWeekContext,
      mean,
      movingAverages,
      movingAverageSeries,
      baseline: baselineResult,
      deviation: deviationResult,
      trend,
      variability,
      habitualRange: habitualRangeResult,
      variabilityChange: variabilityChangeResult,
      persistence: persistenceResult,
      excursions: excursionsResult,
      excursionHistory: excursionHistoryResult,
      observations: traceable,
      availableModalities,
      evidence,
    };
  }

  /**
   * Auditoria Astra (29/09/2026), item 20 — extrai os metadados de numerator/denominator/
   * coveragePercent/isPartialWeek da observacao MAIS RECENTE (a que corresponde a `current`).
   * So' variaveis de training_load carregam esse context (ver observation-reader.service.ts);
   * pra qualquer outra variavel isso e' sempre null, sem custo de calculo extra — e' so' leitura
   * de um campo que ja existia no context da observacao.
   */
  private extractCurrentWeekContext(observations: Observation[]): VariableSnapshotResponse['currentWeekContext'] {
    if (observations.length === 0) return null;
    const mostRecent = [...observations].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).at(-1)!;
    const { isPartialWeek, numerator, denominator, coveragePercent } = mostRecent.context;
    if (isPartialWeek === undefined && numerator === undefined && denominator === undefined && coveragePercent === undefined) {
      return null;
    }
    return {
      isPartialWeek: isPartialWeek ?? false,
      numerator: numerator ?? null,
      denominator: denominator ?? null,
      coveragePercent: coveragePercent ?? null,
    };
  }

  private describeObservations(observations: Observation[]): VariableSnapshotResponse['observations'] {
    return [...observations]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((o) => ({
        timestamp: o.timestamp.toISOString(),
        value: o.value,
        instrumentVersion: o.instrumentVersion,
        context: o.context,
      }));
  }

  private describeVariable(definition: VariableDefinition): VariableSnapshotResponse['variable'] {
    return {
      id: definition.variableId,
      domain: definition.domain,
      dataType: definition.dataType,
      constructLabel: definition.constructLabel,
      scale: definition.scale,
      direction: definition.direction,
    };
  }

  private buildEvidence(
    observations: Observation[],
    definition: VariableDefinition,
  ): VariableSnapshotResponse['evidence'] {
    const sorted = [...observations].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const instrumentVersions = [...new Set(sorted.map((o) => o.instrumentVersion))].sort((a, b) => a - b);

    const comparabilityWarning =
      definition.versionComparability === 'not_comparable_across_versions' && instrumentVersions.length > 1
        ? `Esta serie mistura versoes de instrumento (${instrumentVersions.join(', ')}) que NAO sao ` +
          `semanticamente comparaveis (ver notas de '${definition.variableId}' no VariableRegistry). ` +
          'Os calculos acima tratam todos os pontos igualmente — considere isso antes de interpretar tendencia/baseline.'
        : null;

    return {
      n: sorted.length,
      observedSpan: {
        from: sorted[0]?.timestamp.toISOString() ?? null,
        to: sorted[sorted.length - 1]?.timestamp.toISOString() ?? null,
      },
      lastObservationAt: sorted[sorted.length - 1]?.timestamp.toISOString() ?? null,
      instrumentVersions,
      comparabilityWarning,
    };
  }
}
