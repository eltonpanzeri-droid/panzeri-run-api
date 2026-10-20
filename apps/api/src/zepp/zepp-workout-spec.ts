import { createHash } from 'node:crypto';
import { CanonicalStep, CanonicalWorkout } from '../training-plans/canonical-workout';

// Tradutor Zepp (Lote 2, 20/10/2026): CanonicalWorkout -> treino da Workout API V2 (`POST /users/-/workouts?version=2.0.0`). Esta camada SO' traduz a estrutura que a
// IA/treinador ja' decidiu: nao escolhe treino, ritmo, distancia nem carga (Principio da prescricao). Nao fala com rede, banco nem WorkoutDelivery.
//
// REGRA CENTRAL: nada que a documentacao da Zepp nao especifique e' inventado. Tudo que depende de resposta da Zepp (unidade do pace, da distancia, forma de
// expressar "sem meta", lista de valores, limites) vive em `ZeppWorkoutProfile`. Enquanto um campo do perfil for `null` (nao confirmado), o passo que o exige e'
// RECUSADO com motivo explicito — o treino NAO e' enviado. Nunca e' enviada uma prescricao possivelmente errada. O perfil CONFIRMADO fica em
// `zepp-workout-profile.ts` e so' recebe valores depois da resposta escrita da Zepp.
//
// Fatos da documentacao (devopen.zepp.com, 20/10/2026): treino tem workoutId (inteiro), workoutDate (data), sport, workoutName e steps; passo `WorkoutStep`
// tem stepOrder, intensity, durationType (TIME|DISTANCE), durationValue (em SEGUNDOS quando TIME), targetType, targetValueLow/High (todos obrigatorios);
// `WorkoutRepeatStep` tem repeatType REPEAT_UNTIL_STEPS_CMPLT, repeatValue e `steps` com ordem propria.

export const ZEPP_WORKOUT_TRANSLATOR_VERSION = 1;

// Valores de `intensity` que a documentacao cita. A lista completa nao foi publicada: so' estes sao usados.
export const ZEPP_DOCUMENTED_INTENSITIES = ['WARMUP', 'COOLDOWN', 'INTERVAL', 'REST', 'RECOVERY', 'ACTIVE'] as const;
export type ZeppIntensity = (typeof ZEPP_DOCUMENTED_INTENSITIES)[number];

// Cada campo `null` = NAO CONFIRMADO pela Zepp => o passo que depende dele e' recusado.
export interface ZeppWorkoutProfile {
  // Unidade de durationValue quando durationType = DISTANCE.
  distanceUnit: 'm' | 'km' | null;
  // Unidade de targetValueLow/High para targetType = PACE_LAP.
  paceUnit: 'sec_per_km' | 'min_per_km' | 'm_per_s' | null;
  // Como expressar um passo SEM meta de ritmo (ex.: pausa passiva): tipo de meta aceito. null = nao existe confirmacao => passo sem pace e' recusado.
  noTargetType: string | null;
  // Pace prescrito como valor unico (fast === slow): a Zepp aceita low === high?
  singlePaceAsEqualBounds: boolean | null;
  maxNameLength: number | null;
  maxStepsPerWorkout: number | null;
}

export const ZEPP_PROFILE_UNCONFIRMED: ZeppWorkoutProfile = {
  distanceUnit: null,
  paceUnit: null,
  noTargetType: null,
  singlePaceAsEqualBounds: null,
  maxNameLength: null,
  maxStepsPerWorkout: null,
};

export interface ZeppV2Step {
  type: 'WorkoutStep';
  stepOrder: number;
  intensity: ZeppIntensity;
  durationType: 'TIME' | 'DISTANCE';
  durationValue: number;
  targetType: string;
  targetValueLow: number;
  targetValueHigh: number;
}

export interface ZeppV2RepeatStep {
  type: 'WorkoutRepeatStep';
  stepOrder: number;
  repeatType: 'REPEAT_UNTIL_STEPS_CMPLT';
  repeatValue: number;
  steps: ZeppV2Step[];
}

export interface ZeppV2Workout {
  workoutId: number;
  workoutDate: string;
  sport: 'RUNNING';
  workoutName: string;
  steps: Array<ZeppV2Step | ZeppV2RepeatStep>;
}

export interface ZeppTranslationRefusal {
  code: string;
  message: string;
  path: string;
  // Verdadeiro quando a recusa e' so' falta de confirmacao da Zepp (nao um defeito da prescricao): o treino passa a ser enviavel quando o perfil for confirmado.
  pendingZeppAnswer: boolean;
}

export type ZeppTranslationResult =
  | { ok: true; workout: ZeppV2Workout; specHash: string; canonicalWarningCodes: string[] }
  | { ok: false; refusals: ZeppTranslationRefusal[] };

export interface ZeppTranslationContext {
  workoutId: number;
  title: string;
  scheduledDate: string; // YYYY-MM-DD
}

// Conservador e NAO prescritivo: so' encurta o NOME exibido no relogio quando a Zepp nao confirmou o limite.
const DEFAULT_MAX_NAME_LENGTH = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function paceToTarget(seconds: number, unit: NonNullable<ZeppWorkoutProfile['paceUnit']>): number {
  const value = unit === 'sec_per_km' ? seconds : unit === 'min_per_km' ? seconds / 60 : 1000 / seconds;
  return Math.round(value * 1000) / 1000;
}

export function translateToZeppWorkout(workout: CanonicalWorkout, context: ZeppTranslationContext, profile: ZeppWorkoutProfile = ZEPP_PROFILE_UNCONFIRMED): ZeppTranslationResult {
  const refusals: ZeppTranslationRefusal[] = [];
  const refuse = (code: string, message: string, path: string, pendingZeppAnswer = false) => refusals.push({ code, message, path, pendingZeppAnswer });

  if (workout.modality !== 'corrida') refuse('modality_not_running', `Modalidade "${workout.modality ?? 'desconhecida'}" nao e corrida; so' corrida e' enviada.`, 'modality');
  if (!workout.complete) {
    for (const loss of workout.losses) refuse(`canonical_${loss.code}`, loss.message, loss.path);
    if (workout.losses.length === 0) refuse('canonical_incomplete', 'O CanonicalWorkout nao esta completo.', 'items');
  }
  if (!Number.isInteger(context.workoutId) || context.workoutId <= 0) refuse('workout_id_invalid', 'workoutId precisa ser um inteiro positivo.', 'workoutId');
  if (!DATE.test(context.scheduledDate)) refuse('workout_date_invalid', 'Data do treino invalida (esperado AAAA-MM-DD).', 'workoutDate');

  const translateStep = (step: CanonicalStep, path: string, intensity: ZeppIntensity, stepOrder: number): ZeppV2Step | null => {
    const before = refusals.length;

    // Caminhada: a Zepp nao informou como representa-la dentro de um treino de corrida — nao e' enviada como corrida (seria prescricao errada).
    if (step.activity === 'walk') refuse('walk_not_representable', 'Passo de caminhada explicito: a Zepp ainda nao informou como representa-lo; o treino nao e enviado.', path, true);

    let durationType: 'TIME' | 'DISTANCE' = 'TIME';
    let durationValue = 0;
    if (step.goal.type === 'time') {
      durationValue = step.goal.seconds; // documentado: segundos
      if (!Number.isFinite(durationValue) || durationValue <= 0) refuse('duration_invalid', 'Duracao do passo invalida.', path);
    } else if (step.goal.type === 'distance') {
      durationType = 'DISTANCE';
      if (!profile.distanceUnit) refuse('distance_unit_unconfirmed', 'Unidade de durationValue por distancia ainda nao confirmada pela Zepp.', path, true);
      else if (!Number.isFinite(step.goal.meters) || step.goal.meters <= 0) refuse('distance_invalid', 'Distancia do passo invalida.', path);
      else durationValue = Math.round((profile.distanceUnit === 'm' ? step.goal.meters : step.goal.meters / 1000) * 1000) / 1000;
    } else {
      refuse('goal_open_not_supported', 'Passo sem meta de duracao/distancia; a Zepp exige durationType e durationValue.', path);
    }

    // Meta de ritmo: SO' o pace PRESCRITO. A banda de +-20 s criada pelo gerador e' derivada e nunca e' usada.
    let targetType = '';
    let targetValueLow = 0;
    let targetValueHigh = 0;
    const paceAllowed = !(step.role === 'recovery' && step.recoveryKind === 'passive');
    if (step.pace && paceAllowed) {
      if (!profile.paceUnit) {
        refuse('pace_unit_unconfirmed', 'Unidade de PACE_LAP ainda nao confirmada pela Zepp.', path, true);
      } else {
        const { fastSecPerKm, slowSecPerKm } = step.pace.prescribed;
        if (!(fastSecPerKm > 0) || !(slowSecPerKm > 0)) refuse('pace_invalid', 'Pace prescrito invalido.', path);
        else if (fastSecPerKm === slowSecPerKm && profile.singlePaceAsEqualBounds !== true) refuse('single_pace_bounds_unconfirmed', 'Pace unico (sem faixa): a Zepp ainda nao confirmou se aceita limite baixo igual ao alto.', path, true);
        else {
          const a = paceToTarget(fastSecPerKm, profile.paceUnit);
          const b = paceToTarget(slowSecPerKm, profile.paceUnit);
          targetType = 'PACE_LAP';
          targetValueLow = Math.min(a, b);
          targetValueHigh = Math.max(a, b);
        }
      }
    } else if (!profile.noTargetType) {
      refuse('no_target_unconfirmed', 'Passo sem pace prescrito: a Zepp ainda nao confirmou como expressar um passo sem meta.', path, true);
    } else {
      targetType = profile.noTargetType;
    }

    if (refusals.length > before) return null;
    return { type: 'WorkoutStep', stepOrder, intensity, durationType, durationValue, targetType, targetValueLow, targetValueHigh };
  };

  // Papel canonico -> intensity documentada. Aquecimento/desaquecimento NUNCA sao inferidos (o Panzeri Run nao os estrutura).
  const intensityOf = (step: CanonicalStep, insideRepeat: boolean): ZeppIntensity => {
    if (step.role === 'recovery') return step.recoveryKind === 'passive' ? 'REST' : 'RECOVERY';
    return insideRepeat ? 'INTERVAL' : 'ACTIVE';
  };

  const steps: Array<ZeppV2Step | ZeppV2RepeatStep> = [];
  workout.items.forEach((item, index) => {
    const path = `items[${index}]`;
    const stepOrder = steps.length + 1;
    if (item.kind === 'step') {
      const translated = translateStep(item, path, intensityOf(item, false), stepOrder);
      if (translated) steps.push(translated);
      return;
    }
    if (!Number.isInteger(item.repeatCount) || item.repeatCount < 1) {
      refuse('repeat_count_invalid', 'repeatCount invalido.', path);
      return;
    }
    const inner: ZeppV2Step[] = [];
    item.steps.forEach((step, stepIndex) => {
      const translated = translateStep(step, `${path}.steps[${stepIndex}]`, intensityOf(step, true), inner.length + 1);
      if (translated) inner.push(translated);
    });
    if (inner.length === item.steps.length && inner.length > 0) steps.push({ type: 'WorkoutRepeatStep', stepOrder, repeatType: 'REPEAT_UNTIL_STEPS_CMPLT', repeatValue: item.repeatCount, steps: inner });
  });

  if (profile.maxStepsPerWorkout != null) {
    const total = steps.reduce((sum, step) => sum + 1 + (step.type === 'WorkoutRepeatStep' ? step.steps.length : 0), 0);
    if (total > profile.maxStepsPerWorkout) refuse('too_many_steps', `Treino com ${total} passos; o limite confirmado pela Zepp e ${profile.maxStepsPerWorkout}.`, 'steps');
  }
  if (steps.length === 0 && refusals.length === 0) refuse('nothing_to_translate', 'Nenhum passo traduzivel.', 'items');
  if (refusals.length > 0) return { ok: false, refusals };

  const title = context.title.replace(/\s+/g, ' ').trim();
  const maxName = profile.maxNameLength ?? DEFAULT_MAX_NAME_LENGTH;
  const workoutName = (title || 'Treino').slice(0, maxName);

  const translated: ZeppV2Workout = { workoutId: context.workoutId, workoutDate: context.scheduledDate, sport: 'RUNNING', workoutName, steps };
  // Identidade do CONTEUDO enviado (sem workoutId): mudar passo, valor, nome ou data muda o hash => a publicacao e' refeita.
  const specHash = createHash('sha256').update(JSON.stringify({ v: ZEPP_WORKOUT_TRANSLATOR_VERSION, date: translated.workoutDate, name: workoutName, steps })).digest('hex');
  return { ok: true, workout: translated, specHash, canonicalWarningCodes: workout.warnings.map((w) => w.code) };
}
