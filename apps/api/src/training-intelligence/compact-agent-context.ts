// CompactAgentContext — Passo 2/6 (25/09/2026, auditoria aprovada): representacao derivada do
// Athlete State Snapshot especificamente para consumo pelo prescription-agent.
//
// Fluxo: RAW DATA -> OBSERVATIONS -> MATH LAYER -> LONGITUDINAL DYNAMICS -> ATHLETE STATE SNAPSHOT
//        -> COMPACT AGENT CONTEXT -> PRESCRIPTION AGENT.
//
// Este arquivo NAO calcula nada. E' uma funcao pura de selecao/reformatacao sobre o Snapshot ja
// pronto (AthleteStateSnapshotV1) — nenhum campo aqui e' um numero novo, todos vem de
// TrainingIntelligenceQueryService/LongitudinalDynamicsService, ja calculados.
//
// Principio central (Elton, 25/09/2026): a matematica CARACTERIZA o sistema; o agente INTERPRETA.
// Por isso este arquivo:
// - nunca reduz nada a um score (sem "readiness", sem "confidence: 83%", sem "bom/ruim/pronto");
// - preserva as dimensoes SEPARADAS (sono, fadiga fisica, fadiga mental, estresse, motivacao,
//   resposta ao treino, dor... nunca combinadas);
// - preserva o par (nivel atual, trajetoria) por variavel, nao so o valor atual — o mesmo valor
//   atual pode ser uma excursao aguda ou o padrao habitual dependendo da trajetoria (ver
//   ATHLETE_STATE_MODEL.md e a instrucao original: "fadiga=4" nao significa a mesma coisa pra dois
//   atletas com baselines diferentes, nem pro mesmo atleta em dois momentos diferentes);
// - preserva a semantica original de cada variavel (constructLabel/direction/scale do
//   VariableRegistry — nunca inverte escala pra "5=bom");
// - preserva os componentes objetivos de evidencia (n, span, recencia, versao, janela parcial,
//   incompatibilidade) sem colapsar em um "confidence score" unico — a forca da evidencia fica
//   visivel, a decisao de quanto pesar isso e' do agente, nao de uma regra fixa daqui.
//
// O que este arquivo NAO faz (deliberadamente): nao envia a lista bruta de observacoes (isso e'
// nivel 3, ja acessivel via endpoint /coach/students/:id/observations/:variableId quando alguem —
// nao o LLM — precisar auditar o registro original); nao envia todas as excursoes historicas de
// uma variavel, so' a mais recente + uma contagem (mais um sinal do que uma investigacao).

import type {
  AthleteStateSnapshotV1,
  VariableStateEntry,
  VariableBasedDomainState,
  TrainingDomainState,
  PainHealthDomainState,
  PerformanceCapacityDomainState,
  BehaviorDomainState,
  LifeContextDomainState,
  SystemDynamicsDomainState,
  DomainAvailability,
} from './athlete-state-snapshot.service';

export interface CompactExcursionSummary {
  direction: 'above' | 'below';
  startTimestamp: string;
  durationDays: number;
  observationCount: number;
  magnitude: number;
  ongoing: boolean;
  returned: boolean | null;
  levelRecovered: boolean | null;
  variabilityRecovered: boolean | null;
  overshootOccurred: boolean | null;
}

export interface CompactVariableState {
  /** O que especificamente "mais" significa nesta variavel — nunca presuma "5=bom" sem checar aqui. */
  constructLabel?: string;
  scale?: { min: number; max: number; unit?: string };
  direction: string;
  current: number | null;
  trend: { recent: string; mediumTerm: string };
  baseline: number | null;
  deviationFromBaseline: { absolute: number | null; relative: number | null };
  variability: { recent: number | null; habitual: number | null; change: string };
  habitualRange: { lower: number | null; upper: number | null } | null;
  currentlyOutsideHabitualRange: boolean | null;
  /** Excursao mais recente (em curso ou ja concluida) — nao a lista inteira, ver nota no topo do arquivo. */
  mostRecentExcursion: CompactExcursionSummary | null;
  totalExcursionsObserved: number;
  evidence: {
    n: number;
    observedSpan: { from: string | null; to: string | null };
    lastObservationAt: string | null;
    instrumentVersions: number[];
    comparabilityWarning: string | null;
    isPartialWindow: boolean;
  };
}

export interface CompactVariableDomain {
  availability: DomainAvailability;
  variables: Record<string, CompactVariableState>;
}

export interface CompactAgentContext {
  athleteId: string;
  generatedAt: string;
  training: TrainingDomainState;
  sleepRecovery: CompactVariableDomain;
  physicalState: CompactVariableDomain;
  psychologicalState: CompactVariableDomain;
  trainingResponse: CompactVariableDomain;
  painHealth: PainHealthDomainState;
  performanceCapacity: PerformanceCapacityDomainState;
  behavior: Omit<BehaviorDomainState, 'variables'> & { variables: Record<string, CompactVariableState> };
  lifeContext: LifeContextDomainState;
  systemDynamics: SystemDynamicsDomainState;
  evidenceQuality: {
    variablesWithData: number;
    variablesWithoutData: number;
    mostRecentObservationAt: string | null;
    variablesWithComparabilityWarning: string[];
  };
}

function compactVariable(entry: VariableStateEntry): CompactVariableState {
  const excursions = entry.excursions ?? [];
  const last = excursions[excursions.length - 1] ?? null;
  const mostRecentExcursion: CompactExcursionSummary | null = last
    ? {
        direction: last.direction,
        startTimestamp: last.startTimestamp,
        durationDays: last.durationDays,
        observationCount: last.observationCount,
        magnitude: last.magnitude,
        ongoing: last.ongoing,
        returned: last.returnDynamics?.returned ?? null,
        levelRecovered: last.returnDynamics?.levelRecovery.recovered ?? null,
        variabilityRecovered: last.returnDynamics?.variabilityRecovery.recovered ?? null,
        overshootOccurred: last.returnDynamics?.overshoot?.occurred ?? null,
      }
    : null;

  const anyPartialWindow = Boolean(
    entry.baseline?.isPartialWindow || Object.values(entry.movingAverages ?? {}).some((m) => m.isPartialWindow),
  );

  return {
    constructLabel: entry.variable.constructLabel,
    scale: entry.variable.scale,
    direction: entry.variable.direction,
    current: entry.current,
    trend: {
      recent: entry.trend?.short_21d?.direction ?? 'insufficient_data',
      mediumTerm: entry.trend?.medium_60d?.direction ?? 'insufficient_data',
    },
    baseline: entry.baseline?.value ?? null,
    deviationFromBaseline: {
      absolute: entry.deviation?.absoluteDeviation ?? null,
      relative: entry.deviation?.relativeDeviation ?? null,
    },
    variability: {
      recent: entry.variabilityChange?.recent.mad ?? null,
      habitual: entry.variabilityChange?.habitual.mad ?? null,
      change: entry.variabilityChange?.direction ?? 'insufficient_data',
    },
    habitualRange: entry.habitualRange ? { lower: entry.habitualRange.lower, upper: entry.habitualRange.upper } : null,
    currentlyOutsideHabitualRange: entry.persistence?.currentlyOutsideHabitualRange ?? null,
    mostRecentExcursion,
    totalExcursionsObserved: excursions.length,
    evidence: {
      n: entry.evidence.n,
      observedSpan: entry.evidence.observedSpan,
      lastObservationAt: entry.evidence.lastObservationAt,
      instrumentVersions: entry.evidence.instrumentVersions,
      comparabilityWarning: entry.evidence.comparabilityWarning,
      isPartialWindow: anyPartialWindow,
    },
  };
}

function compactVariableDomain(domain: VariableBasedDomainState): CompactVariableDomain {
  return {
    availability: domain.availability,
    variables: Object.fromEntries(Object.entries(domain.variables).map(([id, entry]) => [id, compactVariable(entry)])),
  };
}

/**
 * Deriva o Compact Agent Context a partir de um Athlete State Snapshot ja calculado. Funcao pura —
 * nao faz I/O, nao recalcula matematica, nao chama LLM. O chamador (training-plans.service.ts) e'
 * responsavel por buscar o Snapshot e tratar falha (nunca deve quebrar a geracao semanal).
 */
export function buildCompactAgentContext(snapshot: AthleteStateSnapshotV1): CompactAgentContext {
  return {
    athleteId: snapshot.athleteId,
    generatedAt: snapshot.generatedAt,
    training: snapshot.domains.training,
    sleepRecovery: compactVariableDomain(snapshot.domains.sleepRecovery),
    physicalState: compactVariableDomain(snapshot.domains.physicalState),
    psychologicalState: compactVariableDomain(snapshot.domains.psychologicalState),
    trainingResponse: compactVariableDomain(snapshot.domains.trainingResponse),
    painHealth: snapshot.domains.painHealth,
    performanceCapacity: snapshot.domains.performanceCapacity,
    behavior: {
      availability: snapshot.domains.behavior.availability,
      adherence: snapshot.domains.behavior.adherence,
      consistency: snapshot.domains.behavior.consistency,
      checkinsSubmittedAllTime: snapshot.domains.behavior.checkinsSubmittedAllTime,
      checkinsSkippedAllTime: snapshot.domains.behavior.checkinsSkippedAllTime,
      variables: Object.fromEntries(Object.entries(snapshot.domains.behavior.variables).map(([id, entry]) => [id, compactVariable(entry)])),
    },
    lifeContext: snapshot.domains.lifeContext,
    systemDynamics: snapshot.domains.systemDynamics,
    evidenceQuality: snapshot.evidenceQuality.overall,
  };
}
