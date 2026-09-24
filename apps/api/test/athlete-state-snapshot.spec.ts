import { AthleteStateSnapshotService } from '../src/training-intelligence/athlete-state-snapshot.service';
import { VariableSnapshotResponse } from '../src/training-intelligence/training-intelligence-query.service';

// 24/09/2026 — Athlete State Snapshot V1 (auditoria aprovada). O servico so ORQUESTRA infra ja
// testada (TrainingIntelligenceQueryService, EvolutionMetricService); estes testes garantem que a
// orquestracao preserva fidelidade aos dados (nao inventa, nao recalcula, nao mistura dominio vazio
// com dado real) e que a rastreabilidade/qualidade de evidencia chegam corretas no nivel do snapshot.

function emptyVariableSnapshot(variableId: string): VariableSnapshotResponse {
  return {
    variable: { id: variableId, domain: 'training_response', dataType: 'ordinal_scale', direction: 'higher_is_more_of_construct', scale: { min: 1, max: 5 } },
    mathApplicable: true,
    current: null,
    mean: { value: null, n: 0 },
    movingAverages: {
      short_21d: { window: { kind: 'calendar_days', size: 21 }, value: null, n: 0, isPartialWindow: true, windowStart: null, windowEnd: null },
      medium_60d: { window: { kind: 'calendar_days', size: 60 }, value: null, n: 0, isPartialWindow: true, windowStart: null, windowEnd: null },
      long_200d: { window: { kind: 'calendar_days', size: 200 }, value: null, n: 0, isPartialWindow: true, windowStart: null, windowEnd: null },
    },
    baseline: { window: { kind: 'calendar_days', size: 200 }, value: null, n: 0, isPartialWindow: true, windowStart: null, windowEnd: null },
    deviation: { current: null, baseline: null, absoluteDeviation: null, relativeDeviation: null },
    trend: {
      short_21d: { direction: 'insufficient_data', slopePerDay: null, window: { kind: 'calendar_days', size: 21 }, n: 0 },
      medium_60d: { direction: 'insufficient_data', slopePerDay: null, window: { kind: 'calendar_days', size: 60 }, n: 0 },
    },
    variability: {
      short_21d: { window: { kind: 'calendar_days', size: 21 }, n: 0, isPartialWindow: true, median: null, mad: null, iqr: null, range: null },
      medium_60d: { window: { kind: 'calendar_days', size: 60 }, n: 0, isPartialWindow: true, median: null, mad: null, iqr: null, range: null },
      long_200d: { window: { kind: 'calendar_days', size: 200 }, n: 0, isPartialWindow: true, median: null, mad: null, iqr: null, range: null },
    },
    habitualRange: {
      method: 'empirical_percentile_linear_interpolation',
      window: { kind: 'calendar_days', size: 200 },
      n: 0,
      isPartialWindow: true,
      median: null,
      q1: null,
      q3: null,
      lower: null,
      upper: null,
      semanticCaution: 'x',
    },
    variabilityChange: {
      recent: { window: { kind: 'calendar_days', size: 21 }, n: 0, isPartialWindow: true, median: null, mad: null, iqr: null, range: null },
      habitual: { window: { kind: 'calendar_days', size: 200 }, n: 0, isPartialWindow: true, median: null, mad: null, iqr: null, range: null },
      madRatio: null,
      direction: 'insufficient_data',
    },
    persistence: { currentlyOutsideHabitualRange: null, direction: null, startTimestamp: null, durationDays: null, observationCount: null },
    excursions: [],
    observations: [],
    evidence: { n: 0, observedSpan: { from: null, to: null }, lastObservationAt: null, instrumentVersions: [], comparabilityWarning: null },
  };
}

function buildDeps(overrides: {
  variableSnapshots?: Record<string, Partial<VariableSnapshotResponse>>;
  overview?: unknown;
  overviewThrows?: boolean;
  painReports?: unknown[];
  fitnessTests?: unknown[];
  targetRaces?: unknown[];
  reassessmentCount?: number;
  checkins?: { checkinSkipped: boolean }[];
  studentObservations?: number;
  studentDirectives?: number;
}) {
  const getVariableSnapshot = jest.fn(async (_athleteId: string, variableId: string) => ({
    ...emptyVariableSnapshot(variableId),
    ...(overrides.variableSnapshots?.[variableId] ?? {}),
  }));

  const getOverview = overrides.overviewThrows
    ? jest.fn().mockRejectedValue(new Error('sem historico'))
    : jest.fn().mockResolvedValue(
        overrides.overview ?? {
          dataAvailableSince: null,
          totalWeeksWithPlan: 0,
          totalSemRegistro: 0,
          totalKmPercorridos: 0,
          adherence: {
            allTime: { period: 'all_time', sessoesPrescritas: 0, sessoesFeitas: 0, sessoesNaoFeitas: 0, sessoesSemRegistro: 0, adherencePercent: null, coveragePercent: 0, lowCoverageWarning: false },
            last4Weeks: { period: 'last_4_weeks', sessoesPrescritas: 0, sessoesFeitas: 0, sessoesNaoFeitas: 0, sessoesSemRegistro: 0, adherencePercent: null, coveragePercent: 0, lowCoverageWarning: false },
            last8Weeks: { period: 'last_8_weeks', sessoesPrescritas: 0, sessoesFeitas: 0, sessoesNaoFeitas: 0, sessoesSemRegistro: 0, adherencePercent: null, coveragePercent: 0, lowCoverageWarning: false },
          },
          consistency: { currentStreakWeeks: 0, longestStreakWeeks: 0, lastRegisteredDate: null, lastCompletedDate: null },
          modalityBreakdown: [],
          recentWeeks: [],
          calculatedAt: new Date().toISOString(),
        },
      );

  const prisma = {
    weeklyCheckIn: { findMany: jest.fn().mockResolvedValue(overrides.checkins ?? []) },
    painReport: { findMany: jest.fn().mockResolvedValue(overrides.painReports ?? []) },
    fitnessTest: { findMany: jest.fn().mockResolvedValue(overrides.fitnessTests ?? []) },
    targetRace: { findMany: jest.fn().mockResolvedValue(overrides.targetRaces ?? []) },
    reassessment: { count: jest.fn().mockResolvedValue(overrides.reassessmentCount ?? 0) },
    studentObservation: { count: jest.fn().mockResolvedValue(overrides.studentObservations ?? 0) },
    studentDirective: { count: jest.fn().mockResolvedValue(overrides.studentDirectives ?? 0) },
  };

  const trainingIntelligenceQuery = { getVariableSnapshot };
  const evolutionMetric = { getOverview };

  const service = new AthleteStateSnapshotService(prisma as never, trainingIntelligenceQuery as never, evolutionMetric as never);
  return { service, getVariableSnapshot, getOverview, prisma };
}

describe('AthleteStateSnapshotService', () => {
  it('aluno novo com poucos dados: dominios ficam "unavailable", nada e inventado', async () => {
    const { service } = buildDeps({});
    const snapshot = await service.getSnapshot('aluno-novo');

    expect(snapshot.domains.sleepRecovery.availability).toBe('unavailable');
    expect(snapshot.domains.training.availability).toBe('unavailable');
    expect(snapshot.domains.painHealth.availability).toBe('unavailable');
    expect(snapshot.domains.painHealth.mostRecent).toBeNull();
    // missing nunca vira zero
    expect(snapshot.domains.sleepRecovery.variables['workout.preSleepQuality'].current).toBeNull();
  });

  it('nao recalcula matematica: cada variavel unica e buscada exatamente uma vez, mesmo aparecendo em 2 dominios', async () => {
    const { service, getVariableSnapshot } = buildDeps({});
    await service.getSnapshot('aluno-1');

    const callsByVariable = new Map<string, number>();
    for (const call of getVariableSnapshot.mock.calls) {
      const variableId = call[1] as string;
      callsByVariable.set(variableId, (callsByVariable.get(variableId) ?? 0) + 1);
    }
    // workout.postPhysicalFatigue aparece em physicalState E trainingResponse — so 1 chamada real.
    expect(callsByVariable.get('workout.postPhysicalFatigue')).toBe(1);
    expect(callsByVariable.get('workout.emotionalExperienceDuring')).toBe(1);
    expect([...callsByVariable.values()].every((n) => n === 1)).toBe(true);
  });

  it('aluno com historico suficiente: dominio fica "available" e reflete os valores reais sem alteracao', async () => {
    const { service } = buildDeps({
      variableSnapshots: {
        'workout.preSleepQuality': { current: 4, evidence: { n: 23, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null } },
      },
      overview: {
        dataAvailableSince: '2026-08-01',
        totalWeeksWithPlan: 8,
        totalSemRegistro: 2,
        totalKmPercorridos: 120,
        adherence: {
          allTime: { period: 'all_time', sessoesPrescritas: 40, sessoesFeitas: 35, sessoesNaoFeitas: 2, sessoesSemRegistro: 3, adherencePercent: 95, coveragePercent: 92, lowCoverageWarning: false },
          last4Weeks: { period: 'last_4_weeks', sessoesPrescritas: 8, sessoesFeitas: 7, sessoesNaoFeitas: 0, sessoesSemRegistro: 1, adherencePercent: 100, coveragePercent: 87, lowCoverageWarning: false },
          last8Weeks: { period: 'last_8_weeks', sessoesPrescritas: 16, sessoesFeitas: 14, sessoesNaoFeitas: 1, sessoesSemRegistro: 1, adherencePercent: 93, coveragePercent: 94, lowCoverageWarning: false },
        },
        consistency: { currentStreakWeeks: 5, longestStreakWeeks: 6, lastRegisteredDate: '2026-09-23', lastCompletedDate: '2026-09-23' },
        modalityBreakdown: [],
        recentWeeks: [],
        calculatedAt: new Date().toISOString(),
      },
    });

    const snapshot = await service.getSnapshot('aluno-rico');
    expect(snapshot.domains.sleepRecovery.availability).not.toBe('unavailable');
    expect(snapshot.domains.sleepRecovery.variables['workout.preSleepQuality'].current).toBe(4);
    expect(snapshot.domains.training.availability).toBe('available');
    expect(snapshot.domains.training.consistency?.currentStreakWeeks).toBe(5);
    expect(snapshot.compact.training).toMatchObject({ availability: 'available', adherenceLast4Weeks: 100, currentStreakWeeks: 5 });
  });

  it('training domain reflete fielmente o overview do EvolutionMetricService (que ja exclui sessao-fantasma e isola sessao extra) sem recalcular', async () => {
    const overview = {
      dataAvailableSince: '2026-08-01',
      totalWeeksWithPlan: 3,
      totalSemRegistro: 0,
      totalKmPercorridos: 42,
      adherence: {
        allTime: { period: 'all_time', sessoesPrescritas: 10, sessoesFeitas: 10, sessoesNaoFeitas: 0, sessoesSemRegistro: 0, adherencePercent: 100, coveragePercent: 100, lowCoverageWarning: false },
        last4Weeks: { period: 'last_4_weeks', sessoesPrescritas: 10, sessoesFeitas: 10, sessoesNaoFeitas: 0, sessoesSemRegistro: 0, adherencePercent: 100, coveragePercent: 100, lowCoverageWarning: false },
        last8Weeks: { period: 'last_8_weeks', sessoesPrescritas: 10, sessoesFeitas: 10, sessoesNaoFeitas: 0, sessoesSemRegistro: 0, adherencePercent: 100, coveragePercent: 100, lowCoverageWarning: false },
      },
      consistency: { currentStreakWeeks: 3, longestStreakWeeks: 3, lastRegisteredDate: '2026-09-20', lastCompletedDate: '2026-09-20' },
      modalityBreakdown: [{ modality: 'corrida', sessoesPrescritas: 10, sessoesFeitas: 10, adherencePercent: 100, coveragePercent: 100, percentOfTotalPrescribed: 100 }],
      recentWeeks: [{ weekStart: '2026-09-14', sessoesPrescritas: 3, sessoesFeitas: 3, sessoesNaoFeitas: 0, sessoesSemRegistro: 0, adherencePercent: 100, coveragePercent: 100, lowCoverageWarning: false, kmPercorridos: 15, kmPrescritos: 15, kmExtras: 5 }],
      calculatedAt: new Date().toISOString(),
    };
    const { service } = buildDeps({ overview });
    const snapshot = await service.getSnapshot('aluno-extra');
    expect(snapshot.domains.training.recentWeeks[0].kmExtras).toBe(5);
    expect(snapshot.domains.training.modalityBreakdown).toEqual(overview.modalityBreakdown);
    expect(snapshot.domains.training.adherence).toEqual(overview.adherence);
  });

  it('variavel com janela parcial e sinalizada em evidenceQuality', async () => {
    const { service } = buildDeps({
      variableSnapshots: {
        'workout.perceivedEffort': {
          evidence: { n: 2, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null },
          baseline: { window: { kind: 'calendar_days', size: 200 }, value: 5, n: 2, isPartialWindow: true, windowStart: new Date('2026-09-01'), windowEnd: new Date('2026-09-02') },
        },
      },
    });
    const snapshot = await service.getSnapshot('aluno-1');
    expect(snapshot.evidenceQuality.perVariable['workout.perceivedEffort'].anyPartialWindow).toBe(true);
  });

  it('incompatibilidade de versoes aparece em evidenceQuality.overall', async () => {
    const { service } = buildDeps({
      variableSnapshots: {
        'workout.preStressLevel': {
          evidence: { n: 10, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [1, 2], comparabilityWarning: 'versoes incompativeis' },
        },
      },
    });
    const snapshot = await service.getSnapshot('aluno-1');
    expect(snapshot.evidenceQuality.overall.variablesWithComparabilityWarning).toContain('workout.preStressLevel');
  });

  it('variavel fora da faixa habitual e excursao em andamento aparecem em systemDynamics', async () => {
    const { service } = buildDeps({
      variableSnapshots: {
        'workout.preStressLevel': {
          persistence: { currentlyOutsideHabitualRange: true, direction: 'above', startTimestamp: '2026-09-20T12:00:00.000Z', durationDays: 4, observationCount: 4 },
          excursions: [
            {
              direction: 'above', startTimestamp: '2026-09-20T12:00:00.000Z', endTimestamp: '2026-09-24T12:00:00.000Z',
              ongoing: true, durationDays: 4, observationCount: 4, peak: { value: 5, timestamp: '2026-09-24T12:00:00.000Z' },
              magnitude: 2, returnDynamics: null,
            },
          ],
        },
      },
    });
    const snapshot = await service.getSnapshot('aluno-1');
    expect(snapshot.domains.systemDynamics.variablesCurrentlyOutsideHabitualRange).toHaveLength(1);
    expect(snapshot.domains.systemDynamics.variablesCurrentlyOutsideHabitualRange[0].variableId).toBe('workout.preStressLevel');
    expect(snapshot.domains.systemDynamics.ongoingExcursions).toHaveLength(1);
  });

  it('excursao ja recuperada, com recuperacao de nivel SEM recuperacao de variabilidade, aparece corretamente', async () => {
    const { service } = buildDeps({
      variableSnapshots: {
        'workout.preSleepQuality': {
          excursions: [
            {
              direction: 'above', startTimestamp: '2026-09-10T12:00:00.000Z', endTimestamp: '2026-09-10T12:00:00.000Z',
              ongoing: false, durationDays: 1, observationCount: 1, peak: { value: 5, timestamp: '2026-09-10T12:00:00.000Z' }, magnitude: 1,
              returnDynamics: {
                returned: true, returnTimestamp: '2026-09-11T12:00:00.000Z', timeToReturnDays: 1, observationsToReturn: 1, returnVelocity: 1,
                overshoot: null,
                levelRecovery: { evaluated: true, recovered: true, postReturnLevel: 3, habitualMedian: 3 },
                variabilityRecovery: { evaluated: true, recovered: false, postReturnMad: 2, habitualMad: 0.5, ratio: 4 },
              },
            },
          ],
        },
      },
    });
    const snapshot = await service.getSnapshot('aluno-1');
    const flag = snapshot.domains.systemDynamics.recentlyRecoveredExcursions.find((e) => e.variableId === 'workout.preSleepQuality');
    expect(flag?.levelRecovered).toBe(true);
    expect(flag?.variabilityRecovered).toBe(false);
  });

  it('dor presente: dominio painHealth fica available com o relato real, sem diagnostico inventado', async () => {
    const { service } = buildDeps({
      painReports: [
        { createdAt: new Date('2026-09-20'), regions: ['joelho'], intensity: 6, onsetPattern: 'gradual', persistencePattern: 'intermitente', worseningTrend: 'piorando', dailyLifeImpact: 'leve' },
        { createdAt: new Date('2026-09-01'), regions: ['joelho'], intensity: 3, onsetPattern: 'gradual', persistencePattern: 'intermitente', worseningTrend: 'estavel', dailyLifeImpact: null },
      ],
    });
    const snapshot = await service.getSnapshot('aluno-1');
    expect(snapshot.domains.painHealth.availability).toBe('available');
    expect(snapshot.domains.painHealth.mostRecent?.intensity).toBe(6);
    expect(snapshot.domains.painHealth.reportCountAllTime).toBe(2);
    expect(snapshot.domains.painHealth.recurrenceObserved).toBe(true);
  });

  it('ausencia de dor: dominio painHealth fica unavailable, nunca "intensidade zero"', async () => {
    const { service } = buildDeps({ painReports: [] });
    const snapshot = await service.getSnapshot('aluno-1');
    expect(snapshot.domains.painHealth.availability).toBe('unavailable');
    expect(snapshot.domains.painHealth.mostRecent).toBeNull();
  });

  it('rastreabilidade: cada variavel do snapshot aponta pro endpoint de observacoes, sem embutir a lista bruta', async () => {
    const { service } = buildDeps({});
    const snapshot = await service.getSnapshot('aluno-1');
    const entry = snapshot.domains.sleepRecovery.variables['workout.preSleepQuality'];
    expect(entry.traceRef).toEqual({ variableId: 'workout.preSleepQuality', endpoint: '/coach/students/aluno-1/observations/workout.preSleepQuality' });
    expect((entry as unknown as { observations?: unknown }).observations).toBeUndefined();
  });

  it('performanceCapacity: conteudo narrativo do Reassessment fica marcado indisponivel, nunca extraido', async () => {
    const { service } = buildDeps({ reassessmentCount: 2 });
    const snapshot = await service.getSnapshot('aluno-1');
    expect(snapshot.domains.performanceCapacity.reassessmentsRecorded).toBe(2);
    expect(snapshot.domains.performanceCapacity.reassessmentContentAvailability).toBe('unavailable_narrative_only');
  });

  it('lifeContext: fontes narrativas sao referenciadas por nome, nunca transformadas em evento estruturado', async () => {
    const { service } = buildDeps({ studentObservations: 2, studentDirectives: 0 });
    const snapshot = await service.getSnapshot('aluno-1');
    expect(snapshot.domains.lifeContext.narrativeSourcesWithContent).toEqual(['StudentObservation']);
    expect(snapshot.domains.lifeContext.availability).toBe('partial');
  });

  it('overview do EvolutionMetricService falhando nao quebra o snapshot inteiro (fica unavailable)', async () => {
    const { service } = buildDeps({ overviewThrows: true });
    const snapshot = await service.getSnapshot('aluno-1');
    expect(snapshot.domains.training.availability).toBe('unavailable');
  });
});
