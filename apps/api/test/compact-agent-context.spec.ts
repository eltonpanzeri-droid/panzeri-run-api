import { buildCompactAgentContext } from '../src/training-intelligence/compact-agent-context';
import { AthleteStateSnapshotV1, VariableStateEntry } from '../src/training-intelligence/athlete-state-snapshot.service';

// 25/09/2026 — Passo 2/6 + CORRECAO DE FECHAMENTO (compressao estrutural do Compact Agent Context:
// pool unico de variaveis + legenda semantica separada + entradas minimas quando n=0). Estes testes
// verificam PROPRIEDADES DA INTEGRACAO/COMPRESSAO, nunca regras de prescricao determinsticas.

function variableEntry(overrides: Partial<VariableStateEntry> = {}): VariableStateEntry {
  return {
    variable: { id: 'workout.prePhysicalFatigue', domain: 'physical_state', dataType: 'ordinal_scale', constructLabel: 'cansaco fisico', scale: { min: 1, max: 5 }, direction: 'higher_is_more_of_construct' },
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
    habitualRange: { method: 'empirical_percentile_linear_interpolation', window: { kind: 'calendar_days', size: 200 }, n: 0, isPartialWindow: true, median: null, q1: null, q3: null, lower: null, upper: null, semanticCaution: 'x' },
    variabilityChange: {
      recent: { window: { kind: 'calendar_days', size: 21 }, n: 0, isPartialWindow: true, median: null, mad: null, iqr: null, range: null },
      habitual: { window: { kind: 'calendar_days', size: 200 }, n: 0, isPartialWindow: true, median: null, mad: null, iqr: null, range: null },
      madRatio: null,
      direction: 'insufficient_data',
    },
    persistence: { currentlyOutsideHabitualRange: null, direction: null, startTimestamp: null, durationDays: null, observationCount: null },
    excursions: [],
    traceRef: { variableId: 'workout.prePhysicalFatigue', endpoint: '/coach/students/x/observations/workout.prePhysicalFatigue' },
    evidence: { n: 0, observedSpan: { from: null, to: null }, lastObservationAt: null, instrumentVersions: [], comparabilityWarning: null },
    ...overrides,
  };
}

function snapshot(overrides: Partial<AthleteStateSnapshotV1['domains']> = {}): AthleteStateSnapshotV1 {
  const emptyVarDomain = { availability: 'unavailable' as const, variables: {} };
  return {
    athleteId: 'aluno-1',
    generatedAt: '2026-09-25T00:00:00.000Z',
    compact: {},
    domains: {
      training: { availability: 'unavailable', dataAvailableSince: null, totalWeeksWithPlan: 0, adherence: null, consistency: null, modalityBreakdown: [], recentWeeks: [] },
      sleepRecovery: emptyVarDomain,
      physicalState: emptyVarDomain,
      psychologicalState: emptyVarDomain,
      trainingResponse: emptyVarDomain,
      painHealth: { availability: 'unavailable', mostRecent: null, reportCountAllTime: 0, reportCountLast90Days: 0, recurrenceObserved: false },
      performanceCapacity: { availability: 'unavailable', latestFitnessTest: null, fitnessTestHistoryCount: 0, upcomingTargetRaces: [], reassessmentsRecorded: 0, reassessmentContentAvailability: 'unavailable_narrative_only' },
      behavior: { availability: 'unavailable', variables: {}, adherence: null, consistency: null, checkinsSubmittedAllTime: 0, checkinsSkippedAllTime: 0 },
      lifeContext: { availability: 'unavailable', narrativeSourcesWithContent: [] },
      systemDynamics: { availability: 'unavailable', variablesCurrentlyOutsideHabitualRange: [], ongoingExcursions: [], recentlyRecoveredExcursions: [], variablesWithChangedVariability: [] },
      ...overrides,
    },
    evidenceQuality: { perVariable: {}, overall: { variablesWithData: 0, variablesWithoutData: 0, mostRecentObservationAt: null, variablesWithComparabilityWarning: [] } },
  };
}

describe('buildCompactAgentContext', () => {
  it('nunca envia traceRef/observations — so o resumo compacto no pool de variaveis', () => {
    const snap = snapshot({ physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': variableEntry({ current: 3, evidence: { n: 5, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null } }) } } });
    const compact = buildCompactAgentContext(snap);
    const entry = compact.variables['workout.prePhysicalFatigue'] as unknown as { traceRef?: unknown; observations?: unknown };
    expect(entry.traceRef).toBeUndefined();
    expect(entry.observations).toBeUndefined();
  });

  it('CORRECAO 1a: semantica (constructLabel/scale/direction) fica na legenda, nao repetida por variavel', () => {
    const snap = snapshot({ physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': variableEntry({ current: 3, evidence: { n: 5, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null } }) } } });
    const compact = buildCompactAgentContext(snap);
    expect(compact.variableLegend['workout.prePhysicalFatigue']).toEqual({ constructLabel: 'cansaco fisico', scale: { min: 1, max: 5 }, direction: 'higher_is_more_of_construct' });
    expect(compact.variables['workout.prePhysicalFatigue']).not.toHaveProperty('constructLabel');
    expect(compact.variables['workout.prePhysicalFatigue']).not.toHaveProperty('scale');
    expect(compact.variables['workout.prePhysicalFatigue']).not.toHaveProperty('direction');
  });

  it('CORRECAO 1b: variavel citada em 2 dominios (overlap intencional do Snapshot) aparece UMA UNICA VEZ no pool', () => {
    const shared = variableEntry({ variable: { id: 'workout.postPhysicalFatigue', domain: 'physical_state', dataType: 'ordinal_scale', direction: 'higher_is_more_of_construct' }, current: 2, evidence: { n: 3, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null } });
    const snap = snapshot({
      physicalState: { availability: 'available', variables: { 'workout.postPhysicalFatigue': shared } },
      trainingResponse: { availability: 'available', variables: { 'workout.postPhysicalFatigue': shared } },
    });
    const compact = buildCompactAgentContext(snap);
    expect(Object.keys(compact.variables).filter((id) => id === 'workout.postPhysicalFatigue')).toHaveLength(1);
    expect(compact.physicalState.variableIds).toContain('workout.postPhysicalFatigue');
    expect(compact.trainingResponse.variableIds).toContain('workout.postPhysicalFatigue');
  });

  it('CORRECAO 1c: variavel sem nenhuma observacao (n=0) fica minima — so evidence, sem os demais campos null', () => {
    const snap = snapshot({ physicalState: { availability: 'unavailable', variables: { 'workout.prePhysicalFatigue': variableEntry({ current: null, evidence: { n: 0, observedSpan: { from: null, to: null }, lastObservationAt: null, instrumentVersions: [], comparabilityWarning: null } }) } } });
    const compact = buildCompactAgentContext(snap);
    const v = compact.variables['workout.prePhysicalFatigue'];
    expect(v.evidence.n).toBe(0);
    expect(v).not.toHaveProperty('current');
    expect(v).not.toHaveProperty('trend');
    expect(v).not.toHaveProperty('baseline');
    expect(v).not.toHaveProperty('mostRecentExcursion');
    // A informacao de ausencia continua 100% visivel — so nao esta mais escrita por extenso em cada campo.
    expect(JSON.stringify(compact.variables).length).toBeLessThan(JSON.stringify({ ...v, current: null, trend: { recent: 'insufficient_data', mediumTerm: 'insufficient_data' }, baseline: null, deviationFromBaseline: { absolute: null, relative: null }, variability: { recent: null, habitual: null, change: 'insufficient_data' }, habitualRange: null, currentlyOutsideHabitualRange: null, mostRecentExcursion: null, totalExcursionsObserved: 0 }).length);
  });

  it('ausencia permanece ausencia — nunca vira zero', () => {
    const snap = snapshot({ physicalState: { availability: 'unavailable', variables: { 'workout.prePhysicalFatigue': variableEntry({ current: null }) } } });
    const compact = buildCompactAgentContext(snap);
    expect(compact.variables['workout.prePhysicalFatigue'].current).toBeUndefined();
    expect(compact.variables['workout.prePhysicalFatigue'].evidence.n).toBe(0);
  });

  it('evidencia escassa (n=3) permanece identificada como tal, nao vira "confidence score"', () => {
    const entry = variableEntry({
      current: 4,
      evidence: { n: 3, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null },
      baseline: { window: { kind: 'calendar_days', size: 200 }, value: 4, n: 3, isPartialWindow: true, windowStart: new Date(), windowEnd: new Date() },
    });
    const snap = snapshot({ physicalState: { availability: 'partial', variables: { 'workout.prePhysicalFatigue': entry } } });
    const compact = buildCompactAgentContext(snap);
    const v = compact.variables['workout.prePhysicalFatigue'];
    expect(v.evidence.n).toBe(3);
    expect(v.evidence.isPartialWindow).toBe(true);
    expect(Object.keys(v)).not.toContain('confidence');
  });

  it('multiplas dimensoes coexistem sem hierarquia imposta pela infraestrutura', () => {
    const snap = snapshot({
      physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': variableEntry({ current: 5, evidence: { n: 5, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null } }) } },
      psychologicalState: { availability: 'available', variables: { 'workout.preMotivation': variableEntry({ variable: { id: 'workout.preMotivation', domain: 'psychological_state', dataType: 'ordinal_scale', direction: 'higher_is_more_of_construct' }, current: 5, evidence: { n: 5, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null } }) } },
    });
    const compact = buildCompactAgentContext(snap);
    expect(compact).not.toHaveProperty('overallScore');
    expect(compact).not.toHaveProperty('readiness');
    expect(compact.variables['workout.prePhysicalFatigue'].current).toBe(5);
    expect(compact.variables['workout.preMotivation'].current).toBe(5);
  });

  it('dois atletas com o MESMO valor atual podem ter estados longitudinais diferentes (trajetoria preservada)', () => {
    const commonEvidence = { n: 20, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null };
    const athleteA = variableEntry({
      current: 4,
      evidence: commonEvidence,
      baseline: { window: { kind: 'calendar_days', size: 200 }, value: 2, n: 20, isPartialWindow: false, windowStart: new Date(), windowEnd: new Date() },
      deviation: { current: 4, baseline: 2, absoluteDeviation: 2, relativeDeviation: 1 },
      trend: { short_21d: { direction: 'increasing', slopePerDay: 0.1, window: { kind: 'calendar_days', size: 21 }, n: 20 }, medium_60d: { direction: 'increasing', slopePerDay: 0.1, window: { kind: 'calendar_days', size: 60 }, n: 20 } },
      persistence: { currentlyOutsideHabitualRange: true, direction: 'above', startTimestamp: 'a', durationDays: 5, observationCount: 5 },
    });
    const athleteB = variableEntry({
      current: 4,
      evidence: commonEvidence,
      baseline: { window: { kind: 'calendar_days', size: 200 }, value: 4, n: 20, isPartialWindow: false, windowStart: new Date(), windowEnd: new Date() },
      deviation: { current: 4, baseline: 4, absoluteDeviation: 0, relativeDeviation: 0 },
      trend: { short_21d: { direction: 'stable', slopePerDay: 0, window: { kind: 'calendar_days', size: 21 }, n: 20 }, medium_60d: { direction: 'stable', slopePerDay: 0, window: { kind: 'calendar_days', size: 60 }, n: 20 } },
      persistence: { currentlyOutsideHabitualRange: false, direction: null, startTimestamp: null, durationDays: null, observationCount: null },
    });
    const compactA = buildCompactAgentContext(snapshot({ physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': athleteA } } }));
    const compactB = buildCompactAgentContext(snapshot({ physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': athleteB } } }));

    expect(compactA.variables['workout.prePhysicalFatigue'].current).toBe(4);
    expect(compactB.variables['workout.prePhysicalFatigue'].current).toBe(4);
    expect(compactA.variables['workout.prePhysicalFatigue'].currentlyOutsideHabitualRange).toBe(true);
    expect(compactB.variables['workout.prePhysicalFatigue'].currentlyOutsideHabitualRange).toBe(false);
    expect(compactA.variables['workout.prePhysicalFatigue'].trend?.recent).toBe('increasing');
    expect(compactB.variables['workout.prePhysicalFatigue'].trend?.recent).toBe('stable');
  });

  it('o mesmo atleta, mesmo valor atual, em momentos diferentes: contextos longitudinais diferentes preservados', () => {
    const commonEvidence = { n: 5, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null };
    const momentoExcursao = variableEntry({
      current: 4,
      evidence: commonEvidence,
      persistence: { currentlyOutsideHabitualRange: true, direction: 'above', startTimestamp: 'a', durationDays: 2, observationCount: 2 },
      excursions: [{ direction: 'above', startTimestamp: 'a', endTimestamp: 'b', ongoing: true, durationDays: 2, observationCount: 2, peak: { value: 4, timestamp: 'b' }, magnitude: 1, returnDynamics: null }],
    });
    const momentoHabitual = variableEntry({
      current: 4,
      evidence: commonEvidence,
      persistence: { currentlyOutsideHabitualRange: false, direction: null, startTimestamp: null, durationDays: null, observationCount: null },
      excursions: [],
    });
    const c1 = buildCompactAgentContext(snapshot({ physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': momentoExcursao } } }));
    const c2 = buildCompactAgentContext(snapshot({ physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': momentoHabitual } } }));
    expect(c1.variables['workout.prePhysicalFatigue'].mostRecentExcursion?.ongoing).toBe(true);
    expect(c2.variables['workout.prePhysicalFatigue'].mostRecentExcursion).toBeNull();
  });

  it('alteracao isolada NAO chega como diagnostico/decisao pronta — so como componentes descritivos', () => {
    const entry = variableEntry({ current: 5, evidence: { n: 5, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null }, persistence: { currentlyOutsideHabitualRange: true, direction: 'above', startTimestamp: 'a', durationDays: 3, observationCount: 3 } });
    const compact = buildCompactAgentContext(snapshot({ psychologicalState: { availability: 'available', variables: { 'workout.preStressLevel': entry } } }));
    const v = compact.variables['workout.preStressLevel'];
    expect(v).not.toHaveProperty('decision');
    expect(v).not.toHaveProperty('recommendation');
    expect(v).not.toHaveProperty('action');
    expect(v).not.toHaveProperty('shouldReduceLoad');
  });

  it('diretivas do treinador nao sao modeladas aqui (ficam fora do Snapshot)', () => {
    const compact = buildCompactAgentContext(snapshot());
    expect(compact).not.toHaveProperty('studentDirectives');
    expect(compact).not.toHaveProperty('diretrizes');
  });

  it('forca/limitacao da evidencia (incompatibilidade de versao) permanece visivel', () => {
    const entry = variableEntry({ current: 3, evidence: { n: 10, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [1, 2], comparabilityWarning: 'versoes incompativeis' } });
    const compact = buildCompactAgentContext(snapshot({ psychologicalState: { availability: 'available', variables: { 'workout.preStressLevel': entry } } }));
    expect(compact.variables['workout.preStressLevel'].evidence.comparabilityWarning).toBe('versoes incompativeis');
  });

  it('dor presente e ausencia de dor sao representadas fielmente, sem inventar diagnostico', () => {
    const withPain = buildCompactAgentContext(snapshot({ painHealth: { availability: 'available', mostRecent: { createdAt: 'a', regions: ['joelho'], intensity: 6, onsetPattern: 'gradual', persistencePattern: 'intermitente', worseningTrend: 'piorando', dailyLifeImpact: 'leve' }, reportCountAllTime: 2, reportCountLast90Days: 2, recurrenceObserved: true } }));
    const withoutPain = buildCompactAgentContext(snapshot());
    expect(withPain.painHealth.mostRecent?.intensity).toBe(6);
    expect(withoutPain.painHealth.mostRecent).toBeNull();
    expect(withPain.painHealth).not.toHaveProperty('diagnosis');
    expect(withPain.painHealth).not.toHaveProperty('injury');
  });

  it('nao duplica dado bruto+agregado — cada variavel aparece uma unica vez no pool por athlete', () => {
    const entry = variableEntry({ current: 3, evidence: { n: 5, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null } });
    const compact = buildCompactAgentContext(snapshot({ physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': entry } } }));
    expect(Object.keys(compact.variables)).toEqual(['workout.prePhysicalFatigue']);
  });
});
