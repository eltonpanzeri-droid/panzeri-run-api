import { createHash } from 'node:crypto';
import { CanonicalStep, CanonicalWorkout } from '../training-plans/canonical-workout';
import { isRunModality } from '../activity-execution/canonical-modality';

// Tradutor Garmin (08/11/2026): CanonicalWorkout -> workout da Training API V2 ("Training_API V2 2.0.pdf"). SO' traduz a estrutura que a IA/o treinador ja' decidiu (Principio da prescricao): nao escolhe
// treino, ritmo, distancia nem carga. Sem rede e sem banco. Formato (secoes 3.1 e 3.2 do PDF):
//  - workout: { workoutName, description (<=1024), sport: 'RUNNING', workoutProvider (<=20), workoutSourceId, segments: [{ segmentOrder: 1, sport: 'RUNNING', steps }] }; os campos "estimated*" sao
//    calculados pela Garmin e ignorados no envio;
//  - passo simples: { type: 'WorkoutStep', stepOrder, intensity, durationType: DISTANCE | TIME | OPEN, durationValue (metros ou segundos), targetType: PACE | OPEN, targetValueLow/High };
//    PACE vai como VELOCIDADE em m/s (a Garmin pede "PACE (as speed in m/s)"): baixo = pace lento, alto = pace rapido;
//  - repeticao: { type: 'WorkoutRepeatStep', stepOrder, repeatType: 'REPEAT_UNTIL_STEPS_CMPLT', repeatValue, steps }; stepOrder e' sequencial no treino INTEIRO, inclusive os passos de dentro das repeticoes;
//  - limite de 100 passos em treino de um esporte.
// Aquecimento e desaquecimento NUNCA sao inferidos (o Panzeri Run nao os estrutura): dentro de repeticao, 'work' => INTERVAL e 'recovery' => RECOVERY; passo avulso 'main' => ACTIVE e 'recovery' => RECOVERY.
// NAO VALIDADO com a Garmin real: `durationValueType: 'METER'` segue o exemplo do PDF (so' o exemplo de distancia o traz); em tempo e' nulo (o campo e' "so' para FC e potencia").
export const GARMIN_WORKOUT_TRANSLATOR_VERSION = 1;
export const GARMIN_MAX_STEPS = 100;
export const GARMIN_MAX_REPEATS = 99;
export const GARMIN_PROVIDER_LABEL = 'Panzeri Run'; // <= 20 caracteres
export const GARMIN_SOURCE_ID = 'panzeri-run';
export const GARMIN_WORKOUT_DESCRIPTION = 'Treino do seu programa no Panzeri Run. Siga as etapas, as distâncias ou os tempos e os ritmos indicados.';
const MIN_PACE_SEC = 120;
const MAX_PACE_SEC = 1800;

export interface GarminWorkoutStep {
  type: 'WorkoutStep';
  stepOrder: number;
  intensity: 'ACTIVE' | 'INTERVAL' | 'RECOVERY';
  description: null;
  durationType: 'DISTANCE' | 'TIME' | 'OPEN';
  durationValue: number | null;
  durationValueType: 'METER' | null;
  targetType: 'PACE' | 'OPEN';
  targetValue: null;
  targetValueLow: number | null;
  targetValueHigh: number | null;
  targetValueType: null;
}
export interface GarminRepeatStep { type: 'WorkoutRepeatStep'; stepOrder: number; repeatType: 'REPEAT_UNTIL_STEPS_CMPLT'; repeatValue: number; steps: GarminWorkoutStep[] }
export interface GarminWorkout {
  workoutName: string;
  description: string;
  sport: 'RUNNING';
  workoutProvider: string;
  workoutSourceId: string;
  segments: Array<{ segmentOrder: 1; sport: 'RUNNING'; steps: Array<GarminWorkoutStep | GarminRepeatStep> }>;
}

export interface GarminTranslationRefusal { code: string; message: string; path: string }
export type GarminTranslationResult =
  | { ok: true; scheduledDate: string; workout: GarminWorkout; specHash: string; canonicalWarningCodes: string[] }
  | { ok: false; refusals: GarminTranslationRefusal[] };

export interface GarminTranslationContext {
  distanceKm?: number | null; // distancia PRESCRITA da sessao; nula => o nome omite a distancia (nunca estimada)
  scheduledDate: string; // YYYY-MM-DD
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Nome mostrado no relogio: "Corrida 11 km · 25/10" (so' tipo, distancia prescrita e data). Sem nome de aluna, codigo ou texto da IA.
export function garminWorkoutName(distanceKm: number | null | undefined, scheduledDate: string): string {
  const [, month, day] = scheduledDate.split('-');
  const km = typeof distanceKm === 'number' && Number.isFinite(distanceKm) && distanceKm > 0 ? ` ${(Math.round(distanceKm * 10) / 10).toString().replace('.', ',')} km` : '';
  return `Corrida${km} · ${day}/${month}`.slice(0, 100);
}

export function translateToGarminWorkout(workout: CanonicalWorkout, context: GarminTranslationContext): GarminTranslationResult {
  const refusals: GarminTranslationRefusal[] = [];
  const refuse = (code: string, message: string, path: string) => refusals.push({ code, message, path });
  if (!isRunModality(workout.modality)) refuse('modality_not_running', `Modalidade "${workout.modality ?? 'desconhecida'}" nao e corrida; so' corrida e' enviada.`, 'modality');
  if (!workout.complete) {
    for (const loss of workout.losses) refuse(`canonical_${loss.code}`, loss.message, loss.path);
    if (workout.losses.length === 0) refuse('canonical_incomplete', 'O CanonicalWorkout nao esta completo.', 'items');
  }
  if (!DATE.test(context.scheduledDate)) refuse('workout_date_invalid', 'Data do treino invalida (esperado AAAA-MM-DD).', 'date');

  let order = 0;
  let stepCount = 0;
  const translateStep = (step: CanonicalStep, path: string, insideRepeat: boolean): GarminWorkoutStep | null => {
    const before = refusals.length;
    // Caminhada so' existe como RECUPERACAO dentro de um treino de corrida; fora disso nao tem representacao fiel (seria enviada como corrida).
    if (step.activity === 'walk' && step.role !== 'recovery') refuse('walk_outside_recovery', 'Caminhada fora de uma etapa de recuperacao: so e enviada a recuperacao caminhando dentro de treino de corrida.', path);
    order += 1;
    stepCount += 1;
    const intensity: GarminWorkoutStep['intensity'] = step.role === 'recovery' ? 'RECOVERY' : insideRepeat ? 'INTERVAL' : 'ACTIVE';
    const out: GarminWorkoutStep = { type: 'WorkoutStep', stepOrder: order, intensity, description: null, durationType: 'OPEN', durationValue: null, durationValueType: null, targetType: 'OPEN', targetValue: null, targetValueLow: null, targetValueHigh: null, targetValueType: null };
    if (step.goal.type === 'distance') {
      const meters = Math.round(step.goal.meters);
      if (!Number.isFinite(meters) || meters <= 0) refuse('distance_invalid', 'Distancia do passo invalida.', path);
      else { out.durationType = 'DISTANCE'; out.durationValue = meters; out.durationValueType = 'METER'; }
    } else if (step.goal.type === 'time') {
      const seconds = Math.round(step.goal.seconds);
      if (!Number.isFinite(seconds) || seconds <= 0) refuse('duration_invalid', 'Duracao do passo invalida.', path);
      else { out.durationType = 'TIME'; out.durationValue = seconds; }
    } // senao: OPEN (a aluna encerra a etapa na volta/lap)

    // Meta de ritmo: SO' o pace PRESCRITO (a banda derivada de +-20 s nunca e' usada). Recuperacao parada nao tem ritmo.
    const paceAllowed = !(step.role === 'recovery' && step.recoveryKind === 'passive');
    if (step.pace && paceAllowed) {
      const { fastSecPerKm, slowSecPerKm } = step.pace.prescribed;
      if (!(fastSecPerKm > 0) || !(slowSecPerKm > 0)) refuse('pace_invalid', 'Pace prescrito invalido.', path);
      else if (fastSecPerKm < MIN_PACE_SEC || slowSecPerKm < MIN_PACE_SEC || fastSecPerKm > MAX_PACE_SEC || slowSecPerKm > MAX_PACE_SEC) refuse('pace_out_of_range', `Pace fora do intervalo aceito (${MIN_PACE_SEC} a ${MAX_PACE_SEC} s/km).`, path);
      else {
        // pace (s/km) -> velocidade (m/s): menor pace = maior velocidade.
        const a = 1000 / Math.min(fastSecPerKm, slowSecPerKm);
        const b = 1000 / Math.max(fastSecPerKm, slowSecPerKm);
        out.targetType = 'PACE';
        out.targetValueHigh = Math.round(a * 1000) / 1000;
        out.targetValueLow = Math.round(b * 1000) / 1000;
      }
    }
    return refusals.length > before ? null : out;
  };

  const steps: Array<GarminWorkoutStep | GarminRepeatStep> = [];
  workout.items.forEach((item, index) => {
    const path = `items[${index}]`;
    if (item.kind === 'step') {
      const translated = translateStep(item, path, false);
      if (translated) steps.push(translated);
      return;
    }
    if (!Number.isInteger(item.repeatCount) || item.repeatCount < 1 || item.repeatCount > GARMIN_MAX_REPEATS) {
      refuse('repeat_count_invalid', `Numero de repeticoes invalido (de 1 a ${GARMIN_MAX_REPEATS}).`, path);
      return;
    }
    if (item.steps.length === 0) { refuse('repeat_without_steps', 'Grupo de repeticoes sem etapas.', path); return; }
    order += 1; // o proprio grupo tem stepOrder
    const groupOrder = order;
    const inner: GarminWorkoutStep[] = [];
    item.steps.forEach((step, stepIndex) => {
      const translated = translateStep(step, `${path}.steps[${stepIndex}]`, true);
      if (translated) inner.push(translated);
    });
    if (inner.length === item.steps.length) steps.push({ type: 'WorkoutRepeatStep', stepOrder: groupOrder, repeatType: 'REPEAT_UNTIL_STEPS_CMPLT', repeatValue: item.repeatCount, steps: inner });
  });

  if (stepCount > GARMIN_MAX_STEPS) refuse('too_many_steps', `Mais de ${GARMIN_MAX_STEPS} passos (limite da Garmin para um esporte).`, 'items');
  if (steps.length === 0 && refusals.length === 0) refuse('nothing_to_translate', 'Nenhum passo traduzivel.', 'items');
  if (refusals.length > 0) return { ok: false, refusals };

  const garmin: GarminWorkout = {
    workoutName: garminWorkoutName(context.distanceKm, context.scheduledDate),
    description: GARMIN_WORKOUT_DESCRIPTION,
    sport: 'RUNNING',
    workoutProvider: GARMIN_PROVIDER_LABEL,
    workoutSourceId: GARMIN_SOURCE_ID,
    segments: [{ segmentOrder: 1, sport: 'RUNNING', steps }],
  };
  // Identidade do CONTEUDO enviado (a data fica fora: mudar so' de dia atualiza o agendamento, nao o treino).
  const specHash = createHash('sha256').update(JSON.stringify({ v: GARMIN_WORKOUT_TRANSLATOR_VERSION, workout: garmin })).digest('hex');
  return { ok: true, scheduledDate: context.scheduledDate, workout: garmin, specHash, canonicalWarningCodes: workout.warnings.map((w) => w.code) };
}
