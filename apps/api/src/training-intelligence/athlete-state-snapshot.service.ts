// AthleteStateSnapshotService — Athlete State Snapshot V1 (24/09/2026, pedido explicito: "qual e' o
// estado observavel deste atleta AGORA, considerando seu historico recente e individual?").
//
// Este arquivo NAO calcula matematica nova. Ele ORQUESTRA o que ja existe:
//   TrainingIntelligenceQueryService (por variavel do VariableRegistry) — current/mean/movingAverages/
//   baseline/deviation/trend/variability/habitualRange/variabilityChange/persistence/excursions/evidence.
//   EvolutionMetricService — aderencia/consistencia/volume (ja trata sessao-fantasma/extra).
//   Leitura direta e minima de PainReport/FitnessTest/TargetRace/Reassessment/WeeklyCheckIn/
//   StudentObservation/StudentDirective pra dominios que o VariableRegistry ainda nao cobre.
//
// Nao usa LLM. Nao chama prescription-agent nem Evolution Agent. Nao cria score, nao inverte
// escala, nao estima dado ausente, nao trata texto livre como estruturado nesta rodada (ver
// ATHLETE_STATE_MODEL.md e a auditoria aprovada).
//
// Profundidade em 3 niveis (sem forcar os nomes literais level1/2/3):
//   compact  -> resumo minimo por dominio (nao e' score, e' selecao de campos ja calculados).
//   domains  -> detalhe completo por variavel/metrica (o mesmo objeto que o endpoint de observacoes
//               ja devolve, MENOS a lista bruta de observacoes — ver traceRef abaixo).
//   traceRef -> em vez de embutir centenas de observacoes no snapshot, cada variavel aponta pro
//               endpoint que ja existe (GET /coach/students/:id/observations/:variableId) pra quem
//               precisar do registro original.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionMetricService } from '../evolution/evolution-metric.service';
import type { AdherenceSummary, ConsistencyStreak, ModalityBreakdown, WeeklyVolume } from '../evolution/evolution.types';
import { TrainingIntelligenceQueryService, VariableSnapshotResponse } from './training-intelligence-query.service';
import { ContextEventsService } from '../context-events/context-events.service';

export type DomainAvailability = 'available' | 'partial' | 'unavailable';

export interface VariableStateEntry extends Omit<VariableSnapshotResponse, 'observations'> {
  traceRef: { variableId: string; endpoint: string };
  /**
   * Quebra por modalidade (25/09/2026) — presente só quando a variável depende de modalidade
   * (availableModalities não-vazio) E existe evidência real (n>0) naquela modalidade específica.
   * Cada entrada é o MESMO getVariableSnapshot canônico, só filtrado — nunca uma segunda matemática.
   */
  byModality?: Record<string, Omit<VariableSnapshotResponse, 'observations'>>;
}

interface BaseDomainState {
  availability: DomainAvailability;
  notes?: string;
}

export interface VariableBasedDomainState extends BaseDomainState {
  variables: Record<string, VariableStateEntry>;
}

export interface TrainingDomainState extends BaseDomainState {
  dataAvailableSince: string | null;
  totalWeeksWithPlan: number;
  adherence: { allTime: AdherenceSummary; last4Weeks: AdherenceSummary; last8Weeks: AdherenceSummary } | null;
  consistency: ConsistencyStreak | null;
  modalityBreakdown: ModalityBreakdown[];
  recentWeeks: WeeklyVolume[];
}

export interface PainReportSummary {
  createdAt: string;
  regions: string[];
  intensity: number;
  onsetPattern: string;
  persistencePattern: string;
  worseningTrend: string | null;
  dailyLifeImpact: string | null;
}

export interface PainHealthDomainState extends BaseDomainState {
  mostRecent: PainReportSummary | null;
  reportCountAllTime: number;
  reportCountLast90Days: number;
  /** Nao e' inferencia de causalidade — so' conta quantos relatos distintos existem no periodo. */
  recurrenceObserved: boolean;
}

export interface FitnessTestSummary {
  createdAt: string;
  testType: string;
  totalSeconds: number;
  paceSecondsPerKm: number;
  vo2maxEstimated: number;
}

export interface TargetRaceSummary {
  name: string;
  raceDate: string;
  distanceKm: number;
  status: string;
  priority: string;
}

export interface PerformanceCapacityDomainState extends BaseDomainState {
  latestFitnessTest: FitnessTestSummary | null;
  fitnessTestHistoryCount: number;
  upcomingTargetRaces: TargetRaceSummary[];
  /** Reassessment existe mas o conteudo relevante (evolutionSummary) e' narrativo — nao extraido deterministicamente nesta V1. */
  reassessmentsRecorded: number;
  reassessmentContentAvailability: 'unavailable_narrative_only';
}

export interface BehaviorDomainState extends VariableBasedDomainState {
  adherence: { allTime: AdherenceSummary; last4Weeks: AdherenceSummary; last8Weeks: AdherenceSummary } | null;
  consistency: ConsistencyStreak | null;
  checkinsSubmittedAllTime: number;
  checkinsSkippedAllTime: number;
}

export interface LifeContextDomainState extends BaseDomainState {
  /** Nomes das fontes que TEM conteudo (nao o conteudo em si) — StudentObservation/StudentDirective
   * continuam texto livre, nao estruturado (ver ATHLETE_STATE_MODEL.md). */
  narrativeSourcesWithContent: string[];
  // Passo 4 (25/09/2026) — ContextEvent estruturado. activeEvents/recentEvents nunca despejam o
  // historico inteiro (so' ongoing + ultimos ~60 dias, no maximo 5). currentGapStatus descreve se
  // ha uma lacuna de execucao em curso (>= GAP_RETURN_THRESHOLD_DAYS sem execucao valida observada)
  // — isso e' OBSERVACAO, nunca causa. latestReturnContext e' o ultimo questionario de retorno
  // respondido pelo proprio aluno, se houver.
  activeEvents: Array<{ type: string; subtype: string | null; startedAt: string | null; source: string }>;
  recentEvents: Array<{ type: string; subtype: string | null; startedAt: string | null; endedAt: string | null; source: string }>;
  currentGapStatus: { inGap: boolean; daysSinceLastObserved: number | null; thresholdDays: number };
  latestReturnContext: {
    gapDurationDays: number | null;
    reasonType: string;
    reasonSubtype: string | null;
    trainingDuringGapReported: string | null;
    physicalStateComparedToBefore: number | null;
    mentalReadinessComparedToBefore: number | null;
  } | null;
}

export interface VariableDynamicsFlag {
  variableId: string;
  direction: 'above' | 'below' | null;
  startTimestamp: string | null;
  durationDays: number | null;
}

export interface RecoveredExcursionFlag {
  variableId: string;
  direction: 'above' | 'below';
  returnTimestamp: string | null;
  levelRecovered: boolean | null;
  variabilityRecovered: boolean | null;
}

export interface SystemDynamicsDomainState extends BaseDomainState {
  variablesCurrentlyOutsideHabitualRange: VariableDynamicsFlag[];
  ongoingExcursions: VariableDynamicsFlag[];
  recentlyRecoveredExcursions: RecoveredExcursionFlag[];
  variablesWithChangedVariability: Array<{ variableId: string; direction: 'increased' | 'decreased' }>;
}

export interface EvidenceQualityDomainState {
  perVariable: Record<
    string,
    {
      n: number;
      observedSpan: { from: string | null; to: string | null };
      lastObservationAt: string | null;
      instrumentVersions: number[];
      comparabilityWarning: string | null;
      anyPartialWindow: boolean;
    }
  >;
  overall: {
    variablesWithData: number;
    variablesWithoutData: number;
    mostRecentObservationAt: string | null;
    variablesWithComparabilityWarning: string[];
  };
}

export interface AthleteStateSnapshotV1 {
  athleteId: string;
  generatedAt: string;
  compact: Record<string, unknown>;
  domains: {
    training: TrainingDomainState;
    sleepRecovery: VariableBasedDomainState;
    physicalState: VariableBasedDomainState;
    psychologicalState: VariableBasedDomainState;
    trainingResponse: VariableBasedDomainState;
    painHealth: PainHealthDomainState;
    performanceCapacity: PerformanceCapacityDomainState;
    behavior: BehaviorDomainState;
    lifeContext: LifeContextDomainState;
    systemDynamics: SystemDynamicsDomainState;
  };
  evidenceQuality: EvidenceQualityDomainState;
}

// Agrupamento de variaveis do VariableRegistry por dominio do Athlete State Model. Overlap
// intencional (ex: postPhysicalFatigue aparece em physicalState E trainingResponse — mesma
// variavel, duas lentes de leitura, ATHLETE_STATE_MODEL.md secoes 7 e 9) — o snapshot busca cada
// variavel UMA vez (cache abaixo) e referencia o mesmo objeto nos dois dominios.
const SLEEP_RECOVERY_VARIABLES = [
  'workout.preSleepQuality',
  'workout.sleepDurationHoursEstimate',
  'workout.sleepScheduleIrregularity',
  'workout.sleepInterruption',
  'workout.sleepDifficulty',
];
const PHYSICAL_STATE_VARIABLES = ['workout.prePhysicalFatigue', 'workout.postPhysicalFatigue', 'checkin.bodyResponseVsNormal'];
const PSYCHOLOGICAL_STATE_VARIABLES = [
  'workout.preMentalFatigue',
  'workout.postMentalFatigue',
  'workout.preStressLevel',
  'workout.preMotivation',
  'workout.emotionalExperienceDuring',
  'workout.mentalStateChangePrePost',
  'checkin.postWeekMotivation',
];
const TRAINING_RESPONSE_VARIABLES = [
  'workout.perceivedEffort',
  'workout.executionVsPrescribed',
  'workout.satisfactionElaboracao',
  'workout.postPhysicalFatigue',
  'workout.postMentalFatigue',
  'workout.emotionalExperienceDuring',
  'workout.mentalStateChangePrePost',
  'checkin.prescriptionLiking',
  'checkin.prescriptionSuitability',
  'checkin.executionSatisfaction',
  'checkin.weekDemandVsNormal',
];
const BEHAVIOR_VARIABLES = ['checkin.expectedRoutineInterference'];

const ALL_DOMAIN_VARIABLE_IDS = [
  ...new Set([
    ...SLEEP_RECOVERY_VARIABLES,
    ...PHYSICAL_STATE_VARIABLES,
    ...PSYCHOLOGICAL_STATE_VARIABLES,
    ...TRAINING_RESPONSE_VARIABLES,
    ...BEHAVIOR_VARIABLES,
  ]),
];

const PAIN_RECURRENCE_WINDOW_DAYS = 90;

@Injectable()
export class AthleteStateSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingIntelligenceQuery: TrainingIntelligenceQueryService,
    private readonly evolutionMetric: EvolutionMetricService,
    private readonly contextEvents: ContextEventsService,
  ) {}

  async getSnapshot(athleteId: string): Promise<AthleteStateSnapshotV1> {
    const variableCache = new Map<string, VariableStateEntry>();
    const getVariable = async (variableId: string): Promise<VariableStateEntry> => {
      const cached = variableCache.get(variableId);
      if (cached) return cached;
      const { observations: _observations, ...rest } = await this.trainingIntelligenceQuery.getVariableSnapshot(athleteId, variableId);

      // Quebra por modalidade (25/09/2026, extensao da Exploracao Longitudinal ate o agente) —
      // FILTRAR -> CALCULAR -> gerar entrada, nunca "calcular global e filtrar visualmente depois".
      // Cada modalidade e' a MESMA chamada canonica (getVariableSnapshot), so' com o filtro — nenhuma
      // segunda matematica. So' inclui modalidade com evidencia real (n>0); nunca uma serie vazia.
      let byModality: Record<string, Omit<VariableSnapshotResponse, 'observations'>> | undefined;
      if (rest.availableModalities.length > 0) {
        const perModality = await Promise.all(
          rest.availableModalities.map(async (modality) => {
            const { observations: _obs, ...modRest } = await this.trainingIntelligenceQuery.getVariableSnapshot(athleteId, variableId, [modality]);
            return [modality, modRest] as const;
          }),
        );
        const withEvidence = perModality.filter(([, snap]) => snap.evidence.n > 0);
        if (withEvidence.length > 0) byModality = Object.fromEntries(withEvidence);
      }

      const entry: VariableStateEntry = {
        ...rest,
        byModality,
        traceRef: { variableId, endpoint: `/coach/students/${athleteId}/observations/${variableId}` },
      };
      variableCache.set(variableId, entry);
      return entry;
    };

    // Pre-busca todas as variaveis usadas em qualquer dominio, uma unica vez cada.
    await Promise.all(ALL_DOMAIN_VARIABLE_IDS.map((id) => getVariable(id)));

    const sleepRecovery = await this.buildVariableDomain(SLEEP_RECOVERY_VARIABLES, getVariable);
    const physicalState = await this.buildVariableDomain(PHYSICAL_STATE_VARIABLES, getVariable);
    const psychologicalState = await this.buildVariableDomain(PSYCHOLOGICAL_STATE_VARIABLES, getVariable);
    const trainingResponse = await this.buildVariableDomain(TRAINING_RESPONSE_VARIABLES, getVariable);
    const behaviorVariables = await this.buildVariableDomain(BEHAVIOR_VARIABLES, getVariable);

    const [training, behaviorExtra] = await this.buildTrainingAndBehaviorBase(athleteId);
    const behavior: BehaviorDomainState = {
      availability: this.combineAvailability([behaviorVariables.availability, behaviorExtra.availability]),
      variables: behaviorVariables.variables,
      adherence: behaviorExtra.adherence,
      consistency: behaviorExtra.consistency,
      checkinsSubmittedAllTime: behaviorExtra.checkinsSubmittedAllTime,
      checkinsSkippedAllTime: behaviorExtra.checkinsSkippedAllTime,
    };

    const painHealth = await this.buildPainHealthDomain(athleteId);
    const performanceCapacity = await this.buildPerformanceCapacityDomain(athleteId);
    const lifeContext = await this.buildLifeContextDomain(athleteId);

    const allVariableEntries = [...variableCache.values()];
    const systemDynamics = this.buildSystemDynamicsDomain(allVariableEntries);
    const evidenceQuality = this.buildEvidenceQuality(allVariableEntries);

    const domains: AthleteStateSnapshotV1['domains'] = {
      training,
      sleepRecovery,
      physicalState,
      psychologicalState,
      trainingResponse,
      painHealth,
      performanceCapacity,
      behavior,
      lifeContext,
      systemDynamics,
    };

    return {
      athleteId,
      generatedAt: new Date().toISOString(),
      compact: this.buildCompact(domains),
      domains,
      evidenceQuality,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Dominios baseados em variavel (VariableRegistry) — reaproveita TrainingIntelligenceQueryService.
  // ---------------------------------------------------------------------------------------------

  private async buildVariableDomain(
    variableIds: string[],
    getVariable: (id: string) => Promise<VariableStateEntry>,
  ): Promise<VariableBasedDomainState> {
    const variables: Record<string, VariableStateEntry> = {};
    for (const id of variableIds) {
      variables[id] = await getVariable(id);
    }
    const withData = Object.values(variables).filter((v) => v.evidence.n > 0);
    const availability: DomainAvailability =
      withData.length === 0 ? 'unavailable' : withData.length === variableIds.length ? 'available' : 'partial';
    return { availability, variables };
  }

  // ---------------------------------------------------------------------------------------------
  // Training + Behavior (base) — reaproveita EvolutionMetricService, que ja trata sessao-fantasma/
  // extra (ver evolution-metric.service.ts). Nao recalcula nada aqui.
  // ---------------------------------------------------------------------------------------------

  private async buildTrainingAndBehaviorBase(athleteId: string): Promise<[
    TrainingDomainState,
    { availability: DomainAvailability; adherence: TrainingDomainState['adherence']; consistency: ConsistencyStreak | null; checkinsSubmittedAllTime: number; checkinsSkippedAllTime: number },
  ]> {
    let overview: Awaited<ReturnType<EvolutionMetricService['getOverview']>> | null = null;
    try {
      overview = await this.evolutionMetric.getOverview(athleteId);
    } catch {
      overview = null;
    }

    const training: TrainingDomainState = overview
      ? {
          availability: overview.totalWeeksWithPlan > 0 ? 'available' : 'unavailable',
          dataAvailableSince: overview.dataAvailableSince,
          totalWeeksWithPlan: overview.totalWeeksWithPlan,
          adherence: overview.adherence,
          consistency: overview.consistency,
          modalityBreakdown: overview.modalityBreakdown,
          recentWeeks: overview.recentWeeks,
        }
      : {
          availability: 'unavailable',
          dataAvailableSince: null,
          totalWeeksWithPlan: 0,
          adherence: null,
          consistency: null,
          modalityBreakdown: [],
          recentWeeks: [],
        };

    const checkins = await this.prisma.weeklyCheckIn.findMany({
      where: { userId: athleteId },
      select: { checkinSkipped: true },
    });
    const checkinsSkippedAllTime = checkins.filter((c) => c.checkinSkipped).length;
    const checkinsSubmittedAllTime = checkins.length - checkinsSkippedAllTime;

    const behaviorExtra = {
      availability: (overview && overview.totalWeeksWithPlan > 0 ? 'available' : 'unavailable') as DomainAvailability,
      adherence: training.adherence,
      consistency: training.consistency,
      checkinsSubmittedAllTime,
      checkinsSkippedAllTime,
    };

    return [training, behaviorExtra];
  }

  private combineAvailability(items: DomainAvailability[]): DomainAvailability {
    if (items.every((a) => a === 'unavailable')) return 'unavailable';
    if (items.every((a) => a === 'available')) return 'available';
    return 'partial';
  }

  // ---------------------------------------------------------------------------------------------
  // Dor / saude — leitura direta de PainReport. Dor != lesao; nenhum diagnostico inventado.
  // ---------------------------------------------------------------------------------------------

  private async buildPainHealthDomain(athleteId: string): Promise<PainHealthDomainState> {
    const reports = await this.prisma.painReport.findMany({
      where: { userId: athleteId },
      orderBy: { createdAt: 'desc' },
    });

    if (reports.length === 0) {
      return { availability: 'unavailable', mostRecent: null, reportCountAllTime: 0, reportCountLast90Days: 0, recurrenceObserved: false };
    }

    const cutoff = new Date(Date.now() - PAIN_RECURRENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recentCount = reports.filter((r) => r.createdAt >= cutoff).length;
    const latest = reports[0];

    return {
      availability: 'available',
      mostRecent: {
        createdAt: latest.createdAt.toISOString(),
        regions: latest.regions,
        intensity: latest.intensity,
        onsetPattern: latest.onsetPattern,
        persistencePattern: latest.persistencePattern,
        worseningTrend: latest.worseningTrend,
        dailyLifeImpact: latest.dailyLifeImpact,
      },
      reportCountAllTime: reports.length,
      reportCountLast90Days: recentCount,
      recurrenceObserved: recentCount >= 2,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Performance/capacidade — so' campos estruturados (FitnessTest/TargetRace). Reassessment.
  // evolutionSummary e' narrativo — marcado indisponivel deterministicamente, nao extraido.
  // ---------------------------------------------------------------------------------------------

  private async buildPerformanceCapacityDomain(athleteId: string): Promise<PerformanceCapacityDomainState> {
    const [tests, races, reassessments] = await Promise.all([
      this.prisma.fitnessTest.findMany({ where: { userId: athleteId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.targetRace.findMany({ where: { userId: athleteId, status: 'em_andamento' }, orderBy: { raceDate: 'asc' } }),
      this.prisma.reassessment.count({ where: { userId: athleteId, completedAt: { not: null } } }),
    ]);

    const latest = tests[0];
    const availability: DomainAvailability = tests.length > 0 || races.length > 0 ? (tests.length > 0 ? 'available' : 'partial') : 'unavailable';

    return {
      availability,
      latestFitnessTest: latest
        ? {
            createdAt: latest.createdAt.toISOString(),
            testType: latest.testType,
            totalSeconds: latest.totalSeconds,
            paceSecondsPerKm: latest.paceSecondsPerKm,
            vo2maxEstimated: latest.vo2maxEstimated,
          }
        : null,
      fitnessTestHistoryCount: tests.length,
      upcomingTargetRaces: races.map((r) => ({
        name: r.name,
        raceDate: r.raceDate.toISOString(),
        distanceKm: r.distanceKm,
        status: r.status,
        priority: r.priority,
      })),
      reassessmentsRecorded: reassessments,
      reassessmentContentAvailability: 'unavailable_narrative_only',
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Contexto de vida — Passo 4 (25/09/2026): ContextEvent estruturado somado as fontes narrativas
  // que ja existiam (StudentObservation/StudentDirective continuam so' contadas, texto livre nunca
  // estruturado). "Existe contexto ativo/recente relevante pra entender o estado atual?"
  // ---------------------------------------------------------------------------------------------

  private async buildLifeContextDomain(athleteId: string): Promise<LifeContextDomainState> {
    const [observations, directives, lifeContext] = await Promise.all([
      this.prisma.studentObservation.count({ where: { userId: athleteId, active: true } }),
      this.prisma.studentDirective.count({ where: { userId: athleteId, active: true } }),
      this.contextEvents.getLifeContextData(athleteId),
    ]);

    const sources: string[] = [];
    if (observations > 0) sources.push('StudentObservation');
    if (directives > 0) sources.push('StudentDirective');

    const hasStructuredContext = lifeContext.activeEvents.length > 0 || lifeContext.recentEvents.length > 0 || lifeContext.latestReturnContext !== null;
    const hasAnyContext = sources.length > 0 || hasStructuredContext || lifeContext.currentGapStatus.inGap;

    return {
      availability: hasStructuredContext ? 'partial' : sources.length > 0 ? 'partial' : 'unavailable',
      notes:
        sources.length > 0
          ? 'Existem fontes narrativas (texto livre) sobre contexto de vida (StudentObservation/StudentDirective) alem dos ContextEvents estruturados abaixo, quando houver.'
          : hasAnyContext
            ? 'Contexto estruturado (ContextEvent) disponivel abaixo.'
            : 'Nenhuma fonte de contexto de vida registrada.',
      narrativeSourcesWithContent: sources,
      activeEvents: lifeContext.activeEvents,
      recentEvents: lifeContext.recentEvents,
      currentGapStatus: lifeContext.currentGapStatus,
      latestReturnContext: lifeContext.latestReturnContext,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // System dynamics — consome a Dinamica Longitudinal ja implementada, nao recalcula nada.
  // ---------------------------------------------------------------------------------------------

  private buildSystemDynamicsDomain(entries: VariableStateEntry[]): SystemDynamicsDomainState {
    const variablesCurrentlyOutsideHabitualRange: VariableDynamicsFlag[] = [];
    const ongoingExcursions: VariableDynamicsFlag[] = [];
    const recentlyRecoveredExcursions: RecoveredExcursionFlag[] = [];
    const variablesWithChangedVariability: SystemDynamicsDomainState['variablesWithChangedVariability'] = [];

    for (const entry of entries) {
      const variableId = entry.variable.id;

      if (entry.persistence?.currentlyOutsideHabitualRange) {
        variablesCurrentlyOutsideHabitualRange.push({
          variableId,
          direction: entry.persistence.direction,
          startTimestamp: entry.persistence.startTimestamp,
          durationDays: entry.persistence.durationDays,
        });
      }

      const excursions = entry.excursions ?? [];
      const ongoing = excursions.find((e) => e.ongoing);
      if (ongoing) {
        ongoingExcursions.push({ variableId, direction: ongoing.direction, startTimestamp: ongoing.startTimestamp, durationDays: ongoing.durationDays });
      }
      const lastReturned = [...excursions].reverse().find((e) => e.returnDynamics?.returned);
      if (lastReturned?.returnDynamics) {
        recentlyRecoveredExcursions.push({
          variableId,
          direction: lastReturned.direction,
          returnTimestamp: lastReturned.returnDynamics.returnTimestamp,
          levelRecovered: lastReturned.returnDynamics.levelRecovery.recovered,
          variabilityRecovered: lastReturned.returnDynamics.variabilityRecovery.recovered,
        });
      }

      if (entry.variabilityChange && (entry.variabilityChange.direction === 'increased' || entry.variabilityChange.direction === 'decreased')) {
        variablesWithChangedVariability.push({ variableId, direction: entry.variabilityChange.direction });
      }
    }

    const availability: DomainAvailability = entries.some((e) => e.evidence.n > 0) ? 'available' : 'unavailable';

    return { availability, variablesCurrentlyOutsideHabitualRange, ongoingExcursions, recentlyRecoveredExcursions, variablesWithChangedVariability };
  }

  // ---------------------------------------------------------------------------------------------
  // Qualidade da evidencia — componentes objetivos, nunca um "confidence score" unico.
  // ---------------------------------------------------------------------------------------------

  private buildEvidenceQuality(entries: VariableStateEntry[]): EvidenceQualityDomainState {
    const perVariable: EvidenceQualityDomainState['perVariable'] = {};
    let mostRecentObservationAt: string | null = null;
    const variablesWithComparabilityWarning: string[] = [];
    let variablesWithData = 0;
    let variablesWithoutData = 0;

    for (const entry of entries) {
      const anyPartialWindow = Boolean(
        entry.baseline?.isPartialWindow || Object.values(entry.movingAverages ?? {}).some((m) => m.isPartialWindow),
      );
      perVariable[entry.variable.id] = {
        n: entry.evidence.n,
        observedSpan: entry.evidence.observedSpan,
        lastObservationAt: entry.evidence.lastObservationAt,
        instrumentVersions: entry.evidence.instrumentVersions,
        comparabilityWarning: entry.evidence.comparabilityWarning,
        anyPartialWindow,
      };
      if (entry.evidence.n > 0) variablesWithData++;
      else variablesWithoutData++;
      if (entry.evidence.comparabilityWarning) variablesWithComparabilityWarning.push(entry.variable.id);
      if (entry.evidence.lastObservationAt && (!mostRecentObservationAt || entry.evidence.lastObservationAt > mostRecentObservationAt)) {
        mostRecentObservationAt = entry.evidence.lastObservationAt;
      }
    }

    return {
      perVariable,
      overall: { variablesWithData, variablesWithoutData, mostRecentObservationAt, variablesWithComparabilityWarning },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Compacto — selecao de campos ja calculados, nunca um score novo.
  // ---------------------------------------------------------------------------------------------

  private buildCompact(domains: AthleteStateSnapshotV1['domains']): Record<string, unknown> {
    const compactVariableDomain = (domain: VariableBasedDomainState) => ({
      availability: domain.availability,
      variables: Object.fromEntries(
        Object.entries(domain.variables).map(([id, v]) => [
          id,
          {
            current: v.current,
            trendShort: v.trend?.short_21d?.direction ?? null,
            relativeDeviation: v.deviation?.relativeDeviation ?? null,
            currentlyOutsideHabitualRange: v.persistence?.currentlyOutsideHabitualRange ?? null,
            n: v.evidence.n,
          },
        ]),
      ),
    });

    return {
      training: {
        availability: domains.training.availability,
        adherenceLast4Weeks: domains.training.adherence?.last4Weeks.adherencePercent ?? null,
        lowCoverageWarning: domains.training.adherence?.last4Weeks.lowCoverageWarning ?? null,
        currentStreakWeeks: domains.training.consistency?.currentStreakWeeks ?? null,
      },
      sleepRecovery: compactVariableDomain(domains.sleepRecovery),
      physicalState: compactVariableDomain(domains.physicalState),
      psychologicalState: compactVariableDomain(domains.psychologicalState),
      trainingResponse: compactVariableDomain(domains.trainingResponse),
      painHealth: {
        availability: domains.painHealth.availability,
        mostRecentIntensity: domains.painHealth.mostRecent?.intensity ?? null,
        worseningTrend: domains.painHealth.mostRecent?.worseningTrend ?? null,
        recurrenceObserved: domains.painHealth.recurrenceObserved,
      },
      performanceCapacity: {
        availability: domains.performanceCapacity.availability,
        latestTestPaceSecondsPerKm: domains.performanceCapacity.latestFitnessTest?.paceSecondsPerKm ?? null,
        upcomingRaceCount: domains.performanceCapacity.upcomingTargetRaces.length,
      },
      behavior: {
        availability: domains.behavior.availability,
        adherenceAllTime: domains.behavior.adherence?.allTime.adherencePercent ?? null,
        checkinsSubmittedAllTime: domains.behavior.checkinsSubmittedAllTime,
      },
      lifeContext: { availability: domains.lifeContext.availability },
      systemDynamics: {
        availability: domains.systemDynamics.availability,
        variablesCurrentlyOutsideHabitualRangeCount: domains.systemDynamics.variablesCurrentlyOutsideHabitualRange.length,
        ongoingExcursionsCount: domains.systemDynamics.ongoingExcursions.length,
      },
    };
  }
}
