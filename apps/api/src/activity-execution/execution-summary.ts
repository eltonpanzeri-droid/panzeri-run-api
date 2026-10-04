import type { SegmentSummary } from './activity-segments';

// Resumo deterministico pos-treino (Melhorias pos-Blocos 1/3/4, 04/10/2026): so diferencas
// NUMERICAS objetivas entre prescricao e execucao, calculadas a partir de dados ja existentes
// (ActivityLog + TrainingSession + prescribedSegments, ja montados por ActivityDetailService).
// Nenhum LLM, score, ou classificacao de qualidade — apenas subtracao. Estruturado para ser
// consumido futuramente pelo contexto longitudinal/Training Intelligence, sem criar integracao
// com agentes nesta rodada (so expoe o campo).
//
// "Null nao e' zero": toda diferenca so' existe quando AMBOS os lados (prescrito e realizado) sao
// conhecidos; caso contrario fica null, nunca 0.

export interface ExecutionSummary {
  distance: { prescribedKm: number | null; realizedKm: number | null; deltaKm: number | null };
  duration: { prescribedSec: number | null; realizedSec: number | null; deltaSec: number | null };
  // Faixa de pace prescrita "geral" so' existe quando a prescricao e' um unico bloco (sem
  // segmentacao em partes/intervalos) — com multiplos segmentos a comparacao relevante e' por
  // segmento (ver `segments` abaixo); nunca fabrica uma faixa combinada que a prescricao nao define.
  pace: {
    prescribedFastSecondsKm: number | null;
    prescribedSlowSecondsKm: number | null;
    realizedSecondsKm: number | null;
    deltaVsFastSecondsKm: number | null;
    deltaVsSlowSecondsKm: number | null;
  };
  segments: Array<{
    index: number;
    label: string;
    prescribedDistanceKm: number;
    realizedDistanceKm: number | null;
    deltaDistanceKm: number | null;
    prescribedPaceFastSecondsKm: number | null;
    prescribedPaceSlowSecondsKm: number | null;
    realizedPaceSecondsKm: number | null;
    deltaPaceVsFastSecondsKm: number | null;
    deltaPaceVsSlowSecondsKm: number | null;
  }>;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function delta(realized: number | null, prescribed: number | null): number | null {
  return realized != null && prescribed != null ? round2(realized - prescribed) : null;
}

export function buildExecutionSummary(params: {
  prescribedDistanceKm: number | null;
  prescribedDurationMin: number | null;
  realizedDistanceKm: number | null;
  realizedDurationSec: number | null;
  realizedPaceSecondsKm: number | null;
  segments: SegmentSummary[];
}): ExecutionSummary | null {
  const { prescribedDistanceKm, prescribedDurationMin, realizedDistanceKm, realizedDurationSec, realizedPaceSecondsKm, segments } = params;
  if (prescribedDistanceKm == null && prescribedDurationMin == null && segments.length === 0) return null;

  const prescribedDurationSec = prescribedDurationMin != null ? prescribedDurationMin * 60 : null;
  const singleSegmentPace = segments.length === 1 ? segments[0] : null;

  return {
    distance: {
      prescribedKm: prescribedDistanceKm,
      realizedKm: realizedDistanceKm,
      deltaKm: delta(realizedDistanceKm, prescribedDistanceKm),
    },
    duration: {
      prescribedSec: prescribedDurationSec,
      realizedSec: realizedDurationSec,
      deltaSec: delta(realizedDurationSec, prescribedDurationSec),
    },
    pace: {
      prescribedFastSecondsKm: singleSegmentPace?.paceFastSecondsKm ?? null,
      prescribedSlowSecondsKm: singleSegmentPace?.paceSlowSecondsKm ?? null,
      realizedSecondsKm: realizedPaceSecondsKm,
      deltaVsFastSecondsKm: delta(realizedPaceSecondsKm, singleSegmentPace?.paceFastSecondsKm ?? null),
      deltaVsSlowSecondsKm: delta(realizedPaceSecondsKm, singleSegmentPace?.paceSlowSecondsKm ?? null),
    },
    segments: segments.map((segment) => {
      const prescribedDistance = round2(segment.endKm - segment.startKm);
      const realizedDistance = segment.realized?.distanceKm ?? null;
      const realizedPace = segment.realized?.paceSecondsKm ?? null;
      return {
        index: segment.index,
        label: segment.label,
        prescribedDistanceKm: prescribedDistance,
        realizedDistanceKm: realizedDistance,
        deltaDistanceKm: delta(realizedDistance, prescribedDistance),
        prescribedPaceFastSecondsKm: segment.paceFastSecondsKm,
        prescribedPaceSlowSecondsKm: segment.paceSlowSecondsKm,
        realizedPaceSecondsKm: realizedPace,
        deltaPaceVsFastSecondsKm: delta(realizedPace, segment.paceFastSecondsKm),
        deltaPaceVsSlowSecondsKm: delta(realizedPace, segment.paceSlowSecondsKm),
      };
    }),
  };
}
