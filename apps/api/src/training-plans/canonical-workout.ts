import { canonicalModality } from '../activity-execution/canonical-modality';

// CanonicalWorkout — representacao CANONICA e independente de provider de uma TrainingSession de corrida estruturada. NAO e' o modelo da Apple:
// e' o que o Panzeri Run prescreveu, em unidades canonicas (metros, segundos, segundos/km), com ordem e repeticao preservadas. Adaptadores
// (Apple/WorkoutKit hoje; Polar e Garmin depois) consomem isto e declaram o que conseguem ou nao representar.
//
// Regras desta camada:
//  - SO' traduz a estrutura que ja' foi decidida (IA ou treinador); nao escolhe treino, nao calcula prescricao.
//  - Distingue dado PRESCRITO de dado DERIVADO: duracao de passo por distancia (durationRange/durationMin) e' derivada e NAO vira meta; a banda
//    de +-20 s que o gerador cria em torno do pace dos intervalados e' tolerancia derivada pelo sistema, nunca a prescricao.
//  - `activity` so' e' 'run'/'walk' quando o passo traz activityType EXPLICITO (Admin). Texto livre ("Caminhar") NAO e' promovido: fica
//    'unknown', com um aviso.
//  - Perda de representacao nunca e' silenciosa: vira `losses` (impede representar) ou `warnings` (ambiguidade/derivacao a conhecer).
//  - Nao altera TrainingSession e nao toca em banco.

export const CANONICAL_WORKOUT_SCHEMA = 'panzeri.canonical-workout';
export const CANONICAL_WORKOUT_SCHEMA_VERSION = 1;

export type CanonicalActivity = 'run' | 'walk' | 'unknown';
export type CanonicalStepRole = 'main' | 'work' | 'recovery';

export type CanonicalGoal =
  | { type: 'distance'; meters: number }
  | { type: 'time'; seconds: number }
  | { type: 'open' };

export interface CanonicalPaceBound {
  fastSecPerKm: number;
  slowSecPerKm: number;
}

// Pace de um passo. `prescribed` e' o que foi decidido (valor unico quando fast === slow, ou faixa). `derivedToleranceBand` existe so' quando o
// sistema criou uma banda em volta de um valor unico prescrito (intervalados do gerador): e' dado derivado, nunca a prescricao.
export interface CanonicalPace {
  prescribed: CanonicalPaceBound;
  derivedToleranceBand: (CanonicalPaceBound & { toleranceSec: number }) | null;
}

export interface CanonicalIntensity {
  mode: 'pace' | 'speed' | 'zone' | 'rpe' | null;
  zone: string | null;
  rpe: string | null;
}

export interface CanonicalStep {
  kind: 'step';
  label: string | null; // texto original, preservado
  role: CanonicalStepRole;
  roleBasis: 'single_part' | 'explicit_pause_type' | 'position_in_interval' | 'unspecified';
  activity: CanonicalActivity;
  activityBasis: 'explicit_activity_type' | 'not_specified';
  goal: CanonicalGoal;
  pace: CanonicalPace | null;
  intensity: CanonicalIntensity | null;
  recoveryKind: 'active' | 'passive' | null;
  notes: string | null;
}

export interface CanonicalRepeat {
  kind: 'repeat';
  repeatCount: number;
  label: string | null;
  steps: CanonicalStep[];
}

export type CanonicalWorkoutItem = CanonicalStep | CanonicalRepeat;

export interface CanonicalIssue {
  code: string;
  message: string;
  path: string;
}

export interface CanonicalWorkout {
  schema: typeof CANONICAL_WORKOUT_SCHEMA;
  schemaVersion: typeof CANONICAL_WORKOUT_SCHEMA_VERSION;
  trainingSessionId: string | null;
  modality: string | null; // modalidade canonica da sessao
  items: CanonicalWorkoutItem[]; // ORDEM da prescricao
  // false quando algo do que foi prescrito nao pode ser representado (ver losses).
  complete: boolean;
  warnings: CanonicalIssue[];
  losses: CanonicalIssue[];
  // Totais DERIVADOS da prescricao (soma das metas por distancia/tempo, ja' multiplicadas pelas repeticoes).
  derived: { totalDistanceMeters: number; totalPrescribedSeconds: number; stepCount: number };
}

export interface CanonicalWorkoutSessionInput {
  id: string | null;
  modality: string | null;
  structure: unknown;
}

type Raw = Record<string, unknown>;

function asObject(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// "5:45/km", "5:45/km a 5:45/km", "5:25/km a 5:40/km" -> tokens m:ss. Um token = valor unico; dois = faixa.
function parsePaceTokens(value: unknown): number[] {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/(\d+):(\d{2})/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
}

const WALK_HINT = /caminh|walk/i;
const GENERATED_TOLERANCE_SEC = 20; // tolerancia que TrainingPlansService.intervalStep aplica em volta do pace do intervalado

export function buildCanonicalWorkout(session: CanonicalWorkoutSessionInput): CanonicalWorkout {
  const warnings: CanonicalIssue[] = [];
  const losses: CanonicalIssue[] = [];
  const items: CanonicalWorkoutItem[] = [];
  const structure = asObject(session.structure);
  const modality = canonicalModality(session.modality) ?? null;
  const warn = (code: string, message: string, path: string) => warnings.push({ code, message, path });
  const lose = (code: string, message: string, path: string) => losses.push({ code, message, path });

  function activityOf(step: Raw, path: string, label: string | null): Pick<CanonicalStep, 'activity' | 'activityBasis'> {
    const explicit = step.activityType;
    if (explicit === 'corrida') return { activity: 'run', activityBasis: 'explicit_activity_type' };
    if (explicit === 'caminhada') return { activity: 'walk', activityBasis: 'explicit_activity_type' };
    // Texto livre NAO e' promovido a activityType: so' avisa que o rotulo sugere caminhada.
    if (label && WALK_HINT.test(label)) {
      warn('label_suggests_walking_not_promoted', `O rotulo "${label}" sugere caminhada, mas nao ha activityType explicito: a atividade fica 'unknown'.`, path);
    }
    return { activity: 'unknown', activityBasis: 'not_specified' };
  }

  function goalOf(step: Raw, path: string): CanonicalGoal {
    const durationType = asText(step.durationType) ?? (asNumber(step.distanceValue) != null ? 'distance' : 'time');
    if (durationType === 'distance') {
      const value = asNumber(step.distanceValue);
      if (value == null || value <= 0) {
        lose('goal_distance_invalid', 'Passo por distancia sem distancia valida.', path);
        return { type: 'open' };
      }
      const unit = step.distanceUnit === 'm' ? 'm' : 'km';
      return { type: 'distance', meters: Math.round((unit === 'm' ? value : value * 1000) * 1000) / 1000 };
    }
    if (durationType === 'time') {
      const minutes = asNumber(step.durationMin);
      if (minutes == null || minutes <= 0) {
        lose('goal_time_invalid', 'Passo por tempo sem duracao valida.', path);
        return { type: 'open' };
      }
      return { type: 'time', seconds: Math.round(minutes * 60) };
    }
    lose('goal_unknown_type', `Tipo de meta nao reconhecido (${durationType}).`, path);
    return { type: 'open' };
  }

  // fingerprint do gerador (TrainingPlansService.intervalStep): passo de intervalado com durationMinLower/Upper e banda exata de +-20 s
  function paceOf(step: Raw, path: string, insideRepeat: boolean): CanonicalPace | null {
    const tokens = parsePaceTokens(step.paceRange);
    if (tokens.length === 0) {
      if (asText(step.speedRange)) warn('speed_only_pace_missing', 'Passo com velocidade mas sem pace: nao ha pace prescrito para converter.', path);
      return null;
    }
    const fast = Math.min(...tokens);
    const slow = Math.max(...tokens);
    const bandWidth = slow - fast;
    const generatedFingerprint = typeof step.durationMinLower === 'number' || typeof step.durationMinUpper === 'number';
    if (insideRepeat && generatedFingerprint && bandWidth === GENERATED_TOLERANCE_SEC * 2 && (fast + slow) % 2 === 0) {
      const center = (fast + slow) / 2;
      warn('derived_tolerance_band', `Banda de +-${GENERATED_TOLERANCE_SEC}s criada pelo sistema em torno de ${center}s/km; o prescrito e' o valor unico.`, path);
      return { prescribed: { fastSecPerKm: center, slowSecPerKm: center }, derivedToleranceBand: { fastSecPerKm: fast, slowSecPerKm: slow, toleranceSec: GENERATED_TOLERANCE_SEC } };
    }
    return { prescribed: { fastSecPerKm: fast, slowSecPerKm: slow }, derivedToleranceBand: null };
  }

  function intensityOf(step: Raw): CanonicalIntensity | null {
    const mode = asText(step.intensityMode);
    const zone = asText(step.zone);
    const rpe = asText(step.rpe);
    if (!mode && !zone && !rpe) return null;
    const known = mode === 'pace' || mode === 'speed' || mode === 'zone' || mode === 'rpe' ? mode : null;
    return { mode: known, zone, rpe };
  }

  function buildStep(step: Raw, path: string, role: CanonicalStepRole, roleBasis: CanonicalStep['roleBasis'], insideRepeat: boolean): CanonicalStep {
    const label = asText(step.label);
    const pausaType = step.pausaType === 'passiva' ? 'passive' : step.pausaType === 'ativa' ? 'active' : null;
    return {
      kind: 'step',
      label,
      role,
      roleBasis,
      ...activityOf(step, path, label),
      goal: goalOf(step, path),
      // pausa passiva nao tem pace
      pace: pausaType === 'passive' ? null : paceOf(step, path, insideRepeat),
      intensity: intensityOf(step),
      recoveryKind: role === 'recovery' ? pausaType : null,
      notes: asText(step.guidance) ?? asText(step.observacao),
    };
  }

  if (!structure || structure.type !== 'run') {
    lose('structure_not_run', 'A estrutura da sessao nao e uma corrida estruturada.', 'structure');
  } else {
    const blocks = Array.isArray(structure.blocks) ? (structure.blocks as unknown[]) : [];
    if (blocks.length === 0) {
      // Sessao legada/simples sem blocks: um unico passo principal com a distancia da sessao.
      const km = asNumber(structure.distanceKm);
      if (km != null && km > 0) {
        warn('implicit_single_block', 'Sessao sem blocks: tratada como um unico passo principal pela distancia da sessao.', 'structure');
        items.push({
          kind: 'step', label: null, role: 'main', roleBasis: 'single_part', activity: 'unknown', activityBasis: 'not_specified',
          goal: { type: 'distance', meters: Math.round(km * 1000 * 1000) / 1000 },
          pace: paceOf({ paceRange: structure.paceRange }, 'structure', false), intensity: null, recoveryKind: null, notes: null,
        });
      } else {
        lose('no_blocks', 'Sessao de corrida sem blocos e sem distancia.', 'structure');
      }
    }
    blocks.forEach((rawBlock, blockIndex) => {
      const path = `blocks[${blockIndex}]`;
      const block = asObject(rawBlock);
      if (!block) {
        lose('block_unreadable', 'Bloco ilegivel.', path);
        return;
      }
      const repeatCount = asNumber(block.repeatCount);
      const rawSteps = Array.isArray(block.steps) ? (block.steps as unknown[]) : null;
      if (rawSteps && repeatCount != null) {
        if (!Number.isInteger(repeatCount) || repeatCount < 1) {
          lose('repeat_count_invalid', `repeatCount invalido (${String(block.repeatCount)}).`, path);
          return;
        }
        const steps = rawSteps.map((rawStep, stepIndex): CanonicalStep => {
          const stepPath = `${path}.steps[${stepIndex}]`;
          const step = asObject(rawStep) ?? {};
          const hasPause = step.pausaType === 'ativa' || step.pausaType === 'passiva';
          if (hasPause) return buildStep(step, stepPath, 'recovery', 'explicit_pause_type', true);
          if (rawSteps.length === 2) return buildStep(step, stepPath, stepIndex === 0 ? 'work' : 'recovery', 'position_in_interval', true);
          warn('role_not_explicit', 'Papel do passo (estimulo/recuperacao) nao explicito: tratado como estimulo.', stepPath);
          return buildStep(step, stepPath, 'work', 'unspecified', true);
        });
        if (steps.length === 0) lose('repeat_without_steps', 'Bloco repetido sem passos.', path);
        items.push({ kind: 'repeat', repeatCount, label: asText(block.label), steps });
        return;
      }
      if (rawSteps || repeatCount != null) warn('repeat_block_incomplete', 'Bloco com steps ou repeatCount incompleto: tratado como passo simples.', path);
      items.push(buildStep(block, path, 'main', 'single_part', false));
    });
  }

  if (structure && structure.type === 'run' && asText(structure.durationRange)) {
    warn('duration_range_ignored_derived', 'durationRange da sessao e derivado (distancia x pace) e nao e meta: nao foi usado.', 'structure.durationRange');
  }

  let totalDistanceMeters = 0;
  let totalPrescribedSeconds = 0;
  let stepCount = 0;
  const addStep = (step: CanonicalStep, times: number) => {
    stepCount += times;
    if (step.goal.type === 'distance') totalDistanceMeters += step.goal.meters * times;
    if (step.goal.type === 'time') totalPrescribedSeconds += step.goal.seconds * times;
  };
  for (const item of items) {
    if (item.kind === 'step') addStep(item, 1);
    else for (const step of item.steps) addStep(step, item.repeatCount);
  }

  return {
    schema: CANONICAL_WORKOUT_SCHEMA,
    schemaVersion: CANONICAL_WORKOUT_SCHEMA_VERSION,
    trainingSessionId: session.id,
    modality,
    items,
    complete: losses.length === 0 && items.length > 0,
    warnings,
    losses,
    derived: { totalDistanceMeters: Math.round(totalDistanceMeters * 1000) / 1000, totalPrescribedSeconds, stepCount },
  };
}
