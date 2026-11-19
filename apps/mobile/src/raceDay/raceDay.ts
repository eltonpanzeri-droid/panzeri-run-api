// Prova marcada pela aluna no programa de treino (19/11/2026, ordem de Elton). O servidor ja' cria a sessao da prova (structure.race, origem target_race): ela substitui a corrida do dia, ou entra como
// corrida num dia livre ou de outra modalidade. Aqui so' se decide o que MOSTRAR: (1) o carimbo no cartao da prova; (2) o alerta nos outros treinos do mesmo dia, sugerindo nao fazer e descansar.
// Funcoes puras: nao alteram o treino nem o que vai ao relogio.
export const RACE_STAMP_TEXT = '🏁 PROVA MARCADA POR VOCÊ';

export function raceOfSession(session: { structure?: unknown } | null | undefined): { name: string } | null {
  const structure = session?.structure;
  if (!structure || typeof structure !== 'object') return null;
  const race = (structure as { race?: unknown }).race;
  if (!race || typeof race !== 'object') return null;
  const name = (race as { name?: unknown }).name;
  return { name: typeof name === 'string' && name.trim() ? name.trim() : 'sua prova' };
}

export const raceDayRestNotice = (raceName: string): string => `Hoje é o dia da sua prova (${raceName}). Sugerimos não fazer este treino, para você descansar.`;

// Alerta para um treino QUE NAO E a prova, no mesmo dia de uma prova. Treino extra/alternativa (registro do que a aluna ja' fez) nao recebe o alerta.
export function raceDayNoticeFor(
  session: { structure?: unknown; isAlternative?: boolean | null },
  sameDaySessions: Array<{ structure?: unknown }>,
): string | null {
  if (raceOfSession(session)) return null;
  if (session.isAlternative) return null;
  const type = session.structure && typeof session.structure === 'object' ? (session.structure as { type?: unknown }).type : null;
  if (type === 'extra') return null;
  const race = sameDaySessions.map((item) => raceOfSession(item)).find(Boolean);
  return race ? raceDayRestNotice(race.name) : null;
}
