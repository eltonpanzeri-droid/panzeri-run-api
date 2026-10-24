// Regra UNICA de semana do volume (24/10/2026, decisao de Elton): o km de um evento executado pertence a' semana (segunda a domingo) do DIA LOCAL DA EXECUCAO
// (atividade importada: dia local da observacao canonica). Treino manual sem atividade usa a data programada da sessao. Usado pela Evolucao (grafico, medalhas, IA)
// e pelo total km da semana no Historico, para os dois nunca discordarem sobre em que semana cai um treino.

/** Segunda-feira da semana de um dia 'YYYY-MM-DD' (meio-dia UTC evita deriva de horario de verao). */
export function weekStartOf(isoDay: string): string {
  const d = new Date(isoDay + 'T12:00:00Z');
  const day = d.getUTCDay(); // 0=dom, 1=seg ... 6=sab
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

/** Mesma regra para uma Date (usa o dia UTC da data, como as datas programadas guardadas a meia-noite UTC). */
export function weekStartOfDate(date: Date): string {
  return weekStartOf(date.toISOString().slice(0, 10));
}

/**
 * Semana a que o km pertence: a do dia local da execucao quando ha' atividade importada; senao a da data programada.
 * `executionLocalDay` e' o dia local da observacao canonica (ver localCalendarDate).
 */
export function executionWeekStart(executionLocalDay: string | null | undefined, scheduledDay: string): string {
  return weekStartOf(executionLocalDay || scheduledDay);
}
