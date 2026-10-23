// CARGA DE TREINO PRÓPRIA (Panzeri Run, 23/10/2026) — métrica DESCRITIVA, em avaliação. Funções PURAS.
//
// Como é calculada (a mesma explicação aparece na tela do painel):
//  1. CARGA DA SESSÃO = esforço percebido (1 a 10, que a aluna informa depois do treino) × duração em minutos (método "sRPE", de Foster). Unidade: UA (unidade arbitrária).
//  2. SEMANA (segunda a domingo) = soma da carga das sessões da semana.
//  3. AGUDA = soma dos últimos 7 dias. CRÔNICA = média semanal dos últimos 28 dias (soma de 28 dias ÷ 4). RAZÃO = aguda ÷ crônica (1,0 = mesma carga do hábito recente).
//  4. O que NÃO entra: treino marcado como não feito; treino sem esforço percebido ou sem duração (nunca vira zero nem é estimado — aparece numa lista própria, com o motivo).
//
// Isto DESCREVE o que a aluna fez. NÃO decide treino, NÃO é recomendação e (até decisão de Elton) o Atlas NÃO usa. Independe da fonte do dado (não usa relógio).

export const LOAD_METHOD_VERSION = 'carga-propria v1 (23/10/2026)';
export const ACUTE_DAYS = 7;
export const CHRONIC_DAYS = 28;

export interface LoadInputRow {
  id: string;
  date: string; // AAAA-MM-DD (dia da sessão)
  modality: string | null;
  title: string | null;
  status: string; // done | adjusted | missed
  durationMin: number | null;
  perceivedEffort: number | null;
  isExtra: boolean;
}

export interface LoadSession { id: string; date: string; modality: string | null; title: string | null; isExtra: boolean; adjusted: boolean; rpe: number; minutes: number; load: number }
export type ExclusionReason = 'sem_esforco' | 'sem_duracao' | 'sem_esforco_e_duracao';
export interface ExcludedSession { id: string; date: string; modality: string | null; title: string | null; isExtra: boolean; reason: ExclusionReason; rpe: number | null; minutes: number | null }

export interface LoadWindow {
  asOf: string;
  acuteLoad: number;
  chronicLoad: number; // soma dos 28 dias
  chronicWeeklyAverage: number; // soma ÷ 4
  ratio: number | null;
  /** Dias da janela crônica que ja' existem no historico de cargas (28 = completa). */
  chronicDaysCovered: number;
  /** Sessoes que ficaram DE FORA (sem esforco/duracao) dentro dos 28 dias: a razao esta calculada so' com o que foi informado. */
  excludedInWindow: number;
  note: string | null;
}

export interface LoadWeek {
  weekStart: string;
  weekEnd: string;
  inProgress: boolean;
  /** true quando o periodo escolhido corta a semana: a barra soma so' os dias dentro do periodo (a razao continua olhando os 28 dias anteriores). */
  clipped: boolean;
  load: number;
  sessions: number;
  excluded: number;
  window: LoadWindow;
}

export interface TrainingLoadResult {
  method: { version: string; formula: string; steps: string[]; leftOut: string[] };
  period: { from: string; to: string };
  sessions: LoadSession[];
  excluded: ExcludedSession[];
  weeks: LoadWeek[];
  current: LoadWindow;
  totals: { sessions: number; excluded: number; load: number };
  example: { date: string; rpe: number; minutes: number; load: number } | null;
}

const noon = (date: string) => new Date(`${date}T12:00:00.000Z`);
export const addDays = (date: string, days: number) => new Date(noon(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((noon(b).getTime() - noon(a).getTime()) / 86_400_000);
export function weekStartOf(date: string): string {
  const weekday = noon(date).getUTCDay(); // 0 = domingo
  return addDays(date, -((weekday + 6) % 7)); // segunda-feira
}
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Separa o que entra no calculo do que fica de fora (com o motivo). Treino nao feito nao entra em nenhuma das duas listas. */
export function classifySessions(rows: LoadInputRow[]): { sessions: LoadSession[]; excluded: ExcludedSession[] } {
  const sessions: LoadSession[] = [];
  const excluded: ExcludedSession[] = [];
  for (const row of rows) {
    if (row.status !== 'done' && row.status !== 'adjusted') continue;
    const rpe = row.perceivedEffort != null && Number.isFinite(row.perceivedEffort) && row.perceivedEffort >= 1 && row.perceivedEffort <= 10 ? row.perceivedEffort : null;
    // Minutos com no maximo 2 casas: o numero usado na conta e' EXATAMENTE o exibido na tela, para a conta ser reproduzivel a mao.
    const minutes = row.durationMin != null && Number.isFinite(row.durationMin) && row.durationMin > 0 ? Math.round(row.durationMin * 100) / 100 : null;
    const base = { id: row.id, date: row.date, modality: row.modality, title: row.title, isExtra: row.isExtra };
    if (rpe == null || minutes == null || minutes <= 0) {
      excluded.push({ ...base, reason: rpe == null && minutes == null ? 'sem_esforco_e_duracao' : rpe == null ? 'sem_esforco' : 'sem_duracao', rpe, minutes });
    } else {
      sessions.push({ ...base, adjusted: row.status === 'adjusted', rpe, minutes, load: round1(rpe * minutes) });
    }
  }
  const byDate = (a: { date: string; id: string }, b: { date: string; id: string }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1);
  return { sessions: sessions.sort(byDate), excluded: excluded.sort(byDate) };
}

/** Aguda (7 dias), cronica (28 dias) e razao ate' o dia `asOf` (inclusive). A razao so' existe com a janela cronica COMPLETA no historico. */
export function windowAt(asOf: string, sessions: LoadSession[], excluded: ExcludedSession[]): LoadWindow {
  const inRange = (date: string, days: number) => date <= asOf && date >= addDays(asOf, -(days - 1));
  const acuteRaw = sessions.filter((s) => inRange(s.date, ACUTE_DAYS)).reduce((sum, s) => sum + s.load, 0);
  const chronicRaw = sessions.filter((s) => inRange(s.date, CHRONIC_DAYS)).reduce((sum, s) => sum + s.load, 0);
  const chronicAverageRaw = chronicRaw / (CHRONIC_DAYS / ACUTE_DAYS); // a razao usa os valores SEM arredondar; so' a exibicao arredonda
  const acuteLoad = round1(acuteRaw);
  const chronicLoad = round1(chronicRaw);
  const chronicWeeklyAverage = round1(chronicAverageRaw);
  const first = [...sessions, ...excluded].map((s) => s.date).sort()[0];
  const chronicDaysCovered = first == null || first > asOf ? 0 : Math.min(CHRONIC_DAYS, diffDays(first, asOf) + 1);
  const excludedInWindow = excluded.filter((s) => inRange(s.date, CHRONIC_DAYS)).length;
  let ratio: number | null = null;
  let note: string | null = null;
  if (chronicDaysCovered < CHRONIC_DAYS) note = `Histórico curto: só ${chronicDaysCovered} de ${CHRONIC_DAYS} dias — a razão ainda não existe.`;
  else if (chronicAverageRaw <= 0) note = 'Sem carga registrada nos últimos 28 dias — a razão não existe.';
  else {
    ratio = Math.round((acuteRaw / chronicAverageRaw) * 100) / 100;
    if (excludedInWindow > 0) note = `${excludedInWindow} treino(s) dos últimos 28 dias ficaram de fora por falta de esforço percebido ou duração: a razão usa só o que foi informado.`;
  }
  return { asOf, acuteLoad, chronicLoad, chronicWeeklyAverage, ratio, chronicDaysCovered, excludedInWindow, note };
}

export const METHOD_TEXT = {
  formula: 'Carga da sessão (UA) = esforço percebido (1 a 10) × minutos. Razão = carga dos últimos 7 dias ÷ média semanal dos últimos 28 dias.',
  steps: [
    'Cada treino feito (ou feito com ajustes) vale: esforço percebido que a aluna informou (1 a 10) × duração em minutos = carga da sessão, em UA (unidade arbitrária).',
    'A carga da semana (segunda a domingo) é a soma das sessões da semana.',
    'Aguda = soma dos últimos 7 dias. Crônica = média semanal dos últimos 28 dias (soma dos 28 dias ÷ 4). Razão = aguda ÷ crônica. Razão 1,0 = mesma carga do hábito recente; acima = semana mais carregada que o hábito; abaixo = mais leve. Atenção: os 28 dias INCLUEM os 7 dias da aguda, o que aproxima a razão de 1,0.',
    'A data de cada treino é o DIA AGENDADO da sessão (um treino de domingo que a aluna registrou na segunda conta no domingo). Sem sessão agendada, vale o dia em que ela registrou, no horário de São Paulo.',
    'A razão só aparece quando já existem 28 dias de histórico. Antes disso a tela diz que o histórico é curto.',
  ],
  leftOut: [
    'Treino marcado como não feito não entra.',
    'Treino sem esforço percebido ou sem duração NÃO entra (nunca vira zero e nada é estimado): aparece na lista "Ficaram de fora", com o motivo.',
    'Usa o que está registrado no feedback do treino (esforço percebido e duração); não lê dados do relógio nem a FC diretamente, por isso vale para qualquer fonte.',
    'É uma descrição do que foi feito. Não é recomendação, e o Atlas ainda não usa esta métrica.',
  ],
};

export function buildTrainingLoad(rows: LoadInputRow[], period: { from: string; to: string }, today: string): TrainingLoadResult {
  const { sessions: all, excluded: allExcluded } = classifySessions(rows);
  const inPeriod = (date: string) => date >= period.from && date <= period.to;
  // A janela cronica de uma semana do periodo olha ate' 28 dias ANTES dela: por isso os calculos usam o historico todo, e so' a EXIBICAO e' recortada no periodo.
  const sessions = all.filter((s) => inPeriod(s.date));
  const excluded = allExcluded.filter((s) => inPeriod(s.date));
  const weeks: LoadWeek[] = [];
  for (let weekStart = weekStartOf(period.from); weekStart <= period.to; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6);
    const asOf = weekEnd < period.to ? weekEnd : period.to;
    const shownFrom = weekStart > period.from ? weekStart : period.from;
    const shownTo = weekEnd < period.to ? weekEnd : period.to;
    const inWeek = (date: string) => date >= shownFrom && date <= shownTo; // so' o que esta DENTRO do periodo escolhido (a barra bate com a lista)
    const weekSessions = all.filter((s) => inWeek(s.date));
    weeks.push({
      weekStart, weekEnd, inProgress: weekEnd > today, clipped: shownFrom > weekStart || shownTo < weekEnd,
      load: round1(weekSessions.reduce((sum, s) => sum + s.load, 0)), sessions: weekSessions.length, excluded: allExcluded.filter((s) => inWeek(s.date)).length,
      window: windowAt(asOf < today ? asOf : today, all, allExcluded),
    });
  }
  const last = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? [...all].sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
  return {
    method: { version: LOAD_METHOD_VERSION, ...METHOD_TEXT },
    period, sessions, excluded, weeks,
    current: windowAt(period.to < today ? period.to : today, all, allExcluded),
    totals: { sessions: sessions.length, excluded: excluded.length, load: round1(sessions.reduce((sum, s) => sum + s.load, 0)) },
    example: last ? { date: last.date, rpe: last.rpe, minutes: last.minutes, load: last.load } : null,
  };
}
