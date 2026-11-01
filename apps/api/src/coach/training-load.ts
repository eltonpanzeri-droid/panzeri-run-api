// CARGA DE TREINO PRÓPRIA (Panzeri Run, 23/10/2026; v2 no mesmo dia) — métrica DESCRITIVA, em avaliação. Funções PURAS.
//
// Como é calculada (a mesma explicação aparece na tela do painel):
//  1. CARGA DA SESSÃO = esforço percebido (1 a 10, que a aluna informa depois do treino) × duração em minutos (método "sRPE", de Foster). Unidade: UA (unidade arbitrária).
//     Duração: com relógio sincronizado (UMA atividade importada corretamente vinculada ao treino) vale a duração DELA — o app já a preenche sozinho; sem atividade, vale a informada pela aluna. A origem aparece na tela.
//  2. DATA da carga = o dia em que o treino foi EXECUTADO, quando existe atividade importada vinculada (data real). Sem ela, vale a data PROGRAMADA e a tela marca "só programada". Nunca se inventa data.
//  3. SEMANA (segunda a domingo) = soma da carga das sessões da semana. Há visões por modalidade (corrida, força, outras) e uma visão GERAL, que é só a soma de cargas sRPE de modalidades diferentes.
//  4. AGUDA = soma dos últimos 7 dias. CRÔNICA = média semanal dos últimos 28 dias (soma de 28 dias ÷ 4). RAZÃO = aguda ÷ crônica (1,0 = mesma carga do hábito recente), só descritiva.
//     A razão só existe com 28 dias de histórico E pelo menos 10 treinos nos últimos 28 dias (decisão de Elton, 23/10/2026): com menos que isso a métrica vale pouco e não é mostrada.
//  5. O que NÃO entra: treino marcado como não feito; treino sem esforço percebido ou sem duração utilizável (nunca vira zero nem é estimado — aparece numa lista própria, com o motivo).
//
// Isto DESCREVE o que a aluna fez. NÃO decide treino, NÃO é recomendação e não há faixa de risco.
// 01/11/2026: o MESMO cálculo agora alimenta (a) o painel, (b) o Explorar (variáveis workout.sessionInternalLoad / workout.sessionDurationUsedMin do registro, com médias e bandas só com sessões
// ANTERIORES) e (c) o contexto dos agentes de IA (bloco `cargaInternaPercebida`). Fonte única dos registros: training-load-rows.ts.

import { canonicalModality } from '../activity-execution/canonical-modality'; // modulo puro (sem imports)
import type { ReferencePoint, ReferenceSeries } from '../training-intelligence/reference-series'; // so' tipos (nenhuma dependencia de execucao)

// Chave de modalidade usada nas observacoes do registro (workout.sessionInternalLoad): a modalidade canonica da sessao (valor bruto do provedor, ex.: 'RUNNING', vira 'corrida'); valor desconhecido segue o proprio texto.
export function loadModalityKey(modality: string | null | undefined): string {
  const raw = (modality ?? '').trim().toLowerCase();
  return canonicalModality(raw) ?? (raw || 'outra');
}

export const LOAD_METHOD_VERSION = 'carga-interna-percebida v3 (01/11/2026)';
export const ACUTE_DAYS = 7;
export const CHRONIC_DAYS = 28;
// Minimo de treinos (que entraram na conta) nos 28 dias para a razao valer (decisao de Elton, 23/10/2026). Vale por visao: modalidade com menos treinos fica sem razao.
export const MIN_SESSIONS_IN_WINDOW = 10;

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
export type ActivityNote = 'vinculo_distante' | 'vinculo_confirmado' | 'atividade_ja_usada' | null;
export type DurationSource = 'informada' | 'atividade_importada';

export interface LoadInputRow {
  id: string;
  /** Treino programado a que o registro pertence (rastreio até o original). */
  sessionId?: string | null;
  /** Atividade importada cuja duração/data foram usadas (rastreio). */
  activityLogId?: string | null;
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
  activityNote?: ActivityNote;
  /** Origem da duracao em durationMin: 'atividade_importada' quando a sessao e' uma extra materializada de uma atividade (a duracao foi COPIADA dela, nao informada pela aluna). */
  durationOrigin?: DurationSource;
  perceivedEffort: number | null;
  isExtra: boolean;
}

export interface LoadSession {
  id: string; sessionId: string | null; activityLogId: string | null; date: string; dateSource: DateSource; scheduledDate: string | null; shiftDays: number | null; dateZoneAssumed: boolean; activityNote: LoadInputRow['activityNote'];
  modality: string | null; group: LoadGroup; title: string | null; isExtra: boolean; adjusted: boolean;
  /** Duracao que a aluna informou, quando a usada na conta e' a da atividade e ela e' diferente (para o treinador comparar). */
  informedMinutes: number | null;
  rpe: number; minutes: number; durationSource: DurationSource; durationProvider: string | null; load: number;
}
export type ExclusionReason = 'sem_esforco' | 'sem_duracao' | 'sem_esforco_e_duracao';
export interface ExcludedSession {
  id: string; sessionId: string | null; activityLogId: string | null; date: string; dateSource: DateSource; scheduledDate: string | null; shiftDays: number | null; dateZoneAssumed: boolean; activityNote: LoadInputRow['activityNote'];
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
  /** Treinos que ENTRARAM na conta nos ultimos 28 dias (e o minimo exigido para a razao existir). */
  sessionsInWindow: number;
  minSessions: number;
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
  /** Comparação da sessão mais recente de cada modalidade com o histórico ANTERIOR a ela (preenchido pelo serviço; a função pura buildTrainingLoad não tem acesso à camada matemática). */
  references?: Partial<Record<LoadGroup, SessionReferenceView>>;
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
    // Com atividade importada corretamente vinculada (relogio sincronizado) vale a duracao DELA — o app ja' a preenche sozinho (decisao de Elton, 23/10/2026); sem atividade (ou sem duracao nela),
    // vale a informada pela aluna. A origem fica registrada e, se a da aluna for diferente, ela tambem e' mostrada.
    const useImported = imported != null && imported > 0;
    const minutes = useImported ? imported : informed != null && informed > 0 ? informed : null;
    // Sessao extra materializada de atividade: a duracao em durationMin foi COPIADA da atividade (nao e' "informada pela aluna").
    const durationSource: DurationSource = useImported ? 'atividade_importada' : row.durationOrigin ?? 'informada';
    const informedMinutes = useImported && informed != null && informed > 0 && informed !== imported && (row.durationOrigin ?? 'informada') === 'informada' ? informed : null;
    const dateSource: DateSource = row.dateSource ?? 'programada';
    const scheduledDate = row.scheduledDate ?? null;
    const shiftDays = dateSource === 'atividade_vinculada' && scheduledDate ? diffDays(scheduledDate, row.date) : null; // dias entre o programado e o executado
    const base = { id: row.id, sessionId: row.sessionId ?? null, activityLogId: row.activityLogId ?? null, date: row.date, dateSource, scheduledDate, shiftDays, dateZoneAssumed: row.dateZoneAssumed === true, activityNote: row.activityNote ?? null, modality: row.modality, group: modalityGroup(row.modality), title: row.title, isExtra: row.isExtra };
    if (rpe == null || minutes == null) {
      excluded.push({ ...base, reason: rpe == null && minutes == null ? 'sem_esforco_e_duracao' : rpe == null ? 'sem_esforco' : 'sem_duracao', rpe, minutes });
    } else {
      sessions.push({ ...base, adjusted: row.status === 'adjusted', informedMinutes, rpe, minutes, durationSource, durationProvider: durationSource === 'atividade_importada' ? row.activityProvider ?? null : null, load: round1(rpe * minutes) });
    }
  }
  const byDate = (a: { date: string; id: string }, b: { date: string; id: string }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1);
  return { sessions: sessions.sort(byDate), excluded: excluded.sort(byDate) };
}

/** Aguda (7 dias), crônica (28 dias) e razão até o dia `asOf` (inclusive). A razão só existe com a janela crônica COMPLETA no histórico. */
export function windowAt(asOf: string, sessions: LoadSession[], excluded: ExcludedSession[], minSessions: number = MIN_SESSIONS_IN_WINDOW): LoadWindow {
  const inRange = (date: string, days: number) => date <= asOf && date >= addDays(asOf, -(days - 1));
  const acuteRaw = sessions.filter((s) => inRange(s.date, ACUTE_DAYS)).reduce((sum, s) => sum + s.load, 0);
  const chronicRaw = sessions.filter((s) => inRange(s.date, CHRONIC_DAYS)).reduce((sum, s) => sum + s.load, 0);
  const chronicAverageRaw = chronicRaw / (CHRONIC_DAYS / ACUTE_DAYS); // a razao usa os valores SEM arredondar; so' a exibicao arredonda
  const first = [...sessions, ...excluded].map((s) => s.date).sort()[0];
  const chronicDaysCovered = first == null || first > asOf ? 0 : Math.min(CHRONIC_DAYS, diffDays(first, asOf) + 1);
  const excludedInWindow = excluded.filter((s) => inRange(s.date, CHRONIC_DAYS)).length;
  const sessionsInWindow = sessions.filter((s) => inRange(s.date, CHRONIC_DAYS)).length;
  let ratio: number | null = null;
  let note: string | null = null;
  if (chronicDaysCovered < CHRONIC_DAYS) note = `Histórico curto: só ${chronicDaysCovered} de ${CHRONIC_DAYS} dias — a razão ainda não existe.`;
  else if (chronicAverageRaw <= 0) note = 'Sem carga registrada nos últimos 28 dias — a razão não existe.';
  else if (sessionsInWindow < minSessions) note = `Poucos treinos: só ${sessionsInWindow} de ${minSessions} nos últimos ${CHRONIC_DAYS} dias — com tão pouca amostra a razão vale pouco e não é mostrada.`;
  else {
    ratio = Math.round((acuteRaw / chronicAverageRaw) * 100) / 100;
    if (excludedInWindow > 0) note = `${excludedInWindow} treino(s) dos últimos 28 dias ficaram de fora por falta de esforço percebido ou duração: a razão usa só o que foi informado.`;
  }
  return { asOf, acuteLoad: round1(acuteRaw), chronicLoad: round1(chronicRaw), chronicWeeklyAverage: round1(chronicAverageRaw), ratio, chronicDaysCovered, sessionsInWindow, minSessions, excludedInWindow, note };
}

export const METHOD_TEXT = {
  formula: 'Carga da sessão (UA) = esforço percebido (1 a 10) × minutos. Razão = carga dos últimos 7 dias ÷ média semanal dos últimos 28 dias.',
  steps: [
    'Cada treino feito (ou feito com ajustes) vale: esforço percebido que a aluna informou (1 a 10) × duração em minutos = carga da sessão, em UA (unidade arbitrária).',
    'Duração: quando existe UMA atividade importada (relógio sincronizado) corretamente vinculada ao treino, vale a duração dela, sem duplicar (o app já a preenche sozinho no feedback); a tela mostra de onde veio e, se a aluna informou outro valor, mostra também o dela. Sem atividade, vale a duração que a aluna informou (o feedback só salva com ela). Sem nenhuma das duas, o treino fica de fora.',
    'Data: a carga entra no dia em que o treino foi EXECUTADO, quando existe atividade importada vinculada (data real). Sem atividade, vale a data PROGRAMADA e a tela marca "só programada" (sem sessão programada, vale o dia do registro, marcado "só registro"). Nunca se inventa data.',
    'A carga da semana (segunda a domingo) é a soma das sessões da semana. Há uma visão por modalidade (corrida, força, outras) e a visão GERAL, que é só a soma de cargas sRPE de modalidades diferentes.',
    'Aguda = soma dos últimos 7 dias. Crônica = média semanal dos últimos 28 dias (soma dos 28 dias ÷ 4). Razão = aguda ÷ crônica. Razão 1,0 = mesma carga do hábito recente; acima = semana mais carregada que o hábito; abaixo = mais leve. Atenção: os 28 dias INCLUEM os 7 dias da aguda, o que aproxima a razão de 1,0. É só informação descritiva: não há faixa de risco nem recomendação.',
    'A razão só aparece quando já existem 28 dias de histórico E pelo menos 10 treinos nos últimos 28 dias (por visão: uma modalidade com menos de 10 treinos fica sem razão). Com menos que isso a métrica vale pouco, e a tela diz quantos treinos faltam.',
  ],
  leftOut: [
    'Treino marcado como não feito não entra.',
    'Treino sem esforço percebido, ou sem duração utilizável (nem da atividade vinculada nem informada), NÃO entra (nunca vira zero e nada é estimado): aparece na lista "Ficaram de fora", com o motivo.',
    'A atividade importada só é usada quando está confirmada para aquele treino (uma só, sem duplicar a mesma atividade em dois treinos). Vínculo automático a mais de 3 dias do dia programado é ignorado; vínculo confirmado por pessoa (aluna ou treinador) vale até 6 dias. Dados do Strava não são usados.',
    'Não lê a FC nem outras medidas do relógio: só a duração e o dia da atividade vinculada.',
    'É uma descrição do que foi feito: não é recomendação nem faixa de risco. A IA de prescrição e de evolução recebe a PSE, a duração e a carga SEPARADAS, por modalidade, e a interpreta junto com sono, dor, fadiga, satisfação e demais dados — um indicador sozinho nunca decide o treino.',
  ],
  generalViewNote: 'A visão GERAL é a soma de cargas sRPE de modalidades diferentes (corrida, força e outras). A unidade (UA) é a mesma, mas o esforço de cada tipo de treino não é equivalente: use as visões por modalidade para comparar.',
};

function viewFor(group: LoadView, all: LoadSession[], allExcluded: ExcludedSession[], period: { from: string; to: string }, today: string, minSessions: number): LoadViewResult {
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
      window: windowAt(asOf < today ? asOf : today, sessionsAll, excludedAll, minSessions),
    });
  }
  const shown = sessionsAll.filter((s) => inPeriod(s.date));
  return {
    weeks,
    current: windowAt(period.to < today ? period.to : today, sessionsAll, excludedAll, minSessions),
    totals: { sessions: shown.length, excluded: excludedAll.filter((s) => inPeriod(s.date)).length, load: round1(shown.reduce((sum, s) => sum + s.load, 0)) },
  };
}

export function buildTrainingLoad(rows: LoadInputRow[], period: { from: string; to: string }, today: string, minSessions: number = MIN_SESSIONS_IN_WINDOW): TrainingLoadResult {
  const { sessions: all, excluded: allExcluded } = classifySessions(rows);
  const inPeriod = (date: string) => date >= period.from && date <= period.to;
  const sessions = all.filter((s) => inPeriod(s.date));
  const excluded = allExcluded.filter((s) => inPeriod(s.date));
  const views = Object.fromEntries(LOAD_VIEWS.map((view) => [view, viewFor(view, all, allExcluded, period, today, minSessions)])) as Record<LoadView, LoadViewResult>;
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

// ── Comparação da SESSÃO com o histórico (01/11/2026) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// A sessão investigada NUNCA entra nas médias e bandas usadas para compará-la: as referências vêm de reference-series.ts (`prior_observations_only`), a MESMA metodologia dos demais indicadores da Evolução:
// média histórica = todas as sessões elegíveis anteriores da MESMA modalidade; médias móveis das últimas 7/21/60/200 sessões anteriores; faixa habitual = P10–P90 das anteriores (até 200), com
// >= 12 sessões anteriores = individual, 4 a 11 = limitada, menos que 4 = SEM faixa (amostra insuficiente: ausência de faixa nunca é tratada como "normal"). Sessões no MESMO dia e modalidade compartilham
// a mesma referência (nenhuma entra na referência da outra). Nada aqui decide treino nem classifica como bom/ruim: o sinal só diz de que lado da faixa individual o valor ficou.
export interface SessionComparison {
  id: string; sessionId: string | null; date: string; modality: string | null; title: string | null;
  rpe: number; minutes: number; load: number; durationSource: DurationSource; durationProvider: string | null;
  /** Quantas sessões elegíveis da mesma modalidade existiam ANTES desta. */
  priorN: number;
  historicalMean: { value: number | null; n: number };
  movingAverages: Array<{ key: string; label: string; value: number | null; n: number; partial: boolean }>;
  band: { lower: number | null; upper: number | null; median: number | null; n: number; basis: 'individual' | 'limited' | 'none' };
  signal: 'above' | 'below' | 'within' | 'no_reference';
  outsideBy: number | null;
  /** Diferença da carga desta sessão para a média histórica anterior e para a média móvel das últimas 7 sessões anteriores (null quando não há referência). */
  vsHistoricalMean: { absolute: number; percent: number | null } | null;
  vsMoving7: { absolute: number; percent: number | null } | null;
  sufficient: boolean; // há faixa (limitada ou individual)
}
export interface SessionReferenceView {
  group: LoadGroup;
  /** Modalidades canônicas reunidas neste grupo (ex.: corrida + esteira). */
  modalities: string[];
  /** Sessões elegíveis do grupo em todo o histórico (base das referências). */
  eligibleSessions: number;
  unit: string;
  windows: Array<{ key: string; label: string }>;
  bandPolicy: { method: string; windowSize: number; individualMin: number; limitedMin: number };
  /** A sessão mais recente do grupo, comparada só com o que veio ANTES dela. */
  last: SessionComparison | null;
  /** Série curta para o gráfico por sessão (mais antigas primeiro). */
  points: Array<{ date: string; load: number; rpe: number | null; minutes: number | null; mm7: number | null; lower: number | null; upper: number | null; signal: string }>;
}

const pctOf = (delta: number, base: number | null): number | null => (base != null && base !== 0 ? Math.round((delta / base) * 1000) / 10 : null);
const diffVs = (value: number, ref: number | null | undefined) => (ref == null ? null : { absolute: round1(value - ref), percent: pctOf(value - ref, ref) });

/** Junta a sessão (cálculo) com o ponto de referência correspondente (só observações anteriores). Função pura, testável sem banco. */
export function compareSessionToReference(session: LoadSession, point: ReferencePoint, series: Pick<ReferenceSeries, 'windows'>): SessionComparison {
  const mm7 = point.movingAverages.mm7;
  return {
    id: session.id, sessionId: session.sessionId, date: session.date, modality: session.modality, title: session.title,
    rpe: session.rpe, minutes: session.minutes, load: session.load, durationSource: session.durationSource, durationProvider: session.durationProvider,
    priorN: point.priorN,
    historicalMean: { value: point.historicalMean.value != null ? round1(point.historicalMean.value) : null, n: point.historicalMean.n },
    movingAverages: series.windows.map(({ key, label }) => { const w = point.movingAverages[key as keyof typeof point.movingAverages]; return { key, label, value: w.value != null ? round1(w.value) : null, n: w.n, partial: w.isPartialWindow }; }),
    band: { lower: point.band.lower != null ? round1(point.band.lower) : null, upper: point.band.upper != null ? round1(point.band.upper) : null, median: point.band.median != null ? round1(point.band.median) : null, n: point.band.n, basis: point.band.basis },
    signal: point.signal,
    outsideBy: point.outsideBy != null ? round1(point.outsideBy) : null,
    vsHistoricalMean: diffVs(session.load, point.historicalMean.value),
    vsMoving7: diffVs(session.load, mm7.value),
    sufficient: point.band.basis !== 'none',
  };
}
