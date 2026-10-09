// Contexto longitudinal do atleta (CompactAgentContext) com a FORMA REAL: agregados de atividade de dispositivo (activity.*) misturados a agregados de
// outras fontes (esforco percebido, check-in), com legenda, referencias de dominio, avisos de comparabilidade e quebra por modalidade. Valores sinteticos,
// escolhidos para serem inconfundiveis num texto (437.25, 171.6) e assim provar a exclusao.
export const DEVICE_PACE = 437.25;
export const DEVICE_CADENCE = 171.6;
export const OTHER_EFFORT = 6.4;

const evidence = (n: number, last: string) => ({ n, observedSpan: { from: '2026-04-01', to: last.slice(0, 10) }, lastObservationAt: last, instrumentVersions: [1], comparabilityWarning: null, isPartialWindow: false });

export function realisticAthleteContext() {
  return {
    athleteId: 'atleta-sintetico', generatedAt: '2026-10-12T15:00:00.000Z',
    variableLegend: {
      'activity.avgPaceSecondsKm': { constructLabel: 'ritmo medio da corrida (segundos por km)', scale: { min: 120, max: 1200, unit: 's/km' }, direction: 'not_directional' },
      'activity.cadenceAvg': { constructLabel: 'cadencia media da corrida', scale: { min: 60, max: 260, unit: 'spm' }, direction: 'not_directional' },
      'workout.perceivedEffort': { constructLabel: 'esforco percebido', scale: { min: 1, max: 10 }, direction: 'higher_is_more' },
    },
    variables: {
      'activity.avgPaceSecondsKm': {
        current: DEVICE_PACE, baseline: 441.5, trend: { recent: 'melhorando', mediumTerm: 'estavel' }, deviationFromBaseline: { absolute: -4.25, relative: -0.0096 },
        byModality: { corrida: { current: DEVICE_PACE, baseline: 441.5, evidence: evidence(14, '2026-10-09T08:00:00.000Z') } }, evidence: evidence(14, '2026-10-09T08:00:00.000Z'),
      },
      'activity.cadenceAvg': { current: DEVICE_CADENCE, baseline: 169.2, evidence: { ...evidence(9, '2026-10-08T08:00:00.000Z'), comparabilityWarning: 'trocou de dispositivo' } },
      'workout.perceivedEffort': { current: OTHER_EFFORT, baseline: 6.1, trend: { recent: 'estavel', mediumTerm: 'estavel' }, evidence: evidence(11, '2026-10-10T08:00:00.000Z') },
    },
    training: { availability: 'available', dataAvailableSince: '2026-04-01', totalWeeksWithPlan: 28 },
    trainingLoad: { availability: 'available', variableIds: ['activity.avgPaceSecondsKm', 'workout.perceivedEffort'] },
    behavior: { availability: 'available', variableIds: ['activity.cadenceAvg'], checkinsSubmittedAllTime: 4, checkinsSkippedAllTime: 0 },
    evidenceQuality: { variablesWithData: 3, variablesWithoutData: 0, mostRecentObservationAt: '2026-10-10T08:00:00.000Z', variablesWithComparabilityWarning: ['activity.cadenceAvg'] },
  };
}
