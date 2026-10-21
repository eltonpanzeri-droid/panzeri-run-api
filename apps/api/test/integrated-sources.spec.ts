import { buildCompactAgentContext } from '../src/training-intelligence/compact-agent-context';
import type { AthleteStateSnapshotV1 } from '../src/training-intelligence/athlete-state-snapshot.service';
import { buildPairedEvidence, EMPTY_PAIRED_EVIDENCE, PAIRED_EVIDENCE_NOTES } from '../src/training-intelligence/paired-evidence';
import { evidenceKindOf, VARIABLE_REGISTRY } from '../src/training-intelligence/variable-registry';
import { runWithAiScope } from '../src/ai-governance/ai-scope';
import { INTEGRATED_SOURCES_INSTRUCTION, PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';

// Fontes de natureza diferente lidas JUNTAS (21/10/2026): relato do aluno x medicao/estimativa do aparelho, com a natureza de cada informacao preservada, pareamento rastreavel e
// orientacao do aluno em linguagem simples. Dados sinteticos; nenhuma regra de prescricao e nenhum calculo novo (so' junta e rotula o que ja existe).

describe('natureza da evidencia (percepcao x medicao x estimativa x pontuacao x calculo)', () => {
  const kind = (id: string) => evidenceKindOf(VARIABLE_REGISTRY[id]);

  it('cada variavel carrega a natureza certa: o que o aluno relata nunca e tratado como medicao e vice-versa', () => {
    expect(kind('workout.perceivedEffort')).toBe('self_report');
    expect(kind('workout.preSleepQuality')).toBe('self_report');
    expect(kind('activity.cadenceAvg')).toBe('device_measurement');
    expect(kind('activity.powerAvgWatts')).toBe('device_measurement');
    expect(kind('execution.timeInBandPct')).toBe('system_calculation');
    expect(kind('training.adherencePercent')).toBe('system_calculation');
    expect(kind('wearable.sleepDeepMin')).toBe('device_estimate'); // etapas do sono = algoritmo do relogio
    expect(kind('wearable.sleepScore')).toBe('manufacturer_score');
    expect(kind('wearable.hrvLastNightAvg')).toBe('device_measurement');
    expect(kind('wearable.restingHeartRateBpm')).toBe('device_measurement');
    expect(kind('wearable.dailyActiveKcal')).toBe('device_estimate');
  });

  it('a legenda enviada a IA leva a natureza de cada variavel (uma vez por variavel, junto da semantica)', () => {
    const entry = (id: string) => ({ variable: { id, domain: 'sleep', dataType: 'numeric_continuous', constructLabel: id, scale: undefined, direction: 'not_directional' }, evidence: { n: 0, observedSpan: { from: null, to: null }, lastObservationAt: null, instrumentVersions: [], comparabilityWarning: null } }) as never;
    const snapshot = {
      athleteId: 'a1', generatedAt: '2026-10-21T00:00:00.000Z', compact: {},
      domains: {
        training: { availability: 'unavailable', dataAvailableSince: null, totalWeeksWithPlan: 0, adherence: null, consistency: null, modalityBreakdown: [], recentWeeks: [] },
        trainingLoad: { availability: 'unavailable', variables: {} },
        sleepRecovery: { availability: 'unavailable', variables: { 'workout.preSleepQuality': entry('workout.preSleepQuality'), 'wearable.sleepScore': entry('wearable.sleepScore'), 'wearable.sleepRemMin': entry('wearable.sleepRemMin') } },
        physicalState: { availability: 'unavailable', variables: {} },
        psychologicalState: { availability: 'unavailable', variables: {} },
        trainingResponse: { availability: 'unavailable', variables: {} },
        painHealth: { availability: 'unavailable' }, performanceCapacity: { availability: 'unavailable' },
        behavior: { availability: 'unavailable', variables: {}, adherence: null, consistency: null, checkinsSubmittedAllTime: 0, checkinsSkippedAllTime: 0 },
        lifeContext: { availability: 'unavailable' }, systemDynamics: { availability: 'unavailable', variablesCurrentlyOutsideHabitualRange: [], ongoingExcursions: [] },
      },
      evidenceQuality: { perVariable: {}, overall: { variablesWithData: 0, variablesWithoutData: 0, mostRecentObservationAt: null, variablesWithComparabilityWarning: [] } },
    } as unknown as AthleteStateSnapshotV1;
    const context = buildCompactAgentContext(snapshot);
    expect(context.variableLegend['workout.preSleepQuality'].evidenceKind).toBe('self_report');
    expect(context.variableLegend['wearable.sleepScore'].evidenceKind).toBe('manufacturer_score');
    expect(context.variableLegend['wearable.sleepRemMin'].evidenceKind).toBe('device_estimate');
    expect(context).not.toHaveProperty('pairedEvidence'); // sem nenhum par, o campo nem existe
    const withPairs = buildCompactAgentContext({ ...snapshot, pairedEvidence: { ...EMPTY_PAIRED_EVIDENCE, sleepPerceivedVsDevice: [{ date: '2026-10-20' } as never] } });
    expect(withPairs.pairedEvidence?.sleepPerceivedVsDevice).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
function makeDb(over: { completions?: any[]; logs?: any[]; summaries?: any[] } = {}) {
  return {
    workoutCompletion: { findMany: jest.fn(async () => over.completions ?? []) },
    nightlySleepLog: { findMany: jest.fn(async () => over.logs ?? []) },
    wearableSleepSummary: { findMany: jest.fn(async () => over.summaries ?? []) },
  };
}
const completion = (effort: number | null, link: any, extra: Record<string, unknown> = {}) => ({
  perceivedEffort: effort,
  session: { id: 's1', scheduledDate: new Date('2026-10-20T00:00:00Z'), modality: 'corrida', executionLinks: link ? [link] : [], ...extra },
});
const activity = (over: Record<string, unknown> = {}) => ({ provider: 'zepp', sport: 'corrida', durationSec: 3000, distanceMeters: 10000, avgHeartRateBpm: 171, powerAvgWatts: 240, cadenceAvg: 176, ...over });
const scope = (over: Record<string, unknown>) => ({ userId: 'u1', destination: 'external_ai' as const, blocked: [] as string[], blockedHealth: [] as string[], computedAt: Date.now(), ...over });

describe('evidencia pareada: esforco percebido x aparelho e sono percebido x relogio', () => {
  it('une o esforco percebido (relato) a FC, ritmo, potencia e cadencia (medicao) da MESMA sessao, rotulando a natureza e a confianca do vinculo', async () => {
    const db = makeDb({ completions: [completion(8, { origin: 'automatic', activityLog: activity() }), completion(6, { origin: 'student', activityLog: activity({ provider: 'polar' }) }, { id: 's2' })] });
    const paired = await buildPairedEvidence(db as never, 'u1');
    expect(paired.effortVsDevice).toHaveLength(2);
    expect(paired.effortVsDevice[0]).toMatchObject({
      date: '2026-10-20', sessionId: 's1', modality: 'corrida',
      perceivedEffort: { value: 8, scale: '1-10', kind: 'self_report' },
      device: { kind: 'device_measurement', provider: 'zepp', avgHeartRateBpm: 171, powerAvgWatts: 240, cadenceAvg: 176, distanceKm: 10, linkConfirmedByPerson: false },
    });
    expect(paired.effortVsDevice[0].device.avgPaceSecPerKm).toBe(300); // 3000 s / 10 km = 5:00/km (s/km; o aluno ve min/km)
    expect(paired.effortVsDevice[1].device.linkConfirmedByPerson).toBe(true); // confirmado pelo aluno
    expect(paired.notes).toEqual(PAIRED_EVIDENCE_NOTES);
  });

  it('nunca preenche o lado que falta: sem esforco, sem atividade vinculada ou com provedor fora do escopo de IA, nao ha par', async () => {
    const db = makeDb({ completions: [completion(null, { origin: 'automatic', activityLog: activity() }), completion(7, null), completion(5, { origin: 'automatic', activityLog: activity({ provider: 'zepp' }) })] });
    expect((await buildPairedEvidence(db as never, 'u1')).effortVsDevice).toHaveLength(1);
    await runWithAiScope(scope({ blocked: ['zepp'] }) as never, async () => expect((await buildPairedEvidence(db as never, 'u1')).effortVsDevice).toEqual([]));
    const sensorless = makeDb({ completions: [completion(9, { origin: 'automatic', activityLog: activity({ avgHeartRateBpm: null, powerAvgWatts: null, cadenceAvg: null }) })] });
    const pair = (await buildPairedEvidence(sensorless as never, 'u1')).effortVsDevice[0];
    expect(pair.device).toMatchObject({ avgHeartRateBpm: null, powerAvgWatts: null, cadenceAvg: null }); // sem sensor autorizado, fica nulo (nunca zero)
  });

  it('une a qualidade de sono PERCEBIDA ao sono do relogio na mesma data (duracao e etapas = estimativa, pontuacao = fabricante), sem arredondar', async () => {
    const db = makeDb({
      logs: [{ nightDate: new Date('2026-10-20T00:00:00Z'), sleepQuality: 2, sleepDurationCategory: '6_a_7h' }, { nightDate: new Date('2026-10-19T00:00:00Z'), sleepQuality: 4, sleepDurationCategory: null }],
      summaries: [
        { provider: 'zepp', calendarDate: '2026-10-20', durationSec: 23160, deepSleepSec: 4380, lightSleepSec: null, remSleepSec: 5700, awakeSec: 780, scoreValue: 64 },
        { provider: 'zepp', calendarDate: '2026-10-20', durationSec: 1200, deepSleepSec: 0, lightSleepSec: 1200, remSleepSec: 0, awakeSec: 0, scoreValue: 30 }, // cochilo curto no mesmo dia: vale a noite principal
      ],
    });
    const paired = await buildPairedEvidence(db as never, 'u1');
    expect(paired.sleepPerceivedVsDevice).toHaveLength(1); // 19/10 nao tem sono do relogio: sem par
    expect(paired.sleepPerceivedVsDevice[0]).toMatchObject({
      date: '2026-10-20',
      perceived: { kind: 'self_report', sleepQuality: 2, sleepDurationCategory: '6_a_7h' },
      device: { provider: 'zepp', durationMin: 23160 / 60, deepMin: 4380 / 60, lightMin: null, remMin: 5700 / 60, score: 64, durationAndStagesKind: 'device_estimate', scoreKind: 'manufacturer_score' },
    });
  });

  it('sono de categoria de saude nao autorizada para a IA nao entra no pareamento; sem relato nao ha par', async () => {
    const db = makeDb({ logs: [{ nightDate: new Date('2026-10-20T00:00:00Z'), sleepQuality: 3, sleepDurationCategory: null }], summaries: [{ provider: 'zepp', calendarDate: '2026-10-20', durationSec: 23160, scoreValue: 64 }] });
    await runWithAiScope(scope({ blockedHealth: ['zepp:sleep'] }) as never, async () => expect((await buildPairedEvidence(db as never, 'u1')).sleepPerceivedVsDevice).toEqual([]));
    await runWithAiScope(scope({}) as never, async () => expect((await buildPairedEvidence(db as never, 'u1')).sleepPerceivedVsDevice).toHaveLength(1));
    const noReport = makeDb({ logs: [{ nightDate: new Date('2026-10-20T00:00:00Z'), sleepQuality: null, sleepDurationCategory: null }], summaries: [{ provider: 'zepp', calendarDate: '2026-10-20', durationSec: 23160 }] });
    expect((await buildPairedEvidence(noReport as never, 'u1')).sleepPerceivedVsDevice).toEqual([]);
  });
});

describe('Atlas: orientacao do aluno em linguagem simples, a partir dos dados existentes (sem novo agente nem novo relatorio)', () => {
  const service = new PrescriptionAgentService({ get: () => undefined } as never, {} as never) as unknown as Record<string, () => string>;

  it('o prompt da semana ensina a ler as fontes juntas, separar fato de hipotese e responder as quatro perguntas do aluno; os prompts de dia nao mudam', () => {
    const weekly = service.buildSystemPromptStable();
    expect(weekly).toContain(INTEGRATED_SOURCES_INSTRUCTION);
    for (const part of ['evidenceKind', 'self_report', 'device_measurement', 'device_estimate', 'manufacturer_score', 'pairedEvidence', 'linkConfirmedByPerson', 'NAO sao diagnostico',
      'como foi o treino da semana que passou', 'como o corpo respondeu', 'o que mudou em relacao ao historico', 'o que fazer agora', 'FATO', 'HIPOTESE', 'ritmo sempre em min/km', 'nunca invente']) {
      expect(INTEGRATED_SOURCES_INSTRUCTION).toContain(part);
    }
    expect(service.buildRunSessionSystemPrompt()).not.toContain('INTEGRACAO DE FONTES');
    expect(service.buildSingleStrengthSystemPrompt()).not.toContain('INTEGRACAO DE FONTES');
  });
});
