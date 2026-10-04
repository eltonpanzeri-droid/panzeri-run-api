// Nova Home do aluno (30/09/2026) — funções PURAS, sem import de React Native, pra serem
// testáveis com jest puro (o projeto mobile não tem infraestrutura de teste de componente RN —
// ver nota de pendência no relatório final). Nenhum cálculo de treino/aderência/medalha aqui:
// só seleção/formatação do que a API já manda pronto.

export interface HomeSessionLite {
  id: string;
  isoDate: string;
  title: string;
  detail: string;
  modality: string;
  distanceKm: number | null;
  durationMin: number | null;
  structure: unknown;
  completion: { status: string } | null;
  // Execucao OBJETIVA (ActivityLog via SessionExecutionLink ativo) — mesma fonte que alimenta os
  // agregados (7/8 treinos, km). Independe de feedback/WorkoutCompletion. Opcional: API antiga nao envia.
  realized?: { activityLogId: string } | null;
}

/** Atividade alternativa (sem prescricao correspondente) — realizada, mas nunca cumpre uma sessao. */
export interface HomeAlternativeLite {
  activityLogId: string | null;
  isoDate: string;
}

/**
 * Estado de execucao de uma sessao prescrita. Execucao objetiva (vinculo ativo) prova que o treino
 * aconteceu mesmo sem feedback; o feedback so' refina (ajustado). Sem vinculo, vale o feedback legado.
 */
export function sessionExecutionState(session: HomeSessionLite): 'done' | 'adjusted' | 'missed' | null {
  const status = session.completion?.status ?? null;
  if (session.realized) return status === 'adjusted' ? 'adjusted' : 'done';
  if (status === 'done' || status === 'adjusted' || status === 'missed') return status;
  return null;
}

export type TodaySessionState = 'not_done' | 'done_as_planned' | 'done_adjusted' | 'missed' | 'rest_day';

export interface TodaySessionResult {
  session: HomeSessionLite | null;
  state: TodaySessionState;
  nextSession: HomeSessionLite | null;
}

/**
 * Acha a sessão de HOJE (por isoDate, comparação de string — sempre 'YYYY-MM-DD' vindo da API,
 * nunca Date local) e classifica o estado real dela. `todayIso` é injetado (nunca `new Date()`
 * direto aqui) pra a função ser determinística em teste — a chamada real usa
 * saoPauloDateString(new Date()) de src/weekWindow.ts, já testado e em uso no resto do app.
 */
export function pickTodaySession(sessions: HomeSessionLite[], todayIso: string): TodaySessionResult {
  const today = sessions.find((s) => s.isoDate === todayIso) ?? null;
  const future = sessions.filter((s) => s.isoDate > todayIso).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  const nextSession = future[0] ?? null;

  if (!today) return { session: null, state: 'rest_day', nextSession };

  const status = sessionExecutionState(today);
  let state: TodaySessionState;
  if (status === 'done') state = 'done_as_planned';
  else if (status === 'adjusted') state = 'done_adjusted';
  else if (status === 'missed') state = 'missed';
  else state = 'not_done';

  return { session: today, state, nextSession };
}

/** Alvo ao tocar a bolinha: o treino/atividade daquele dia (nunca o calendario completo). */
export type WeekCellTarget = { kind: 'session' | 'alternative'; id: string } | null;

export interface WeekDayCell {
  isoDate: string;
  weekdayLetter: string;
  state: 'done' | 'today_pending' | 'future' | 'missed' | 'adjusted' | 'extra' | 'rest';
  // Sessoes + atividades alternativas no dia — >1 mostra indicador de multiplas sessoes.
  count: number;
  target: WeekCellTarget;
}

const WEEKDAY_LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']; // Dom..Sab, getUTCDay() index

function isExtraSession(structure: unknown): boolean {
  const obj = typeof structure === 'object' && structure !== null ? (structure as Record<string, unknown>) : {};
  return obj.type === 'extra' && (obj.source === 'student' || obj.source === 'device');
}

/**
 * Constroi os 7 dias da semana canonica (isoDates fornecidos, sempre segunda->domingo, ja
 * calculados pelo backend) com o estado visual de cada um. Nunca depende so de cor (ver secao 9.1
 * da ordem) — o state aqui mapeia pra forma+icone no componente, nao so tonalidade.
 *
 * Execucao objetiva (sessao com realized) conta como realizada sem exigir feedback — mesma regra
 * que alimenta os agregados da semana. Atividade alternativa marca o dia como 'extra' (realizado),
 * mas nunca cumpre uma sessao prescrita: dia com prescricao nao realizada continua refletindo ela.
 */
export function buildWeekDayCells(
  weekIsoDates: string[],
  sessions: HomeSessionLite[],
  todayIso: string,
  alternatives: HomeAlternativeLite[] = [],
): WeekDayCell[] {
  const byDate = new Map<string, HomeSessionLite[]>();
  for (const s of sessions) {
    const list = byDate.get(s.isoDate) ?? [];
    list.push(s);
    byDate.set(s.isoDate, list);
  }
  const altByDate = new Map<string, HomeAlternativeLite[]>();
  for (const a of alternatives) {
    const list = altByDate.get(a.isoDate) ?? [];
    list.push(a);
    altByDate.set(a.isoDate, list);
  }

  return weekIsoDates.map((isoDate) => {
    const daySessions = byDate.get(isoDate) ?? [];
    const dayAlternatives = altByDate.get(isoDate) ?? [];
    const weekday = new Date(isoDate + 'T12:00:00Z').getUTCDay();
    const weekdayLetter = WEEKDAY_LETTERS[weekday];
    const count = daySessions.length + dayAlternatives.length;
    const firstAlt = dayAlternatives[0] ?? null;
    const altTarget: WeekCellTarget = firstAlt?.activityLogId ? { kind: 'alternative', id: firstAlt.activityLogId } : null;

    if (daySessions.length === 0) {
      if (dayAlternatives.length > 0) return { isoDate, weekdayLetter, state: 'extra', count, target: altTarget };
      return { isoDate, weekdayLetter, state: isoDate > todayIso ? 'future' : 'rest', count, target: null };
    }

    const hasExtra = daySessions.some((s) => isExtraSession(s.structure)) || dayAlternatives.length > 0;
    const real = daySessions.filter((s) => !isExtraSession(s.structure));
    const primary = real[0] ?? daySessions[0];
    const status = sessionExecutionState(primary);
    const target: WeekCellTarget = { kind: 'session', id: primary.id };

    let state: WeekDayCell['state'];
    if (status === 'done') state = hasExtra ? 'extra' : 'done';
    else if (status === 'adjusted') state = 'adjusted';
    else if (status === 'missed') state = 'missed';
    else if (isoDate === todayIso) state = 'today_pending';
    else if (isoDate > todayIso) state = 'future';
    else state = 'rest'; // dia passado sem sessao prescrita nem execucao -> descanso, nunca "missed" inventado

    return { isoDate, weekdayLetter, state, count, target };
  });
}

export interface UnlockedMedalLite {
  code: string;
  category: string;
  name: string;
  description: string;
  grau: string;
  unit: string | null;
  unlockedAt: string; // ISO
  value: number | null;
}

export interface TrajectoryEvent {
  code: string;
  label: string;
  dateIso: string;
}

/**
 * Últimos N marcos reais da trajetória — vem inteiramente de `unlocked` (já ordenado por
 * unlockedAt desc pela API). Nunca inventa evento (ex: "começou no Panzeri Run") que não tenha
 * fonte real — ver seção 15 da ordem fechada.
 */
export function buildTrajectoryEvents(unlocked: UnlockedMedalLite[], limit = 5): TrajectoryEvent[] {
  return [...unlocked]
    .sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt))
    .slice(0, limit)
    .map((m) => ({ code: m.code, label: m.name, dateIso: m.unlockedAt }));
}

const CATEGORY_LABELS: Record<string, string> = {
  constancia: 'Constância',
  aderencia: 'Aderência',
  treinos_concluidos: 'Treinos',
  volume_semanal: 'Volume semanal',
  sustentacao_volume: 'Sustentação',
  volume_mensal: 'Volume mensal',
  distancia_unica: 'Distância',
  acumulado: 'Quilometragem',
  feedbacks: 'Feedbacks',
  checkins: 'Check-ins',
  reavaliacoes: 'Reavaliações',
  retomada: 'Retomada',
  provas: 'Provas',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Formata data curta 'DD mmm' a partir de um ISO ('YYYY-MM-DD' ou timestamp completo). */
export function formatShortDate(iso: string): string {
  const date = new Date(iso.length <= 10 ? iso + 'T12:00:00Z' : iso);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
}

/** Dias entre hoje (YYYY-MM-DD, Sao Paulo) e uma data futura (YYYY-MM-DD) — nunca negativo. */
export function daysUntil(targetIso: string, todayIso: string): number {
  const target = new Date(targetIso.slice(0, 10) + 'T00:00:00Z').getTime();
  const today = new Date(todayIso + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round((target - today) / 86400000));
}
