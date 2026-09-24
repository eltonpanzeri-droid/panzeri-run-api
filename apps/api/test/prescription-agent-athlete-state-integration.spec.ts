import { ConfigService } from '@nestjs/config';
import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';
import { MethodologyInput } from '../src/training-plans/training-methodology';
import { CompactAgentContext } from '../src/training-intelligence/compact-agent-context';

// 25/09/2026 — Passo 2/6 (auditoria aprovada): integracao do Athlete State Snapshot ao agente de
// prescricao. Testa PROPRIEDADES DA INTEGRACAO no prompt realmente construido (buildUserPrompt),
// sem chamar a API da Anthropic e sem nenhuma asserção do tipo "estado X -> prescricao Y".

function buildService() {
  const config = { get: jest.fn().mockReturnValue('') }; // sem ANTHROPIC_API_KEY — nunca chama a IA de verdade
  const aiQueue = { enqueue: jest.fn() };
  return new PrescriptionAgentService(config as never, aiQueue as never);
}

function baseInput(overrides: Partial<MethodologyInput> = {}): MethodologyInput {
  return {
    goal: 'Correr 10km',
    experience: 'intermediario',
    answers: {},
    availability: [{ weekday: 1, modalities: ['corrida'], availableMin: 60, modalityDurations: null }],
    history: [],
    stravaRunMinutes: 0,
    stravaLongestRunMinutes: 0,
    studentDirectives: [],
    activeObservations: [],
    ...overrides,
  };
}

function emptyVariable(overrides: Partial<CompactAgentContext['physicalState']['variables']['x']> = {}) {
  return {
    constructLabel: 'cansaco fisico',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    current: null,
    trend: { recent: 'insufficient_data', mediumTerm: 'insufficient_data' },
    baseline: null,
    deviationFromBaseline: { absolute: null, relative: null },
    variability: { recent: null, habitual: null, change: 'insufficient_data' },
    habitualRange: null,
    currentlyOutsideHabitualRange: null,
    mostRecentExcursion: null,
    totalExcursionsObserved: 0,
    evidence: { n: 0, observedSpan: { from: null, to: null }, lastObservationAt: null, instrumentVersions: [], comparabilityWarning: null, isPartialWindow: false },
    ...overrides,
  };
}

function emptyCompactContext(overrides: Partial<CompactAgentContext> = {}): CompactAgentContext {
  return {
    athleteId: 'aluno-1',
    generatedAt: '2026-09-25T00:00:00.000Z',
    training: { availability: 'unavailable', dataAvailableSince: null, totalWeeksWithPlan: 0, adherence: null, consistency: null, modalityBreakdown: [], recentWeeks: [] },
    sleepRecovery: { availability: 'unavailable', variables: {} },
    physicalState: { availability: 'unavailable', variables: {} },
    psychologicalState: { availability: 'unavailable', variables: {} },
    trainingResponse: { availability: 'unavailable', variables: {} },
    painHealth: { availability: 'unavailable', mostRecent: null, reportCountAllTime: 0, reportCountLast90Days: 0, recurrenceObserved: false },
    performanceCapacity: { availability: 'unavailable', latestFitnessTest: null, fitnessTestHistoryCount: 0, upcomingTargetRaces: [], reassessmentsRecorded: 0, reassessmentContentAvailability: 'unavailable_narrative_only' },
    behavior: { availability: 'unavailable', variables: {}, adherence: null, consistency: null, checkinsSubmittedAllTime: 0, checkinsSkippedAllTime: 0 },
    lifeContext: { availability: 'unavailable', narrativeSourcesWithContent: [] },
    systemDynamics: { availability: 'unavailable', variablesCurrentlyOutsideHabitualRange: [], ongoingExcursions: [], recentlyRecoveredExcursions: [], variablesWithChangedVariability: [] },
    evidenceQuality: { variablesWithData: 0, variablesWithoutData: 0, mostRecentObservationAt: null, variablesWithComparabilityWarning: [] },
    ...overrides,
  };
}

function callBuildUserPrompt(service: PrescriptionAgentService, input: MethodologyInput) {
  const raw = (service as unknown as {
    buildUserPrompt: (input: MethodologyInput, runSlots: unknown[], strengthSlots: unknown[], safetyAdjustment: boolean, novice: boolean, evidence: unknown, painReason: string | null) => string;
  }).buildUserPrompt(input, [], [], false, false, {}, null);
  return JSON.parse(raw);
}

describe('Integracao Athlete State Snapshot -> prompt do prescription-agent', () => {
  it('1. ausencia permanece ausencia — nunca vira zero no prompt final', () => {
    const service = buildService();
    const context = emptyCompactContext({
      physicalState: { availability: 'unavailable', variables: { 'workout.prePhysicalFatigue': emptyVariable({ current: null }) } },
    });
    const prompt = callBuildUserPrompt(service, baseInput({ athleteStateContext: context }));
    expect(prompt.athleteStateContext.physicalState.variables['workout.prePhysicalFatigue'].current).toBeNull();
  });

  it('2. evidencia escassa permanece identificada como tal (n baixo + isPartialWindow visiveis)', () => {
    const service = buildService();
    const context = emptyCompactContext({
      psychologicalState: {
        availability: 'partial',
        variables: { 'workout.preMentalFatigue': emptyVariable({ current: 3, evidence: { n: 3, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [2], comparabilityWarning: null, isPartialWindow: true } }) },
      },
    });
    const prompt = callBuildUserPrompt(service, baseInput({ athleteStateContext: context }));
    const v = prompt.athleteStateContext.psychologicalState.variables['workout.preMentalFatigue'];
    expect(v.evidence.n).toBe(3);
    expect(v.evidence.isPartialWindow).toBe(true);
  });

  it('3. direcao semantica da variavel chega corretamente ao agente (constructLabel/direction preservados)', () => {
    const service = buildService();
    const context = emptyCompactContext({
      psychologicalState: { availability: 'available', variables: { 'workout.preStressLevel': emptyVariable({ constructLabel: 'nivel de estresse', direction: 'higher_is_more_of_construct', current: 4 }) } },
    });
    const prompt = callBuildUserPrompt(service, baseInput({ athleteStateContext: context }));
    const v = prompt.athleteStateContext.psychologicalState.variables['workout.preStressLevel'];
    expect(v.constructLabel).toBe('nivel de estresse');
    expect(v.direction).toBe('higher_is_more_of_construct');
  });

  it('4. alteracao isolada nao chega como diagnostico/decisao pronta (sem campo decision/action/recommendation)', () => {
    const service = buildService();
    const context = emptyCompactContext({
      physicalState: { availability: 'available', variables: { 'workout.postPhysicalFatigue': emptyVariable({ current: 5, currentlyOutsideHabitualRange: true }) } },
    });
    const prompt = callBuildUserPrompt(service, baseInput({ athleteStateContext: context }));
    const v = prompt.athleteStateContext.physicalState.variables['workout.postPhysicalFatigue'];
    expect(v).not.toHaveProperty('decision');
    expect(v).not.toHaveProperty('action');
    expect(v).not.toHaveProperty('recommendation');
    expect(v).not.toHaveProperty('shouldReduceLoad');
  });

  it('5. multiplas variaveis coexistem sem hierarquia imposta pela infraestrutura', () => {
    const service = buildService();
    const context = emptyCompactContext({
      physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': emptyVariable({ current: 5 }) } },
      sleepRecovery: { availability: 'available', variables: { 'workout.preSleepQuality': emptyVariable({ current: 5 }) } },
    });
    const prompt = callBuildUserPrompt(service, baseInput({ athleteStateContext: context }));
    expect(prompt.athleteStateContext).not.toHaveProperty('overallScore');
    expect(prompt.athleteStateContext).not.toHaveProperty('readiness');
    expect(prompt.athleteStateContext.physicalState.variables['workout.prePhysicalFatigue'].current).toBe(5);
    expect(prompt.athleteStateContext.sleepRecovery.variables['workout.preSleepQuality'].current).toBe(5);
  });

  it('6. diretivas explicitas do treinador permanecem visiveis e prioritarias, independente do athleteStateContext', () => {
    const service = buildService();
    const prompt = callBuildUserPrompt(service, baseInput({
      studentDirectives: ['nao correr terca', 'prova domingo'],
      athleteStateContext: emptyCompactContext(),
    }));
    expect(prompt.diretrizesEspecificasDoTreinadorParaEsteAluno).toEqual(['nao correr terca', 'prova domingo']);
  });

  it('7. objetivo, prova, disponibilidade e demais contextos operacionais continuam presentes junto do athleteStateContext', () => {
    const service = buildService();
    const prompt = callBuildUserPrompt(service, baseInput({
      goal: 'Meia maratona',
      targetRaces: [{ name: 'Meia SP', raceDate: '2026-12-01T00:00:00.000Z', distanceKm: 21.1, paceSecondsPerKm: 330, performanceIntent: null, socialIntent: null, personalImportance: null, perceivedDifficulty: null, dedicationWillingness: null, achievementSatisfaction: null, confidenceLevel: null, injuryConcern: null, adjustmentOpenness: null, anxietyLevel: null, isFirstTimeAtDistance: null }],
      athleteStateContext: emptyCompactContext(),
    }));
    expect(prompt.objetivo).toBe('Meia maratona');
    expect(prompt.metasDeProva).toHaveLength(1);
    expect(prompt.diasDisponiveisParaCorrida).toBeDefined();
    expect(prompt.athleteStateContext).toBeDefined();
  });

  it('8. matematica ja calculada nao e recalculada — os valores no prompt sao exatamente os que entraram, sem transformacao', () => {
    const service = buildService();
    const context = emptyCompactContext({
      trainingResponse: { availability: 'available', variables: { 'workout.perceivedEffort': emptyVariable({ current: 7, baseline: 6.3333, deviationFromBaseline: { absolute: 0.6667, relative: 0.1053 } }) } },
    });
    const prompt = callBuildUserPrompt(service, baseInput({ athleteStateContext: context }));
    const v = prompt.athleteStateContext.trainingResponse.variables['workout.perceivedEffort'];
    expect(v.current).toBe(7);
    expect(v.baseline).toBe(6.3333);
    expect(v.deviationFromBaseline.absolute).toBe(0.6667);
  });

  it('9. informacao historica ainda nao estruturada (prontuario/observacoes do aluno) nao desaparece', () => {
    const service = buildService();
    const prompt = callBuildUserPrompt(service, baseInput({
      studentProfileSummary: 'Aluna consistente, historico de dor no joelho ha 2 meses.',
      activeObservations: ['vou viajar semana que vem'],
      athleteStateContext: emptyCompactContext(),
    }));
    expect(prompt.prontuarioDoAluno).toBe('Aluna consistente, historico de dor no joelho ha 2 meses.');
    expect(prompt.observacoesRegistradasPeloProprioAluno).toEqual(['vou viajar semana que vem']);
  });

  it('10. nao ha duplicacao grosseira: cada variavel do athleteStateContext aparece uma unica vez por dominio', () => {
    const service = buildService();
    const context = emptyCompactContext({
      physicalState: { availability: 'available', variables: { 'workout.postPhysicalFatigue': emptyVariable({ current: 3 }) } },
      trainingResponse: { availability: 'available', variables: { 'workout.postPhysicalFatigue': emptyVariable({ current: 3 }) } },
    });
    const prompt = callBuildUserPrompt(service, baseInput({ athleteStateContext: context }));
    // A MESMA variavel pode aparecer em 2 dominios (overlap intencional do Snapshot, ver
    // athlete-state-snapshot.service.ts) — o que nao pode existir e' duplicacao DENTRO do mesmo dominio.
    expect(Object.keys(prompt.athleteStateContext.physicalState.variables)).toEqual(['workout.postPhysicalFatigue']);
    expect(Object.keys(prompt.athleteStateContext.trainingResponse.variables)).toEqual(['workout.postPhysicalFatigue']);
  });

  it('11. estado observado permanece distinguivel de interpretacao (so campos descritivos, sem veredito)', () => {
    const service = buildService();
    const context = emptyCompactContext({
      painHealth: { availability: 'available', mostRecent: { createdAt: 'a', regions: ['joelho'], intensity: 7, onsetPattern: 'gradual', persistencePattern: 'constante', worseningTrend: 'piorando', dailyLifeImpact: 'moderado' }, reportCountAllTime: 3, reportCountLast90Days: 2, recurrenceObserved: true },
    });
    const prompt = callBuildUserPrompt(service, baseInput({ athleteStateContext: context }));
    expect(prompt.athleteStateContext.painHealth).not.toHaveProperty('diagnosis');
    expect(prompt.athleteStateContext.painHealth).not.toHaveProperty('shouldStopTraining');
    expect(prompt.athleteStateContext.painHealth.mostRecent.intensity).toBe(7);
  });

  it('12. forca/limitacao da evidencia (incompatibilidade de versao) permanece visivel pelos metadados objetivos', () => {
    const service = buildService();
    const context = emptyCompactContext({
      psychologicalState: { availability: 'available', variables: { 'workout.preStressLevel': emptyVariable({ current: 3, evidence: { n: 23, observedSpan: { from: 'a', to: 'b' }, lastObservationAt: 'b', instrumentVersions: [1, 2], comparabilityWarning: 'versoes incompativeis', isPartialWindow: false } }) } },
    });
    const prompt = callBuildUserPrompt(service, baseInput({ athleteStateContext: context }));
    const v = prompt.athleteStateContext.psychologicalState.variables['workout.preStressLevel'];
    expect(v.evidence.comparabilityWarning).toBe('versoes incompativeis');
    expect(v.evidence.instrumentVersions).toEqual([1, 2]);
  });

  it('13. dois "atletas" (dois inputs) com o mesmo valor atual chegam com estados longitudinais diferentes', () => {
    const service = buildService();
    const contextA = emptyCompactContext({ physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': emptyVariable({ current: 4, baseline: 2, currentlyOutsideHabitualRange: true, trend: { recent: 'increasing', mediumTerm: 'increasing' } }) } } });
    const contextB = emptyCompactContext({ physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': emptyVariable({ current: 4, baseline: 4, currentlyOutsideHabitualRange: false, trend: { recent: 'stable', mediumTerm: 'stable' } }) } } });
    const promptA = callBuildUserPrompt(service, baseInput({ athleteStateContext: contextA }));
    const promptB = callBuildUserPrompt(service, baseInput({ athleteStateContext: contextB }));
    expect(promptA.athleteStateContext.physicalState.variables['workout.prePhysicalFatigue'].current).toBe(4);
    expect(promptB.athleteStateContext.physicalState.variables['workout.prePhysicalFatigue'].current).toBe(4);
    expect(promptA.athleteStateContext.physicalState.variables['workout.prePhysicalFatigue'].currentlyOutsideHabitualRange).toBe(true);
    expect(promptB.athleteStateContext.physicalState.variables['workout.prePhysicalFatigue'].currentlyOutsideHabitualRange).toBe(false);
  });

  it('14. o mesmo atleta, mesmo valor atual, momentos diferentes: contextos diferentes preservados (excursao ativa vs nenhuma)', () => {
    const service = buildService();
    const momento1 = emptyCompactContext({ physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': emptyVariable({ current: 4, mostRecentExcursion: { direction: 'above', startTimestamp: 'a', durationDays: 2, observationCount: 2, magnitude: 1, ongoing: true, returned: null, levelRecovered: null, variabilityRecovered: null, overshootOccurred: null } }) } } });
    const momento2 = emptyCompactContext({ physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': emptyVariable({ current: 4, mostRecentExcursion: null }) } } });
    const p1 = callBuildUserPrompt(service, baseInput({ athleteStateContext: momento1 }));
    const p2 = callBuildUserPrompt(service, baseInput({ athleteStateContext: momento2 }));
    expect(p1.athleteStateContext.physicalState.variables['workout.prePhysicalFatigue'].mostRecentExcursion.ongoing).toBe(true);
    expect(p2.athleteStateContext.physicalState.variables['workout.prePhysicalFatigue'].mostRecentExcursion).toBeNull();
  });

  it('15/16. nenhuma regra deterministica de prescricao (isolada ou combinada) e criada — prompt so contem dados descritivos, nenhum campo de saida pre-decidido', () => {
    const service = buildService();
    const context = emptyCompactContext({
      physicalState: { availability: 'available', variables: { 'workout.prePhysicalFatigue': emptyVariable({ current: 5, currentlyOutsideHabitualRange: true }) } },
      sleepRecovery: { availability: 'available', variables: { 'workout.preSleepQuality': emptyVariable({ current: 1, currentlyOutsideHabitualRange: true }) } },
      trainingResponse: { availability: 'available', variables: { 'workout.perceivedEffort': emptyVariable({ current: 9, currentlyOutsideHabitualRange: true }) } },
    });
    const prompt = callBuildUserPrompt(service, baseInput({ athleteStateContext: context }));
    // Mesmo com fadiga alta + sono ruim + RPE alto simultaneos (a combinacao "obvia" pra reduzir
    // carga), o prompt nao carrega nenhum veredito pronto — so os dados, e o texto de instrucao
    // (nao testado aqui em conteudo) explicitamente probe tratar isso como regra fixa.
    expect(JSON.stringify(prompt)).not.toMatch(/reduzirCarga|volumeSugerido|prescricaoRecomendada/i);
  });

  it('17. quando athleteStateContext falha ao ser gerado (null), o restante do prompt continua completo e valido', () => {
    const service = buildService();
    const prompt = callBuildUserPrompt(service, baseInput({ athleteStateContext: null, studentDirectives: ['reduzir impacto'] }));
    expect(prompt.athleteStateContext).toBeNull();
    expect(prompt.diretrizesEspecificasDoTreinadorParaEsteAluno).toEqual(['reduzir impacto']);
    expect(prompt.objetivo).toBe('Correr 10km');
  });
});
