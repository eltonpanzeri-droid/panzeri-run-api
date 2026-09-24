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
  mean: { value: number | null; n: number } | null;
  movingAverages: Record<string, ReturnType<MathLayerService['movingAverage']>> | null;
  baseline: ReturnType<MathLayerService['baseline']> | null;
  deviation: ReturnType<MathLayerService['deviation']> | null;
  trend: Record<string, ReturnType<MathLayerService['trend']>> | null;
  /**
   * Rastro ate o registro original (ver auditoria, item 10: "preserve a possibilidade de chegar
   * ao registro original"). Cada entrada e' a observacao bruta usada nos calculos acima, com o
   * mesmo context (sessionId/workoutCompletionId/checkinId) que ObservationReaderService anexou —
   * nada aqui e' recalculado, e' o mesmo dado que entrou no MathLayer.
   */
  observations: Array<{
    timestamp: string;
    value: number;
    instrumentVersion: number;
    context: Observation['context'];
  }>;
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
  ) {}

  async getVariableSnapshot(athleteId: string, variableId: string): Promise<VariableSnapshotResponse> {
    const definition = getVariableDefinition(variableId);
    if (!definition) {
      throw new NotFoundException(`Variavel desconhecida no VariableRegistry: ${variableId}`);
    }

    const observations = await this.observationReader.getObservations(athleteId, variableId);
    const evidence = this.buildEvidence(observations, definition);
    const traceable = this.describeObservations(observations);

    if (definition.allowedMathStrategy !== 'ordinal_or_continuous_stats') {
      return {
        variable: this.describeVariable(definition),
        mathApplicable: false,
        mathSkippedReason:
          `Variavel categorica ('${definition.dataType}') — MathLayer desta rodada so cobre ` +
          'ordinal_scale/numeric_continuous (ver variable-registry.ts).',
        current: null,
        mean: null,
        movingAverages: null,
        baseline: null,
        deviation: null,
        trend: null,
        observations: traceable,
        evidence,
      };
    }

    const series: SeriesPoint[] = observations
      .map((o) => ({ value: o.value, timestamp: o.timestamp }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const current = series.length > 0 ? series[series.length - 1].value : null;
    const mean = this.mathLayer.periodMean(series);

    const movingAverages: VariableSnapshotResponse['movingAverages'] = {};
    for (const [label, window] of Object.entries(DEFAULT_MOVING_AVERAGE_WINDOWS)) {
      movingAverages[label] = this.mathLayer.movingAverage(series, window);
    }

    const baselineResult = this.mathLayer.baseline(series, BASELINE_WINDOW);
    const deviationResult = this.mathLayer.deviation(current, baselineResult.value);

    const trend: VariableSnapshotResponse['trend'] = {};
    for (const [label, window] of Object.entries(TREND_WINDOWS)) {
      trend[label] = this.mathLayer.trend(series, window);
    }

    return {
      variable: this.describeVariable(definition),
      mathApplicable: true,
      current,
      mean,
      movingAverages,
      baseline: baselineResult,
      deviation: deviationResult,
      trend,
      observations: traceable,
      evidence,
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
