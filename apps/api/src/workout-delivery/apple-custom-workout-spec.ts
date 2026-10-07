import { createHash } from 'node:crypto';
import { CanonicalStep, CanonicalWorkout } from '../training-plans/canonical-workout';

// Tradutor Apple: CanonicalWorkout -> AppleCustomWorkoutSpec (especificacao INTERMEDIARIA, em JSON, que o modulo Swift vai montar como
// WorkoutKit CustomWorkout em uma etapa posterior). Esta camada NAO agenda nada, NAO fala com o WorkoutKit e NAO conhece WorkoutDelivery.
//
// Conjunto seguro desta etapa: passos por DISTANCIA, em ordem — continuo unico, sequencia de continuos, bloco intervalado com repeatCount
// (work/recovery por distancia) e qualquer combinacao disso. Preservados: ordem, distancia, repeatCount, papel work/recovery.
//
// Fora desta etapa, de proposito:
//  - alertas de pace (nenhum SpeedRangeAlert): o pace continua so' no CanonicalWorkout/snapshot, e a banda derivada (+-20 s) NUNCA e' usada;
//  - passos por tempo, pausa passiva, meta aberta, esteira, aquecimento/desaquecimento inferidos, nomes de passo (iOS 18+).
// Se algo nao puder ser traduzido sem inventar informacao, o tradutor RECUSA com motivo explicito.
//
// O CustomWorkout continua sendo UMA atividade de corrida: caminhada (explicita ou sugerida por texto) e' enviada como passo de corrida e a perda
// semantica fica registrada em `losses`. `activity = 'unknown'` nao impede a traducao.

export const APPLE_CUSTOM_WORKOUT_SPEC_VERSION = 1;
export const APPLE_TRANSLATOR_VERSION = 1;
export const APPLE_MAX_TOTAL_DISTANCE_METERS = 100_000; // mesmo teto ja usado pelo envio simples (0 a 100 km)

export interface AppleIntervalStepSpec {
  purpose: 'work' | 'recovery';
  goal: { type: 'distance'; meters: number };
}

export interface AppleIntervalBlockSpec {
  iterations: number;
  steps: AppleIntervalStepSpec[];
}

export interface AppleCustomWorkoutSpec {
  specVersion: typeof APPLE_CUSTOM_WORKOUT_SPEC_VERSION;
  translatorVersion: typeof APPLE_TRANSLATOR_VERSION;
  activity: 'running';
  location: 'outdoor';
  // Nunca inferidos: o Panzeri Run nao tem aquecimento/desaquecimento estruturados.
  warmup: null;
  cooldown: null;
  blocks: AppleIntervalBlockSpec[];
  // Rastro da origem e hash deterministico do conteudo enviado (usado depois para detectar "a prescricao mudou").
  source: { canonicalSchemaVersion: number; trainingSessionId: string | null };
  specHash: string;
}

export interface AppleTranslationLoss {
  code: string;
  kind: 'semantic' | 'omitted';
  message: string;
  path: string;
}

export interface AppleTranslationRefusal {
  code: string;
  message: string;
  path: string;
}

export type AppleTranslationResult =
  | { ok: true; spec: AppleCustomWorkoutSpec; losses: AppleTranslationLoss[]; canonicalWarningCodes: string[]; unverifiedOnDevice: string[] }
  | { ok: false; refusals: AppleTranslationRefusal[] };

// Pontos que a documentacao da Apple nao resolve e que so' um aparelho confirma (ver auditoria da Etapa 4).
const UNVERIFIED_ON_DEVICE = ['interval_block_with_single_work_step'];

export function translateToAppleCustomWorkout(workout: CanonicalWorkout): AppleTranslationResult {
  const refusals: AppleTranslationRefusal[] = [];
  const losses: AppleTranslationLoss[] = [];
  const refuse = (code: string, message: string, path: string) => refusals.push({ code, message, path });

  if (workout.modality !== 'corrida') {
    refuse(workout.modality === 'esteira' ? 'indoor_not_supported_yet' : 'modality_not_running', `Modalidade "${workout.modality ?? 'desconhecida'}" nao e corrida em ambiente aberto.`, 'modality');
  }
  if (!workout.complete) {
    for (const loss of workout.losses) refuse(`canonical_${loss.code}`, loss.message, loss.path);
    if (workout.losses.length === 0) refuse('canonical_incomplete', 'O CanonicalWorkout nao esta completo.', 'items');
  }

  const blocks: AppleIntervalBlockSpec[] = [];

  const translateStep = (step: CanonicalStep, path: string, purpose: 'work' | 'recovery'): AppleIntervalStepSpec | null => {
    if (step.goal.type !== 'distance') {
      refuse(step.goal.type === 'time' ? 'goal_time_not_supported_yet' : 'goal_open_not_supported', step.goal.type === 'time' ? 'Passo por tempo ainda nao e traduzido nesta etapa.' : 'Passo sem meta definida.', path);
      return null;
    }
    if (step.role === 'recovery' && step.recoveryKind === 'passive') {
      // pausa passiva exige meta de tempo (ja recusada acima); registra o motivo especifico se vier por distancia
      refuse('passive_recovery_not_supported_yet', 'Pausa passiva nao e traduzida nesta etapa.', path);
      return null;
    }
    if (!Number.isFinite(step.goal.meters) || step.goal.meters <= 0) {
      refuse('distance_invalid', 'Distancia do passo invalida.', path);
      return null;
    }
    if (step.activity === 'walk') {
      losses.push({ code: 'walk_explicit_sent_as_running', kind: 'semantic', message: 'Passo de caminhada explicito sera enviado como passo de corrida (o CustomWorkout e uma unica atividade).', path });
    }
    if (step.pace) {
      losses.push({ code: 'pace_not_sent', kind: 'omitted', message: 'Pace prescrito mantido no CanonicalWorkout; alertas de pace nao sao enviados nesta versao.', path });
    }
    if (step.intensity && (step.intensity.mode === 'zone' || step.intensity.mode === 'rpe')) {
      losses.push({ code: 'intensity_not_sent', kind: 'omitted', message: `Intensidade prescrita (${step.intensity.mode}) nao tem equivalente enviado.`, path });
    }
    if (step.label || step.notes) {
      losses.push({ code: 'label_and_notes_not_sent', kind: 'omitted', message: 'Rotulo/orientacao do passo nao sao enviados (nome de passo exige iOS 18+).', path });
    }
    return { purpose, goal: { type: 'distance', meters: step.goal.meters } };
  };

  workout.items.forEach((item, index) => {
    const path = `items[${index}]`;
    if (item.kind === 'step') {
      const translated = translateStep(item, path, 'work');
      if (translated) blocks.push({ iterations: 1, steps: [translated] });
      return;
    }
    if (!Number.isInteger(item.repeatCount) || item.repeatCount < 1) {
      refuse('repeat_count_invalid', 'repeatCount invalido.', path);
      return;
    }
    const steps: AppleIntervalStepSpec[] = [];
    item.steps.forEach((step, stepIndex) => {
      const translated = translateStep(step, `${path}.steps[${stepIndex}]`, step.role === 'recovery' ? 'recovery' : 'work');
      if (translated) steps.push(translated);
    });
    if (steps.length === item.steps.length && steps.length > 0) blocks.push({ iterations: item.repeatCount, steps });
  });

  // Banda derivada nunca e' usada; o aviso do CanonicalWorkout so' e' repassado como codigo.
  const canonicalWarningCodes = workout.warnings.map((w) => w.code);
  if (canonicalWarningCodes.includes('label_suggests_walking_not_promoted')) {
    losses.push({ code: 'walk_suggested_by_label', kind: 'semantic', message: 'Algum rotulo sugere caminhada (sem activityType explicito): o passo segue como corrida, sem promover o texto.', path: 'items' });
  }

  const totalMeters = blocks.reduce((sum, block) => sum + block.iterations * block.steps.reduce((s, step) => s + step.goal.meters, 0), 0);
  if (blocks.length > 0 && totalMeters > APPLE_MAX_TOTAL_DISTANCE_METERS) {
    refuse('distance_out_of_range', `Distancia total de ${totalMeters} m acima do limite aceito (${APPLE_MAX_TOTAL_DISTANCE_METERS} m).`, 'items');
  }
  if (blocks.length === 0 && refusals.length === 0) refuse('nothing_to_translate', 'Nenhum passo traduzivel.', 'items');

  if (refusals.length > 0) return { ok: false, refusals };

  const content = { activity: 'running' as const, location: 'outdoor' as const, blocks };
  const specHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return {
    ok: true,
    spec: {
      specVersion: APPLE_CUSTOM_WORKOUT_SPEC_VERSION,
      translatorVersion: APPLE_TRANSLATOR_VERSION,
      activity: 'running',
      location: 'outdoor',
      warmup: null,
      cooldown: null,
      blocks,
      source: { canonicalSchemaVersion: workout.schemaVersion, trainingSessionId: workout.trainingSessionId },
      specHash,
    },
    losses,
    canonicalWarningCodes,
    unverifiedOnDevice: UNVERIFIED_ON_DEVICE,
  };
}
