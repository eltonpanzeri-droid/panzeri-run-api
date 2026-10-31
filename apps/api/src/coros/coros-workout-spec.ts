import { createHash } from 'node:crypto';
import { CanonicalStep, CanonicalWorkout } from '../training-plans/canonical-workout';

// Tradutor COROS (30/10/2026): CanonicalWorkout -> `course` da ferramenta createScheduledWorkout / updateScheduledWorkout do COROS MCP. SO' traduz a estrutura que a IA/o treinador
// ja' decidiu (Principio da prescricao): nao escolhe treino, ritmo, distancia nem carga. Sem rede e sem banco.
//
// O formato abaixo e' o schema REAL publicado pelo servidor (tools/list, lido em 30/10/2026 com uma conta de teste):
//  - course: { courseName (<=100), courseDescription (obrigatorio), sportType (1 = corrida), sections[] };
//  - secao simples: sectionType (1 aquecimento, 2 treino, 3 recuperacao, 4 desaquecimento), targetType (1 distancia em m, 2 tempo em s, 4 livre = sem targetValue),
//    targetValue inteiro positivo, e a intensidade: intensityType 2 = ritmo, com intensityValueStart/End em segundos por km, inteiros de 120 a 1499 (valor unico = os dois iguais);
//  - grupo de intervalos: { intervalGroup: true, repeats 1..20, sets[] } sem aninhamento; o grupo NAO leva alvo nem intensidade e os membros so' podem ser sectionType 2 ou 3.
// Intensidade ausente = o passo nao tem ritmo prescrito (ex.: recuperacao parada): os campos de intensidade simplesmente nao sao enviados (nunca 0).
// Aquecimento e desaquecimento NUNCA sao inferidos (o Panzeri Run nao os estrutura): papel 'main'/'work' => treino (2); 'recovery' => recuperacao (3).
export const COROS_WORKOUT_TRANSLATOR_VERSION = 1;
export const COROS_SPORT_RUNNING = 1;
export const COROS_PACE_MIN_SEC = 120;
export const COROS_PACE_MAX_SEC = 1499;
export const COROS_MAX_REPEATS = 20;
export const COROS_MAX_NAME_LENGTH = 100;

export interface CorosSection {
  sectionType?: 1 | 2 | 3 | 4;
  targetType?: 1 | 2 | 4;
  targetValue?: number;
  intensityType?: 2;
  intensityValueStart?: number;
  intensityValueEnd?: number;
  intervalGroup?: true;
  repeats?: number;
  sets?: CorosSection[];
}

export interface CorosCourse {
  courseName: string;
  courseDescription: string;
  sportType: 1;
  sections: CorosSection[];
}

export interface CorosTranslationRefusal { code: string; message: string; path: string }

export type CorosTranslationResult =
  | { ok: true; date: string; course: CorosCourse; specHash: string; canonicalWarningCodes: string[] }
  | { ok: false; refusals: CorosTranslationRefusal[] };

export interface CorosTranslationContext {
  // Distancia PRESCRITA da sessao (km); nula => o nome omite a distancia (nunca estimada).
  distanceKm?: number | null;
  scheduledDate: string; // YYYY-MM-DD
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const corosDate = (iso: string) => iso.replace(/-/g, '');

// Nome mostrado no relogio e no app da COROS: "Corrida 11 km · 25/10" (so' tipo, distancia prescrita e data). Sem nome de aluna, codigo ou texto da IA.
export function corosCourseName(distanceKm: number | null | undefined, scheduledDate: string): string {
  const [, month, day] = scheduledDate.split('-');
  const km = typeof distanceKm === 'number' && Number.isFinite(distanceKm) && distanceKm > 0 ? ` ${(Math.round(distanceKm * 10) / 10).toString().replace('.', ',')} km` : '';
  return `Corrida${km} · ${day}/${month}`.slice(0, COROS_MAX_NAME_LENGTH);
}

// Texto exibido a aluna EXATAMENTE como escrito: neutro, sem dado pessoal, sem comentario do treinador, sem nomes de campos.
export const COROS_COURSE_DESCRIPTION = 'Treino do seu programa no Panzeri Run. Siga as etapas, as distâncias ou os tempos e os ritmos indicados.';

export function translateToCorosCourse(workout: CanonicalWorkout, context: CorosTranslationContext): CorosTranslationResult {
  const refusals: CorosTranslationRefusal[] = [];
  const refuse = (code: string, message: string, path: string) => refusals.push({ code, message, path });

  if (workout.modality !== 'corrida') refuse('modality_not_running', `Modalidade "${workout.modality ?? 'desconhecida'}" nao e corrida; so' corrida e' enviada.`, 'modality');
  if (!workout.complete) {
    for (const loss of workout.losses) refuse(`canonical_${loss.code}`, loss.message, loss.path);
    if (workout.losses.length === 0) refuse('canonical_incomplete', 'O CanonicalWorkout nao esta completo.', 'items');
  }
  if (!DATE.test(context.scheduledDate)) refuse('workout_date_invalid', 'Data do treino invalida (esperado AAAA-MM-DD).', 'date');

  const translateStep = (step: CanonicalStep, path: string): CorosSection | null => {
    const before = refusals.length;
    // Caminhada so' existe como RECUPERACAO dentro de um treino de corrida; fora disso nao tem representacao fiel (seria enviada como corrida).
    if (step.activity === 'walk' && step.role !== 'recovery') refuse('walk_outside_recovery', 'Caminhada fora de uma etapa de recuperacao: so e enviada a recuperacao caminhando dentro de treino de corrida.', path);

    const section: CorosSection = { sectionType: step.role === 'recovery' ? 3 : 2 };
    if (step.goal.type === 'distance') {
      const meters = Math.round(step.goal.meters);
      if (!Number.isFinite(meters) || meters <= 0) refuse('distance_invalid', 'Distancia do passo invalida.', path);
      else { section.targetType = 1; section.targetValue = meters; }
    } else if (step.goal.type === 'time') {
      const seconds = Math.round(step.goal.seconds);
      if (!Number.isFinite(seconds) || seconds <= 0) refuse('duration_invalid', 'Duracao do passo invalida.', path);
      else { section.targetType = 2; section.targetValue = seconds; }
    } else {
      section.targetType = 4; // modo livre: a aluna encerra a etapa na volta (lap); a COROS nao aceita targetValue
    }

    // Meta de ritmo: SO' o pace PRESCRITO (a banda de +-20 s criada pelo gerador e' derivada e nunca e' usada). Recuperacao parada nao tem ritmo.
    const paceAllowed = !(step.role === 'recovery' && step.recoveryKind === 'passive');
    if (step.pace && paceAllowed) {
      const { fastSecPerKm, slowSecPerKm } = step.pace.prescribed;
      const a = Math.round(fastSecPerKm);
      const b = Math.round(slowSecPerKm);
      if (!(fastSecPerKm > 0) || !(slowSecPerKm > 0)) refuse('pace_invalid', 'Pace prescrito invalido.', path);
      else if (a < COROS_PACE_MIN_SEC || b < COROS_PACE_MIN_SEC || a > COROS_PACE_MAX_SEC || b > COROS_PACE_MAX_SEC) refuse('pace_out_of_range', `Pace fora do intervalo aceito pela COROS (${COROS_PACE_MIN_SEC} a ${COROS_PACE_MAX_SEC} s/km).`, path);
      else { section.intensityType = 2; section.intensityValueStart = Math.min(a, b); section.intensityValueEnd = Math.max(a, b); }
    }
    return refusals.length > before ? null : section;
  };

  const sections: CorosSection[] = [];
  workout.items.forEach((item, index) => {
    const path = `items[${index}]`;
    if (item.kind === 'step') {
      const translated = translateStep(item, path);
      if (translated) sections.push(translated);
      return;
    }
    if (!Number.isInteger(item.repeatCount) || item.repeatCount < 1 || item.repeatCount > COROS_MAX_REPEATS) {
      refuse('repeat_count_invalid', `Numero de repeticoes invalido (a COROS aceita de 1 a ${COROS_MAX_REPEATS}).`, path);
      return;
    }
    const sets: CorosSection[] = [];
    item.steps.forEach((step, stepIndex) => {
      const translated = translateStep(step, `${path}.steps[${stepIndex}]`);
      if (translated) sets.push(translated);
    });
    if (sets.length === item.steps.length && sets.length > 0) sections.push({ intervalGroup: true, repeats: item.repeatCount, sets });
    else if (item.steps.length === 0) refuse('repeat_without_steps', 'Grupo de repeticoes sem etapas.', path);
  });

  if (sections.length === 0 && refusals.length === 0) refuse('nothing_to_translate', 'Nenhum passo traduzivel.', 'items');
  if (refusals.length > 0) return { ok: false, refusals };

  const course: CorosCourse = { courseName: corosCourseName(context.distanceKm, context.scheduledDate), courseDescription: COROS_COURSE_DESCRIPTION, sportType: COROS_SPORT_RUNNING, sections };
  const date = corosDate(context.scheduledDate);
  // Identidade do CONTEUDO enviado: mudar etapa, valor, nome ou data muda o hash => o treino e' atualizado.
  const specHash = createHash('sha256').update(JSON.stringify({ v: COROS_WORKOUT_TRANSLATOR_VERSION, date, course })).digest('hex');
  return { ok: true, date, course, specHash, canonicalWarningCodes: workout.warnings.map((w) => w.code) };
}
