// CARGA DE TREINO PRÓPRIA (Panzeri Run, 23/10/2026; v2 no mesmo dia) — métrica DESCRITIVA, em avaliação. Funções PURAS.
//
// Como é calculada (a mesma explicação aparece na tela do painel):
//  1. CARGA DA SESSÃO = esforço percebido (1 a 10, que a aluna informa depois do treino) × duração em minutos (método "sRPE", de Foster). Unidade: UA (unidade arbitrária).
//     A duração é a que a aluna informou; se faltar, e houver UMA atividade importada corretamente vinculada ao treino, usa-se a duração dela (a origem aparece na tela).
//  2. DATA da carga = o dia em que o treino foi EXECUTADO, quando existe atividade importada vinculada (data real). Sem ela, vale a data PROGRAMADA e a tela marca "só programada". Nunca se inventa data.
//  3. SEMANA (segunda a domingo) = soma da carga das sessões da semana. Há visões por modalidade (corrida, força, outras) e uma visão GERAL, que é só a soma de cargas sRPE de modalidades diferentes.
//  4. AGUDA = soma dos últimos 7 dias. CRÔNICA = média semanal dos últimos 28 dias (soma de 28 dias ÷ 4). RAZÃO = aguda ÷ crônica (1,0 = mesma carga do hábito recente), só descritiva.
//  5. O que NÃO entra: treino marcado como não feito; treino sem esforço percebido ou sem duração utilizável (nunca vira zero nem é estimado — aparece numa lista própria, com o motivo).
//
// Isto DESCREVE o que a aluna fez. NÃO decide treino, NÃO é recomendação, não há faixa de risco e (até decisão de Elton) o Atlas NÃO usa.

import { canonicalModality } from '../activity-execution/canonical-modality'; // modulo puro (sem imports)

export const LOAD_METHOD_VERSION = 'carga-propria v2 (23/10/2026)';
export const ACUTE_DAYS = 7;
export const CHRONIC_DAYS = 28;

export type LoadGroup = 'corrida' | 'forca' | 'outras';
export type LoadView = 'geral' | LoadGroup;
export const LOAD_VIEWS: readonly LoadView[] = ['geral', 'corrida', 'forca', 'outras'];

// Agrupamento por modalidade da SESSAO: corrida inclui esteira; forca inclui o fortalecimento de corredores; o resto (caminhada etc.) fica em "outras".
export function modalityGroup(modality: string | null | undefined): LoadGroup {
  // Sessoes extras materializadas de atividade podem trazer o valor bruto do provedor ('RUNNING'): a modalidade canonica resolve (valor desconhecido segue o proprio texto).
  const raw = (modality ?? '').trim().toLowerCase();
  const key = canonicalModality(raw) ?? raw;
  if (key === 'corrida' || key === 'esteira') return 'corrida';
  if (key === 'forca' || key === 'fortalecimento_corredores') return 'forca';
  return 'outras';
}

// De onde vem a data da carga: a atividade importada vinculada (data REAL), a data programada do treino ou, sem sessao programada, o dia do registro. Nunca se inventa data.
export type DateSource = 'atividade_vinculada' | 'programada' | 'registro';
export type DurationSource = 'informada' | 'atividade_importada';

export interface LoadInputRow {
  id: string;
  date: string; // AAAA-MM-DD: data REAL (atividade vinculada) ou, na falta dela, a programada (ou o dia do registro, sem sessao programada)
  /** De onde veio `date`. Sem informacao = programada (nunca se presume data real). */
  dateSource?: DateSource;
  modality: string | null;
  title: string | null;
  status: string; // done | adjusted | missed
  durationMin: number | null; // informada pela aluna
  /** Dia programado do treino (quando existe sessao programada). Serve para mostrar o deslocamento entre o programado e o executado. */
  scheduledDate?: string | null;
  /** true quando o fuso da atividade nao foi informado pela fonte e o dia local foi presumido (Sao Paulo). */
  dateZoneAssumed?: boolean;
  /** Duracao da atividade importada vinculada (so' quando UMA atividade confirmada, sem duplicar). */
  activityDurationMin?: number | null;
  activityProvider?: string | null;
  /** Por que uma atividade vinculada NAO foi usada neste treino (aparece na tela). */
  activityNote?: 'vinculo_distante' | 'atividade_ja_usada' | null;
  /** Origem da duracao em durationMin: 'atividade_importada' quando a sessao e' uma extra materializada de uma atividade (a duracao foi COPIADA dela, nao informada pela aluna). */
  durationOrigin?: DurationSource;
  perceivedEffort: number | null;
  isExtra: boolean;
}

export interface LoadSession {
  id: string; date: string; dateSource: DateSource; scheduledDate: string | null; shiftDays: number | null; dateZoneAssumed: boolean; activityNote: LoadInputRow['activityNote'];
  modality: string | null; group: LoadGroup; title: string | null; isExtra: boolean; adjusted: boolean;
  rpe: number; minutes: number; durationSource: DurationSource; durationProvider: string | null; load: number;
}
export type ExclusionReason = 'sem_esforco' | 'sem_duracao' | 'sem_esforco_e_duracao';
export interface ExcludedSession {
  id: string; date: string; dateSource: DateSource; scheduledDate: string | null; shiftDays: number | null; dateZoneAssumed: boolean; activityNote: LoadInputRow['activityNote'];
  modality: string | null; group: LoadGroup; title: string | null; isExtra: boolean; reason: ExclusionReason; rpe: number | null; minutes: number | null;
}

export interface LoadWindow {
  asOf: string;
  acuteLoad: number;
  chronicLoad: number; // soma dos 28 dias
  chronicWeeklyAverage: number; // soma ÷ 4
  ratio: number | null;
  /** Dias da janela crônica que já existem no histórico de cargas (28 = completa). */
  chronicDaysCovered: number;
  /** Sessões que ficaram DE FORA (sem esforço/duração) dentro dos 28 dias: a razão está calculada só com o que foi informado. */
  excludedInWindow: number;
  note: string | null;
}

export interface LoadWeek {
  weekStart: string;
  weekEnd: string;
  inProgress: boolean;
  /** true quando o período escolhido corta a semana: a barra soma só os dias dentro do período (a razão continua olhando os 28 dias anteriores). */
  clipped: boolean;
  load: number;
  sessions: number;
  excluded: number;
  window: LoadWindow;
}

export interface LoadViewResult {
  weeks: LoadWeek[];
  current: LoadWindow;
  totals: { sessions: number; excluded: number; load: number };
}

export interface TrainingLoadResult {
  method: { version: string; formula: string; steps: string[]; leftOut: string[]; generalViewNote: string };
  period: { from: string; to: string };
  /** Todos os treinos que entraram no período (todas as modalidades); cada um traz o seu grupo. */
  sessions: LoadSession[];
  excluded: ExcludedSession[];
  /** Uma visão por modalidade + a GERAL (soma de cargas sRPE de modalidades diferentes). */
  views: Record<LoadView, LoadViewResult>;
  /** Origem dos dados dos treinos que entraram no período. */
  sources: { dateReal: number; dateProgrammedOnly: number; dateRegisteredOnly: number; durationInformed: number; durationImported: number };
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

/** Separa o que entra no cálculo do que fica de fora (com o motivo). Treino não feito não entra em nenhuma das duas listas. */
export function classifySessions(rows: LoadInputRow[]): { sessions: LoadSession[]; excluded: ExcludedSession[] } {
  const sessions: LoadSession[] = [];
  const excluded: ExcludedSession[] = [];
  for (const row of rows) {
    if (row.status !== 'done' && row.status !== 'adjusted') continue;
    const rpe = row.perceivedEffort != null && Number.isFinite(row.perceivedEffort) && row.perceivedEffort >= 1 && row.perceivedEffort <= 10 ? row.perceivedEffort : null;
    // Minutos com no maximo 2 casas: o numero usado na conta e' EXATAMENTE o exibido na tela, para a conta ser reproduzivel a mao.
    const usable = (value: number | null | undefined) => (value != null && Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null);
    const informed = usable(row.durationMin);
    const imported = usable(row.activityDurationMin);
    // A duracao informada pela aluna tem prioridade; a da atividade importada so' entra quando a dela falta (e a atividade esta corretamente vinculada — ver o servico).
    const minutes = informed != null && informed > 0 ? informed : imported != null && imported > 0 ? imported : null;
    // Sessao extra materializada de atividade: a duracao em durationMin foi COPIADA da atividade (nao e' "informada pela aluna").
    const durationSource: DurationSource = informed != null && informed > 0 ? row.durationOrigin ?? 'informada' : 'atividade_importada';
    const dateSource: DateSource = row.dateSource ?? 'programada';
    const scheduledDate = row.scheduledDate ?? null;
    const shiftDays = dateSource === 'atividade_vinculada' && scheduledDate ? diffDays(scheduledDate, row.date) : null; // dias entre o programado e o executado
    const base = { id: row.id, date: row.date, dateSource, scheduledDate, shiftDays, dateZoneAssumed: row.dateZoneAssumed === true, activityNote: row.activityNote ?? null, modality: row.modality, group: modalityGroup(row.modality), title: row.title, isExtra: row.isExtra };
    if (rpe == null || minutes == null) {
      excluded.push({ ...base, reason: rpe == null && minutes == null ? 'sem_esforco_e_duracao' : rpe == null ? 'sem_esforco' : 'sem_duracao', rpe, minutes });
    } else {
      sessions.push({ ...base, adjusted: row.status === 'adjusted', rpe, minutes, durationSource, durationProvider: durationSource === 'atividade_importada' ? row.activityProvider ?? null : null, load: round1(rpe * minutes) });
    }
  }
  const byDate = (a: { date: string; id: string }, b: { date: string; id: string }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1);
  return { sessions: sessions.sort(byDate), excluded: excluded.sort(byDate) };
}

/** Aguda (7 dias), crônica (28 dias) e razão até o dia `asOf` (inclusive). A razão só existe com a janela crônica COMPLETA no histórico. */
export function windowAt(asOf: string, sessions: LoadSession[], excluded: ExcludedSession[]): LoadWindow {
  const inRange = (date: string, days: number) => date <= asOf && date >= addDays(asOf, -(days - 1));
  const acuteRaw = sessions.filter((s) => inRange(s.date, ACUTE_DAYS)).reduce((sum, s) => sum + s.load, 0);
  const chronicRaw = sessions.filter((s) => inRange(s.date, CHRONIC_DAYS)).reduce((sum, s) => sum + s.load, 0);
  const chronicAverageRaw = chronicRaw / (CHRONIC_DAYS / ACUTE_DAYS); // a razao usa os valores SEM arredondar; so' a exibicao arredonda
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
  return { asOf, acuteLoad: round1(acuteRaw), chronicLoad: round1(chronicRaw), chronicWeeklyAverage: round1(chronicAverageRaw), ratio, chronicDaysCovered, excludedInWindow, note };
}

export const METHOD_TEXT = {
  formula: 'Carga da sessão (UA) = esforço percebido (1 a 10) × minutos. Razão = carga dos últimos 7 dias ÷ média semanal dos últimos 28 dias.',
  steps: [
    'Cada treino feito (ou feito com ajustes) vale: esforço percebido que a aluna informou (1 a 10) × duração em minutos = carga da sessão, em UA (unidade arbitrária).',
    'Duração: vale a que a aluna informou. Se ela não informou e existe UMA atividade importada (relógio/aplicativo) corretamente vinculada ao treino, usa-se a duração dessa atividade, sem duplicar, e a tela mostra de onde veio. Sem nenhuma das duas, o treino fica de fora.',
    'Data: a carga entra no dia em que o treino foi EXECUTADO, quando existe atividade importada vinculada (data real). Sem atividade, vale a data PROGRAMADA e a tela marca "só programada" (sem sessão programada, vale o dia do registro, marcado "só registro"). Nunca se inventa data.',
    'A carga da semana (segunda a domingo) é a soma das sessões da semana. Há uma visão por modalidade (corrida, força, outras) e a visão GERAL, que é só a soma de cargas sRPE de modalidades diferentes.',
    'Aguda = soma dos últimos 7 dias. Crônica = média semanal dos últimos 28 dias (soma dos 28 dias ÷ 4). Razão = aguda ÷ crônica. Razão 1,0 = mesma carga do hábito recente; acima = semana mais carregada que o hábito; abaixo = mais leve. Atenção: os 28 dias INCLUEM os 7 dias da aguda, o que aproxima a razão de 1,0. É só informação descritiva: não há faixa de risco nem recomendação.',
    'A razão só aparece quando já existem 28 dias de histórico. Antes disso a tela diz que o histórico é curto.',
  ],
  leftOut: [
    'Treino marcado como não feito não entra.',
    'Treino sem esforço percebido, ou sem duração utilizável (nem informada nem de uma atividade vinculada), NÃO entra (nunca vira zero e nada é estimado): aparece na lista "Ficaram de fora", com o motivo.',
    'A atividade importada só é usada quando está confirmada para aquele treino (uma só, sem duplicar a mesma atividade em dois treinos). Dados do Strava não são usados.',
    'Não lê a FC nem outras medidas do relógio: só a duração e o dia da atividade vinculada, e só quando a aluna não informou.',
    'É uma descrição do que foi feito. Não é recomendação, e o Atlas ainda não usa esta métrica.',
  ],
  generalViewNote: 'A visão GERAL é a soma de cargas sRPE de modalidades diferentes (corrida, força e outras). A unidade (UA) é a mesma, mas o esforço de cada tipo de treino não é equivalente: use as visões por modalidade para comparar.',
};

function viewFor(group: LoadView, all: LoadSession[], allExcluded: ExcludedSession[], period: { from: string; to: string }, today: string): LoadViewResult {
  const pick = <T extends { group: LoadGroup }>(list: T[]) => (group === 'geral' ? list : list.filter((s) => s.group === group));
  const sessionsAll = pick(all);
  const excludedAll = pick(allExcluded);
  const inPeriod = (date: string) => date >= period.from && date <= period.to;
  const weeks: LoadWeek[] = [];
  for (let weekStart = weekStartOf(period.from); weekStart <= period.to; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6);
    const asOf = weekEnd < period.to ? weekEnd : period.to;
    const shownFrom = weekStart > period.from ? weekStart : period.from;
    const shownTo = weekEnd < period.to ? weekEnd : period.to;
    const inWeek = (date: string) => date >= shownFrom && date <= shownTo; // so' o que esta DENTRO do periodo escolhido (a barra bate com a lista)
    const weekSessions = sessionsAll.filter((s) => inWeek(s.date));
    weeks.push({
      weekStart, weekEnd, inProgress: weekEnd > today, clipped: shownFrom > weekStart || shownTo < weekEnd,
      load: round1(weekSessions.reduce((sum, s) => sum + s.load, 0)), sessions: weekSessions.length, excluded: excludedAll.filter((s) => inWeek(s.date)).length,
      // A janela cronica de uma semana do periodo olha ate' 28 dias ANTES dela: por isso usa o historico todo, e so' a EXIBICAO e' recortada no periodo.
      window: windowAt(asOf < today ? asOf : today, sessionsAll, excludedAll),
    });
  }
  const shown = sessionsAll.filter((s) => inPeriod(s.date));
  return {
    weeks,
    current: windowAt(period.to < today ? period.to : today, sessionsAll, excludedAll),
    totals: { sessions: shown.length, excluded: excludedAll.filter((s) => inPeriod(s.date)).length, load: round1(shown.reduce((sum, s) => sum + s.load, 0)) },
  };
}

export function buildTrainingLoad(rows: LoadInputRow[], period: { from: string; to: string }, today: string): TrainingLoadResult {
  const { sessions: all, excluded: allExcluded } = classifySessions(rows);
  const inPeriod = (date: string) => date >= period.from && date <= period.to;
  const sessions = all.filter((s) => inPeriod(s.date));
  const excluded = allExcluded.filter((s) => inPeriod(s.date));
  const views = Object.fromEntries(LOAD_VIEWS.map((view) => [view, viewFor(view, all, allExcluded, period, today)])) as Record<LoadView, LoadViewResult>;
  const last = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? [...all].sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
  return {
    method: { version: LOAD_METHOD_VERSION, formula: METHOD_TEXT.formula, steps: METHOD_TEXT.steps, leftOut: METHOD_TEXT.leftOut, generalViewNote: METHOD_TEXT.generalViewNote },
    period, sessions, excluded, views,
    sources: {
      dateReal: sessions.filter((s) => s.dateSource === 'atividade_vinculada').length,
      dateProgrammedOnly: sessions.filter((s) => s.dateSource === 'programada').length,
      dateRegisteredOnly: sessions.filter((s) => s.dateSource === 'registro').length,
      durationInformed: sessions.filter((s) => s.durationSource === 'informada').length,
      durationImported: sessions.filter((s) => s.durationSource === 'atividade_importada').length,
    },
    example: last ? { date: last.date, rpe: last.rpe, minutes: last.minutes, load: last.load } : null,
  };
}
