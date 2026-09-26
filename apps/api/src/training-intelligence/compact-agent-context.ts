// CompactAgentContext — Passo 2/6 (25/09/2026, auditoria aprovada) + CORRECAO DE FECHAMENTO
// (25/09/2026, correcao 1): representacao derivada do Athlete State Snapshot especificamente para
// consumo pelo prescription-agent.
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
//   atual pode ser uma excursao aguda ou o padrao habitual dependendo da trajetoria;
// - preserva a semantica original de cada variavel (constructLabel/direction/scale do
//   VariableRegistry — nunca inverte escala pra "5=bom");
// - preserva os componentes objetivos de evidencia (n, span, recencia, versao, janela parcial,
//   incompatibilidade) sem colapsar em um "confidence score" unico.
//
// CORRECAO 1 (compressao estrutural, 25/09/2026) — o Compact Agent Context real media 27-30KB por
// aluno. Auditoria encontrou DUAS redundancias estruturais reais (nao de conteudo, de FORMA):
// (a) semantica (constructLabel/scale/direction) repetida em CADA aparicao da variavel — como
//     algumas variaveis aparecem em 2 dominios (ex: postPhysicalFatigue em physicalState E
//     trainingResponse, ver athlete-state-snapshot.service.ts), essa semantica estatica era
//     serializada duas vezes. Corrigido: extraida pra `variableLegend`, uma entrada por variableId,
//     nunca repetida — os dominios agora so' referenciam `variableIds: string[]`.
// (b) o objeto inteiro da variavel (trend/baseline/deviation/variability/habitualRange/excursion)
//     era JSON-serializado duas vezes pela mesma razao de overlap entre dominios (JSON nao tem
//     referencia/ponteiro — a MESMA referencia de objeto em JS vira dois blocos de texto identicos
//     no JSON). Corrigido: pool unico `variables: Record<variableId, CompactVariableState>` no topo,
//     cada variavel calculada e serializada uma unica vez, dominios so' guardam os ids.
// (c) variaveis sem NENHUMA observacao (n=0) carregavam uma dezena de campos explicitamente null
//     (trend/baseline/deviation/variability/habitualRange/excursion) — informacao zero, so' ruido.
//     Corrigido: quando evidence.n===0, a entrada fica so' `{ evidence }` (omite os demais campos
//     via undefined, que JSON.stringify remove) — nenhuma informacao e' perdida porque null-em-tudo
//     e ausencia-de-dado sao exatamente a mesma coisa; so' deixamos de escrever isso por extenso.
// Nenhuma variavel foi removida do envio, nenhuma selecao "clinica" de relevancia foi feita — a
// compressao e' inteiramente estrutural/sintatica.

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
import type { VariableSnapshotResponse } from './training-intelligence-query.service';

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

/**
 * Estado compacto de UMA variavel. Quando evidence.n===0, so' `evidence` e' preenchido — os demais
 * campos ficam ausentes (nao "null" escrito por extenso) porque nao ha absolutamente nada a
 * descrever sobre nivel/trajetoria/variabilidade de uma variavel sem nenhuma observacao.
 */
export interface CompactVariableState {
  current?: number | null;
  trend?: { recent: string; mediumTerm: string };
  baseline?: number | null;
  deviationFromBaseline?: { absolute: number | null; relative: number | null };
  variability?: { recent: number | null; habitual: number | null; change: string };
  habitualRange?: { lower: number | null; upper: number | null } | null;
  currentlyOutsideHabitualRange?: boolean | null;
  /** Excursao mais recente (em curso ou ja concluida) — nao a lista inteira. */
  mostRecentExcursion?: CompactExcursionSummary | null;
  totalExcursionsObserved?: number;
  evidence: {
    n: number;
    observedSpan: { from: string | null; to: string | null };
    lastObservationAt: string | null;
    instrumentVersions: number[];
    comparabilityWarning: string | null;
    isPartialWindow: boolean;
  };
  /**
   * Quebra por modalidade (25/09/2026) — so' presente quando a variavel depende de modalidade E
   * existe evidencia real (n>0) especificamente naquela modalidade (nunca uma serie vazia so' pra
   * "completar" a lista). Cada valor tem exatamente a MESMA forma deste objeto (recursivo), MENOS
   * este proprio campo (modalidade nao se subdivide de novo) — filtrar->calcular->comprimir, uma
   * unica vez por modalidade, nunca uma segunda matematica.
   */
  byModality?: Record<string, Omit<CompactVariableState, 'byModality'>>;
}

/** Semantica ESTATICA da variavel (nunca muda por observacao) — uma entrada por variableId, nunca repetida por dominio. */
export interface VariableLegendEntry {
  constructLabel?: string;
  scale?: { min: number; max: number; unit?: string };
  direction: string;
}

export interface CompactVariableDomainRef {
  availability: DomainAvailability;
  variableIds: string[];
}

export interface CompactAgentContext {
  athleteId: string;
  generatedAt: string;
  /** Semantica de cada variavel citada em qualquer dominio abaixo — consulte por variableId. */
  variableLegend: Record<string, VariableLegendEntry>;
  /** Estado calculado de cada variavel, uma unica vez — os dominios abaixo so' referenciam o id. */
  variables: Record<string, CompactVariableState>;
  training: TrainingDomainState;
  sleepRecovery: CompactVariableDomainRef;
  physicalState: CompactVariableDomainRef;
  psychologicalState: CompactVariableDomainRef;
  trainingResponse: CompactVariableDomainRef;
  painHealth: PainHealthDomainState;
  performanceCapacity: PerformanceCapacityDomainState;
  behavior: Omit<BehaviorDomainState, 'variables'> & CompactVariableDomainRef;
  lifeContext: LifeContextDomainState;
  systemDynamics: SystemDynamicsDomainState;
  evidenceQuality: {
    variablesWithData: number;
    variablesWithoutData: number;
    mostRecentObservationAt: string | null;
    variablesWithComparabilityWarning: string[];
  };
}

type CompactableSnapshot = Omit<VariableSnapshotResponse, 'observations'> & {
  byModality?: Record<string, Omit<VariableSnapshotResponse, 'observations'>>;
};

function compactVariable(entry: CompactableSnapshot): CompactVariableState {
  // Quebra por modalidade: cada uma passa pela MESMA funcao (recursivo), nunca uma segunda
  // matematica ou compressao diferente. So' existe quando o Snapshot ja filtrou por evidencia real.
  const byModality = entry.byModality
    ? Object.fromEntries(Object.entries(entry.byModality).map(([modality, snap]) => [modality, compactVariable(snap)]))
    : undefined;

  if (entry.evidence.n === 0) {
    // Sem nenhuma observacao: nivel/trajetoria/variabilidade/excursao nao existem pra descrever —
    // manter os campos ausentes (em vez de "null" repetido) preserva a MESMA informacao (ausencia)
    // com muito menos texto.
    return {
      evidence: {
        n: 0,
        observedSpan: entry.evidence.observedSpan,
        lastObservationAt: entry.evidence.lastObservationAt,
        instrumentVersions: entry.evidence.instrumentVersions,
        comparabilityWarning: entry.evidence.comparabilityWarning,
        isPartialWindow: true,
      },
      ...(byModality ? { byModality } : {}),
    };
  }

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
    ...(byModality ? { byModality } : {}),
  };
}

/**
 * Registra (id->estado, id->legenda) no pool compartilhado SE ainda nao estiver la — garante que
 * cada variavel e' calculada/serializada uma unica vez mesmo citada por varios dominios.
 */
function registerVariable(
  pool: Record<string, CompactVariableState>,
  legend: Record<string, VariableLegendEntry>,
  id: string,
  entry: VariableStateEntry,
): void {
  if (!(id in pool)) {
    pool[id] = compactVariable(entry);
    legend[id] = { constructLabel: entry.variable.constructLabel, scale: entry.variable.scale, direction: entry.variable.direction };
  }
}

function domainRef(
  pool: Record<string, CompactVariableState>,
  legend: Record<string, VariableLegendEntry>,
  domain: VariableBasedDomainState,
): CompactVariableDomainRef {
  const variableIds = Object.keys(domain.variables);
  for (const id of variableIds) {
    registerVariable(pool, legend, id, domain.variables[id]);
  }
  return { availability: domain.availability, variableIds };
}

/**
 * Deriva o Compact Agent Context a partir de um Athlete State Snapshot ja calculado. Funcao pura —
 * nao faz I/O, nao recalcula matematica, nao chama LLM. O chamador (training-plans.service.ts) e'
 * responsavel por buscar o Snapshot e tratar falha (nunca deve quebrar a geracao semanal).
 */
export function buildCompactAgentContext(snapshot: AthleteStateSnapshotV1): CompactAgentContext {
  const variables: Record<string, CompactVariableState> = {};
  const variableLegend: Record<string, VariableLegendEntry> = {};

  const sleepRecovery = domainRef(variables, variableLegend, snapshot.domains.sleepRecovery);
  const physicalState = domainRef(variables, variableLegend, snapshot.domains.physicalState);
  const psychologicalState = domainRef(variables, variableLegend, snapshot.domains.psychologicalState);
  const trainingResponse = domainRef(variables, variableLegend, snapshot.domains.trainingResponse);
  const behaviorRef = domainRef(variables, variableLegend, {
    availability: snapshot.domains.behavior.availability,
    variables: snapshot.domains.behavior.variables,
  });

  return {
    athleteId: snapshot.athleteId,
    generatedAt: snapshot.generatedAt,
    variableLegend,
    variables,
    training: snapshot.domains.training,
    sleepRecovery,
    physicalState,
    psychologicalState,
    trainingResponse,
    painHealth: snapshot.domains.painHealth,
    performanceCapacity: snapshot.domains.performanceCapacity,
    behavior: {
      availability: behaviorRef.availability,
      variableIds: behaviorRef.variableIds,
      adherence: snapshot.domains.behavior.adherence,
      consistency: snapshot.domains.behavior.consistency,
      checkinsSubmittedAllTime: snapshot.domains.behavior.checkinsSubmittedAllTime,
      checkinsSkippedAllTime: snapshot.domains.behavior.checkinsSkippedAllTime,
    },
    lifeContext: snapshot.domains.lifeContext,
    systemDynamics: snapshot.domains.systemDynamics,
    evidenceQuality: snapshot.evidenceQuality.overall,
  };
}
