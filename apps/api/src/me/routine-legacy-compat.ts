import type { AvailabilityDayDto } from './dto/update-availability.dto';

// COMPATIBILIDADE TEMPORARIA com aplicativos nativos antigos (iOS build 13 e Android anteriores a separacao entre entrevista e rotina) — 26/10/2026.
// Esses apps cadastram a PRIMEIRA rotina respondendo perguntas de rotina em PUT /me/onboarding/answer e concluindo em POST /me/onboarding/complete-routine.
// Regras que impedem a entrevista de voltar a ser fonte da rotina:
//   1. So' vale para quem AINDA NAO tem rotina cadastrada. Quem ja tem rotina nunca e' alterado por esse caminho (edicao usa PUT /me/availability).
//   2. As respostas ficam apenas como rascunho de uma sessao recente do app (carimbo + validade). Respostas de rotina antigas da entrevista nunca sao convertidas:
//      ao iniciar uma sessao nova, o rascunho anterior e' descartado.
//   3. A gravacao passa EXCLUSIVAMENTE por RoutineService (mesma trava, validacao, historico, revisao). Depois de gravar, o rascunho e' apagado.
//   4. Desligavel por LEGACY_ROUTINE_COMPAT=off (sem recompilar) quando os apps antigos deixarem de existir; entao voltam as respostas 400/410.

export const LEGACY_STAGE_KEY = '__legacy_routine_staged_at';
export const LEGACY_STAGE_TTL_MS = 48 * 60 * 60 * 1000;

export function isLegacyRoutineCompatEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.LEGACY_ROUTINE_COMPAT ?? 'on').trim().toLowerCase() !== 'off';
}

export function legacyStageIsFresh(answers: Record<string, unknown>, now: Date = new Date()): boolean {
  const stamp = answers[LEGACY_STAGE_KEY];
  if (typeof stamp !== 'string') return false;
  const at = Date.parse(stamp);
  return Number.isFinite(at) && now.getTime() - at >= 0 && now.getTime() - at <= LEGACY_STAGE_TTL_MS;
}

const LEGACY_WEEK_DAYS: Array<{ key: string; weekday: number }> = [
  { key: 'sunday', weekday: 0 }, { key: 'monday', weekday: 1 }, { key: 'tuesday', weekday: 2 }, { key: 'wednesday', weekday: 3 },
  { key: 'thursday', weekday: 4 }, { key: 'friday', weekday: 5 }, { key: 'saturday', weekday: 6 },
];

const LEGACY_MINUTES: Record<string, number> = {
  none: 0, up_to_30: 30, from_30_to_45: 45, from_45_to_60: 60, from_60_to_90: 90, over_90: 105, from_90_to_150: 120, from_150_to_240: 195, over_240: 270,
};

function legacyMinutes(value: unknown): number {
  return LEGACY_MINUTES[String(value)] ?? 0;
}

// Converte o rascunho de UMA sessao do app antigo nos sete dias enviados ao RoutineService. A validacao de verdade (minutos, modalidades, semana completa) e' do servico.
export function legacyDraftToDays(answers: Record<string, unknown>): AvailabilityDayDto[] {
  const choice = answers.routine_modality_choice;
  const includesFortalecimento = typeof choice !== 'string' || choice === 'corrida_fortalecimento' || choice === 'corrida_fortalecimento_musculacao';
  const includesMusculacao = typeof choice !== 'string' || choice === 'corrida_musculacao' || choice === 'corrida_fortalecimento_musculacao';
  return LEGACY_WEEK_DAYS.map(({ key, weekday }) => {
    const run = legacyMinutes(answers[`${key}_run_time`]);
    const fortalecimento = includesFortalecimento ? legacyMinutes(answers[`${key}_fortalecimento_time`]) : 0;
    const musculacao = includesMusculacao ? legacyMinutes(answers[`${key}_musculacao_time`]) : 0;
    const modalities: string[] = [];
    const modalityDurations: Record<string, number> = {};
    if (run > 0) { modalities.push('corrida'); modalityDurations.corrida = run; }
    if (fortalecimento > 0) { modalities.push('fortalecimento_corredores'); modalityDurations.fortalecimento_corredores = fortalecimento; }
    if (musculacao > 0) { modalities.push('forca'); modalityDurations.forca = musculacao; }
    return {
      weekday,
      noTraining: modalities.length === 0,
      modalities,
      availableMin: Math.max(run, fortalecimento, musculacao, 0),
      modalityDurations,
    };
  });
}
