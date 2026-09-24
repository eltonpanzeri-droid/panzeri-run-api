// Passo 3 (25/09/2026) — Camada deterministica de trajetoria longitudinal da reavaliacao.
//
// RAW DATA (OnboardingInterview.answers + Reassessment.answers, na ordem cronologica real) ->
// esta camada (normalizacao + comparabilidade) -> Evolution Report.
//
// Principios obrigatorios (ordem de Elton, Passo 3):
// - Preserva o CAMINHO inteiro (INITIAL -> R1 -> R2 -> R3...), nunca reduz a inicial-vs-atual.
// - Ausencia de dado (versao antiga do instrumento sem aquele campo) e' MISSING, nunca zero.
// - Nao inventa equivalencia: cada variavel declara sua propria comparabilidade (DIRECT / PARTIAL /
//   NOT_COMPARABLE / NOT_APPLICABLE) e o Evolution Agent recebe essa etiqueta junto com os dados.
// - Nao calcula nenhuma regra de prescricao aqui — isso e so' organizacao/normalizacao de historico.

// Versao do instrumento de reavaliacao a partir desta implementacao. Reavaliacoes concluidas antes
// disso ficam com reassessmentVersion = null (legado, versao indeterminada, nunca reclassificada).
export const REASSESSMENT_INSTRUMENT_VERSION = 2;

// Versao da entrevista inicial a partir desta implementacao (mesma logica de legado = null).
export const ONBOARDING_INTERVIEW_VERSION = 1;

export type Comparability = 'DIRECT' | 'PARTIAL' | 'NOT_COMPARABLE' | 'NOT_APPLICABLE';

export interface TrajectoryPoint {
  source: 'initial' | 'reassessment';
  reassessmentId: string | null;
  completedAt: string;
  instrumentVersion: number | null;
  value: number | string | string[] | null;
  normalized?: boolean;
}

export interface VariableTrajectory {
  variableId: string;
  label: string;
  domain: string;
  kind: 'rating_1_10' | 'numeric_km' | 'numeric_kg' | 'categorical_objective' | 'boolean_pain' | 'categorical_pain_regions';
  comparability: Comparability;
  unit: string | null;
  points: TrajectoryPoint[];
  n: number;
}

interface OnboardingInput {
  answers: Record<string, unknown>;
  completedAt: Date | null;
  interviewVersion: number | null;
}

interface ReassessmentInput {
  id: string;
  answers: Record<string, unknown>;
  completedAt: Date | null;
  reassessmentVersion: number | null;
}

// Mesmas 17 chaves/textos de `ratingPrompts` em apps/mobile/App.tsx — NAO reformular sem atualizar
// os dois lugares. Domínio segue o mapeamento ja usado pelo Athlete State Snapshot (auditoria do
// Passo 3, secao 9) para permitir cruzamento futuro sem redefinir taxonomia.
const RATING_DEFS: Array<{ key: string; label: string; domain: string }> = [
  { key: 'rating_energy', label: 'Energia no dia a dia', domain: 'physicalState' },
  { key: 'rating_training_readiness', label: 'Disposicao para treinar', domain: 'behavior' },
  { key: 'rating_fitness', label: 'Condicionamento fisico', domain: 'performanceCapacity' },
  { key: 'rating_strength', label: 'Forca fisica', domain: 'performanceCapacity' },
  { key: 'rating_sleep', label: 'Qualidade do sono', domain: 'sleepRecovery' },
  { key: 'rating_recovery', label: 'Recuperacao apos os treinos', domain: 'sleepRecovery' },
  { key: 'rating_stress', label: 'Nivel de estresse', domain: 'psychologicalState' },
  { key: 'rating_anxiety', label: 'Nivel de ansiedade', domain: 'psychologicalState' },
  { key: 'rating_motivation', label: 'Motivacao para treinar', domain: 'psychologicalState' },
  { key: 'rating_nutrition', label: 'Qualidade da alimentacao', domain: 'behavior' },
  { key: 'rating_hydration', label: 'Hidratacao', domain: 'behavior' },
  { key: 'rating_health', label: 'Saude geral', domain: 'painHealth' },
  { key: 'rating_pain_free', label: 'Quanto o corpo esta livre de dores', domain: 'painHealth' },
  { key: 'rating_body_satisfaction', label: 'Satisfacao com o corpo', domain: 'psychologicalState' },
  { key: 'rating_quality_of_life', label: 'Qualidade de vida', domain: 'psychologicalState' },
  { key: 'rating_goal_confidence', label: 'Confianca de que atingira o objetivo', domain: 'psychologicalState' },
  { key: 'rating_routine_support', label: 'Quanto a rotina atual favorece o objetivo', domain: 'behavior' },
];

export const REASSESSMENT_RATING_KEYS = RATING_DEFS.map((d) => d.key);

const OBJECTIVE_OPTIONS = [
  'Comecar a correr', 'Completar 5 km', 'Melhorar meu tempo nos 5 km', 'Completar 10 km',
  'Melhorar meu tempo nos 10 km', 'Completar 21 km', 'Melhorar meu tempo nos 21 km',
  'Completar 42 km', 'Melhorar meu tempo nos 42 km',
];

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function point(
  source: 'initial' | 'reassessment',
  reassessmentId: string | null,
  completedAt: Date | null,
  instrumentVersion: number | null,
  value: number | string | string[] | null,
  normalized?: boolean,
): TrajectoryPoint {
  return {
    source,
    reassessmentId,
    completedAt: (completedAt ?? new Date(0)).toISOString(),
    instrumentVersion,
    value,
    normalized,
  };
}

function finalize(
  variableId: string,
  label: string,
  domain: string,
  kind: VariableTrajectory['kind'],
  comparability: Comparability,
  unit: string | null,
  points: TrajectoryPoint[],
): VariableTrajectory {
  return {
    variableId,
    label,
    domain,
    kind,
    comparability,
    unit,
    points,
    n: points.filter((p) => p.value !== null).length,
  };
}

/**
 * Constroi a trajetoria comparavel INITIAL -> R1 -> R2 -> R3... para cada variavel longitudinal
 * conhecida. Reavaliacoes devem vir ja ordenadas cronologicamente (completedAt asc) e apenas as
 * concluidas (completedAt != null). Nao muta nenhum dos objetos de entrada.
 */
export function buildReassessmentTrajectories(
  onboarding: OnboardingInput | null,
  reassessments: ReassessmentInput[],
): VariableTrajectory[] {
  const trajectories: VariableTrajectory[] = [];

  for (const def of RATING_DEFS) {
    const points: TrajectoryPoint[] = [
      point('initial', null, onboarding?.completedAt ?? null, onboarding?.interviewVersion ?? null, onboarding ? toNumber(onboarding.answers[def.key]) : null),
      ...reassessments.map((r) => point('reassessment', r.id, r.completedAt, r.reassessmentVersion, toNumber(r.answers[def.key]))),
    ];
    trajectories.push(finalize(`reassessment.${def.key}`, def.label, def.domain, 'rating_1_10', 'DIRECT', '1-10', points));
  }

  // Km/semana declarado: a entrevista inicial e a reavaliacao (v2+) usam a MESMA chave
  // canonica ('weekly_running_km'), mesma unidade e mesmo tipo de input (wheel_number). A
  // reavaliacao v1 (legado) usava 'reassessment_weekly_km_now' (numero livre, mesma unidade km) —
  // normalizado aqui (mesma grandeza fisica, so' widget de entrada diferente), nunca reescrito no
  // banco.
  const kmPoints: TrajectoryPoint[] = [
    point('initial', null, onboarding?.completedAt ?? null, onboarding?.interviewVersion ?? null, onboarding ? toNumber(onboarding.answers.weekly_running_km) : null),
    ...reassessments.map((r) => {
      const canonical = toNumber(r.answers.weekly_running_km);
      if (canonical !== null) return point('reassessment', r.id, r.completedAt, r.reassessmentVersion, canonical);
      const legacy = toNumber(r.answers.reassessment_weekly_km_now);
      return point('reassessment', r.id, r.completedAt, r.reassessmentVersion, legacy, legacy !== null);
    }),
  ];
  trajectories.push(finalize('reassessment.weekly_running_km', 'Quilometragem semanal declarada', 'performanceCapacity', 'numeric_km', 'DIRECT', 'km/semana', kmPoints));

  // Peso: ja e' DIRETO desde a auditoria (mesma unidade kg nos dois instrumentos).
  const weightPoints: TrajectoryPoint[] = [
    point('initial', null, onboarding?.completedAt ?? null, onboarding?.interviewVersion ?? null, onboarding ? toNumber(onboarding.answers.personal_weight) : null),
    ...reassessments.map((r) => point('reassessment', r.id, r.completedAt, r.reassessmentVersion, toNumber(r.answers.reassessment_weight))),
  ];
  trajectories.push(finalize('reassessment.weight', 'Peso corporal', 'performanceCapacity', 'numeric_kg', 'DIRECT', 'kg', weightPoints));

  // Objetivo: so' comparavel diretamente para reavaliacoes v2+ (mesma chave/opcoes canonicas da
  // entrevista inicial). Reavaliacoes legadas perguntavam "mudou sim/nao" + texto livre — isso NAO
  // e' convertido automaticamente numa das 9 opcoes canonicas (seria inventar dado), entao vira
  // ponto ausente (missing) nessa serie. Por isso a variavel inteira e' PARTIAL, nao DIRECT.
  const objectivePoints: TrajectoryPoint[] = [
    point('initial', null, onboarding?.completedAt ?? null, onboarding?.interviewVersion ?? null, onboarding ? asCanonicalObjective(onboarding.answers.objective) : null),
    ...reassessments.map((r) => point('reassessment', r.id, r.completedAt, r.reassessmentVersion, asCanonicalObjective(r.answers.objective))),
  ];
  trajectories.push(finalize('reassessment.objective', 'Objetivo declarado', 'lifeContext', 'categorical_objective', 'PARTIAL', null, objectivePoints));

  // Dor atual (presenca): a reavaliacao v2+ reaplica a MESMA pergunta ("Voce sente dor
  // atualmente?") com as mesmas opcoes da entrevista inicial -> DIRETO. A reavaliacao legada
  // perguntava algo semanticamente diferente ("dor NOVA desde a ultima avaliacao", nao "dor
  // atual agora") -> nao e' mapeada para esta serie (fica ausente, nunca convertida).
  const painPoints: TrajectoryPoint[] = [
    point('initial', null, onboarding?.completedAt ?? null, onboarding?.interviewVersion ?? null, onboarding ? asYesNo(onboarding.answers.current_pain) : null),
    ...reassessments.map((r) => point('reassessment', r.id, r.completedAt, r.reassessmentVersion, asYesNo(r.answers.current_pain))),
  ];
  trajectories.push(finalize('reassessment.current_pain', 'Dor atual (presenca)', 'painHealth', 'boolean_pain', 'DIRECT', null, painPoints));

  // Regioes de dor: estrutura mais granular, so' existe quando current_pain = 'yes' E o
  // instrumento reaplicado (v2+) foi usado — comparabilidade PARTIAL porque o legado nunca teve
  // granularidade por regiao.
  const painRegionPoints: TrajectoryPoint[] = [
    point('initial', null, onboarding?.completedAt ?? null, onboarding?.interviewVersion ?? null, onboarding ? asStringArray(onboarding.answers.pain_regions) : null),
    ...reassessments.map((r) => point('reassessment', r.id, r.completedAt, r.reassessmentVersion, asStringArray(r.answers.pain_regions))),
  ];
  trajectories.push(finalize('reassessment.pain_regions', 'Regioes de dor', 'painHealth', 'categorical_pain_regions', 'PARTIAL', null, painRegionPoints));

  return trajectories;
}

function asCanonicalObjective(value: unknown): string | null {
  return typeof value === 'string' && OBJECTIVE_OPTIONS.includes(value) ? value : null;
}

function asYesNo(value: unknown): string | null {
  return value === 'yes' || value === 'no' ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') && value.length > 0 ? (value as string[]) : null;
}

export interface FitnessTestPoint {
  createdAt: string;
  paceSecondsPerKm: number;
  totalSeconds: number;
  vo2maxEstimated: number;
}

/** Preserva a trajetoria inteira de testes de 3km, do mais antigo ao mais recente. Nunca reduz ao ultimo. */
export function buildFitnessTestTrajectory(
  tests: Array<{ createdAt: Date; paceSecondsPerKm: number; totalSeconds: number; vo2maxEstimated: number }>,
): FitnessTestPoint[] {
  return [...tests]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((t) => ({
      createdAt: t.createdAt.toISOString(),
      paceSecondsPerKm: t.paceSecondsPerKm,
      totalSeconds: t.totalSeconds,
      vo2maxEstimated: t.vo2maxEstimated,
    }));
}
