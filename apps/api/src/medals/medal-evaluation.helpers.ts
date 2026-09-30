// Sistema de Medalhas (30/09/2026) — funções PURAS reutilizadas por MedalEvaluationService.
// Separadas do serviço (que só faz I/O) pra serem testáveis sem mockar Prisma. Nenhuma aqui decide
// "o aluno merece a medalha" sozinha — só fazem contas de calendário/streak sobre dados já lidos.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Segunda-feira (00:00 UTC) da semana de `date` — mesma convenção usada no resto do projeto (startOfWeek). */
export function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=dom .. 6=sab
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/** Lista COMPLETA (sem lacunas) de segundas-feiras de `from` até `to`, inclusive, em ordem ascendente. */
export function buildCompleteWeekList(from: Date, to: Date): Date[] {
  const weeks: Date[] = [];
  let cursor = mondayOf(from);
  const last = mondayOf(to);
  while (cursor.getTime() <= last.getTime()) {
    weeks.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + ONE_WEEK_MS);
  }
  return weeks;
}

/** Uma semana está "encerrada" quando os 7 dias completos já passaram (hoje >= início + 7 dias). */
export function isWeekClosed(weekStart: Date, today: Date): boolean {
  return today.getTime() >= weekStart.getTime() + ONE_WEEK_MS;
}

/** Um mês-calendário está "encerrado" quando hoje já está em um mês estritamente posterior. */
export function isMonthClosed(monthKey: string, today: Date): boolean {
  const todayMonth = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
  return monthKey < todayMonth;
}

/**
 * Pra cada limiar em `thresholds` (streak de N semanas), encontra a PRIMEIRA semana (cronológica)
 * em que uma sequência CONSECUTIVA de semanas presentes atingiu aquele tamanho. `weeksAscending`
 * precisa ser uma lista COMPLETA e sem lacunas (ver buildCompleteWeekList) — uma semana ausente
 * dela seria silenciosamente tratada como presente, o que é exatamente o oposto do que streak
 * significa. Retorna Map<threshold, weekStartISO da semana em que o limiar foi atingido>.
 */
export function firstTimeStreakReached(
  weeksAscendingISO: string[],
  presentWeeks: ReadonlySet<string>,
  thresholds: number[],
): Map<number, string> {
  const result = new Map<number, string>();
  const sortedThresholds = [...new Set(thresholds)].sort((a, b) => a - b);
  let streak = 0;
  let nextIdx = 0;
  for (const week of weeksAscendingISO) {
    streak = presentWeeks.has(week) ? streak + 1 : 0;
    while (nextIdx < sortedThresholds.length && streak >= sortedThresholds[nextIdx]) {
      result.set(sortedThresholds[nextIdx], week);
      nextIdx++;
    }
  }
  return result;
}

/**
 * Pra cada limiar numérico (km, contagem...), encontra o PRIMEIRO item (cronológico) em que um
 * valor observado cruzou aquele limiar. `points` precisa estar ordenado por data ascendente.
 * Usado por volume semanal/mensal (primeiro período que atingiu X) e distância única (primeira
 * sessão que atingiu X).
 */
export function firstTimeValueReached<T extends { date: Date; value: number }>(
  points: T[],
  thresholds: number[],
): Map<number, T> {
  const result = new Map<number, T>();
  const remaining = new Set(thresholds);
  for (const point of points) {
    for (const threshold of remaining) {
      if (point.value >= threshold) {
        result.set(threshold, point);
      }
    }
    for (const threshold of result.keys()) remaining.delete(threshold);
  }
  return result;
}

/**
 * Soma cumulativa ao longo do tempo — pra cada limiar, a PRIMEIRA data em que o acumulado cruzou
 * aquele valor (família "quilometragem acumulada"). `points` precisa estar ordenado por data asc.
 */
export function firstTimeCumulativeReached<T extends { date: Date; value: number }>(
  points: T[],
  thresholds: number[],
): Map<number, { at: T; cumulative: number }> {
  const result = new Map<number, { at: T; cumulative: number }>();
  const sorted = [...new Set(thresholds)].sort((a, b) => a - b);
  let cumulative = 0;
  let nextIdx = 0;
  for (const point of points) {
    cumulative += point.value;
    while (nextIdx < sorted.length && cumulative >= sorted[nextIdx]) {
      result.set(sorted[nextIdx], { at: point, cumulative });
      nextIdx++;
    }
  }
  return result;
}

export interface GapEpisode {
  gapDays: number;
  /** Data da primeira sessão concluída DEPOIS da lacuna — início do episódio de retomada. */
  returnDate: Date;
}

/**
 * Detecta episódios de retomada: toda vez que o intervalo entre duas sessões concluídas
 * consecutivas (ordenadas por data) é >= `gapDays`, o segundo item marca o início de um episódio.
 * `datesAscending` precisa estar ordenado. Não deduplica contra ContextEvent — é uma leitura pura
 * do histórico de execuções, suficiente pra decidir medalha (o questionário de retorno em
 * context-events é uma coisa PARALELA, sobre coleta de contexto, não sobre gamificação).
 */
export function detectGapEpisodes(datesAscending: Date[], gapDays: number): GapEpisode[] {
  const episodes: GapEpisode[] = [];
  const gapMs = gapDays * ONE_DAY_MS;
  for (let i = 1; i < datesAscending.length; i++) {
    const diff = datesAscending[i].getTime() - datesAscending[i - 1].getTime();
    if (diff >= gapMs) {
      episodes.push({ gapDays: Math.floor(diff / ONE_DAY_MS), returnDate: datesAscending[i] });
    }
  }
  return episodes;
}

/**
 * Dado um episódio de retomada (semana de retorno) e o conjunto de semanas presentes, quantas
 * semanas CONSECUTIVAS a partir da semana de retorno (inclusive) tiveram presença — nunca mais que
 * 4 (a spec encerra o episódio depois da 4ª semana; ver SISTEMA_DE_MEDALHAS.md seção 13).
 */
export function consecutiveWeeksFromReturn(
  returnWeekISO: string,
  weeksAscendingISO: string[],
  presentWeeks: ReadonlySet<string>,
  maxWeeks = 4,
): number {
  const startIdx = weeksAscendingISO.indexOf(returnWeekISO);
  if (startIdx === -1) return 0;
  let streak = 0;
  for (let i = startIdx; i < weeksAscendingISO.length && streak < maxWeeks; i++) {
    if (presentWeeks.has(weeksAscendingISO[i])) streak++;
    else break;
  }
  return streak;
}
