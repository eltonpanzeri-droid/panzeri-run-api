// Logica pura da sincronizacao Apple Saude (28/10/2026): classificacao de erros, compactacao e montagem de lotes de percurso por BYTES, e mensagens por resultado. Sem React nem modulo nativo,
// para ser testavel. O servidor continua sendo a autoridade (limites, consentimento, idempotencia); aqui o app so' respeita o que ele informa.

export type RoutePoint = [number, number, number, number | null];
export type RouteBatchItem = { recordId: string; points: RoutePoint[] };

export type SyncOutcome = 'completed' | 'partial' | 'communication_failure' | 'server_failure' | 'native_failure' | 'no_activities' | 'not_authorized';

// Erro HTTP com o status; falha de rede (fetch rejeitado) nao tem status.
export class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

// Falha de leitura NATIVA (HealthKit) marcada pelo chamador: nunca se confunde com rede/servidor.
export class NativeReadError extends Error {}

export function classifyFailure(error: unknown): Exclude<SyncOutcome, 'completed' | 'partial' | 'no_activities'> {
  if (error instanceof NativeReadError) return 'native_failure';
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) return 'not_authorized';
    return error.status >= 500 ? 'server_failure' : 'communication_failure';
  }
  return 'communication_failure';
}

// Coordenadas com 5 casas (~1 m) e altitude com 1 casa: o suficiente para o desenho do percurso e bem menor no JSON.
export function compactPoints(points: RoutePoint[]): RoutePoint[] {
  return points.map(([offset, lat, lng, alt]) => [Math.round(offset), Number(lat.toFixed(5)), Number(lng.toFixed(5)), alt === null || alt === undefined ? null : Number(alt.toFixed(1))]);
}

export const bodySize = (routes: RouteBatchItem[]) => JSON.stringify({ routes }).length;

// Reduz uma rota ate o corpo da requisicao (com UMA rota) caber no orcamento: tira pontos alternados, sempre preservando o primeiro e o ultimo. null = nao coube nem com o minimo de pontos.
export function fitRoute(item: RouteBatchItem, maxBytes: number, maxPoints: number, minPoints = 40): RouteBatchItem | null {
  let points = compactPoints(item.points);
  while (points.length > maxPoints) points = thin(points);
  while (bodySize([{ recordId: item.recordId, points }]) > maxBytes) {
    if (points.length <= minPoints) return null;
    points = thin(points);
  }
  return points.length >= 2 ? { recordId: item.recordId, points } : null;
}

function thin(points: RoutePoint[]): RoutePoint[] {
  const kept = points.filter((_, index) => index % 2 === 0);
  const last = points[points.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

// Agrupa em lotes que respeitam, ao mesmo tempo, o maximo de rotas e o orcamento de bytes por requisicao.
export function packRouteBatches(items: RouteBatchItem[], limits: { maxRoutesPerRequest: number; maxRequestBytes: number }): RouteBatchItem[][] {
  const batches: RouteBatchItem[][] = [];
  let current: RouteBatchItem[] = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (current.length > 0 && (candidate.length > limits.maxRoutesPerRequest || bodySize(candidate) > limits.maxRequestBytes)) {
      batches.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export interface SyncCounters {
  created: number; enriched: number; already: number; rejected: number;
  routesStored: number; routesFailed: number; routesTooLarge: number;
  workoutsNotSent: number;
  // Saude do dia a dia (29/10/2026)
  healthStored: number; healthRejected: number; healthNotSent: number; healthUnreadable: number; windowsPending: number; workoutsMaybeTruncated: number; routesDeferred: number;
}

export const emptyCounters = (): SyncCounters => ({ created: 0, enriched: 0, already: 0, rejected: 0, routesStored: 0, routesFailed: 0, routesTooLarge: 0, workoutsNotSent: 0, healthStored: 0, healthRejected: 0, healthNotSent: 0, healthUnreadable: 0, windowsPending: 0, workoutsMaybeTruncated: 0, routesDeferred: 0 });

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function summarize(counters: SyncCounters): string {
  const parts = [
    counters.created > 0 ? plural(counters.created, 'treino novo importado', 'treinos novos importados') : null,
    counters.enriched > 0 ? `${plural(counters.enriched, 'treino atualizado', 'treinos atualizados')} com mais dados` : null,
    counters.already > 0 ? `${plural(counters.already, 'já estava', 'já estavam')} no Panzeri Run` : null,
    counters.routesStored > 0 ? plural(counters.routesStored, 'percurso guardado', 'percursos guardados') : null,
    counters.healthStored > 0 ? plural(counters.healthStored, 'registro de saúde guardado', 'registros de saúde guardados') : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Nada novo para importar';
}

export function pendingNotes(counters: SyncCounters): string[] {
  const notes: string[] = [];
  if (counters.workoutsNotSent > 0) notes.push(`${plural(counters.workoutsNotSent, 'treino não foi enviado', 'treinos não foram enviados')}.`);
  if (counters.rejected > 0) notes.push(`${plural(counters.rejected, 'treino foi recusado pelo servidor', 'treinos foram recusados pelo servidor')}.`);
  if (counters.routesFailed > 0) notes.push(`${plural(counters.routesFailed, 'percurso não foi enviado', 'percursos não foram enviados')}.`);
  if (counters.routesTooLarge > 0) notes.push(`${plural(counters.routesTooLarge, 'percurso é grande demais para enviar', 'percursos são grandes demais para enviar')}.`);
  if (counters.healthNotSent > 0) notes.push(`${plural(counters.healthNotSent, 'registro de saúde não foi enviado', 'registros de saúde não foram enviados')}.`);
  if (counters.healthRejected > 0) notes.push(`${plural(counters.healthRejected, 'registro de saúde foi recusado pelo servidor', 'registros de saúde foram recusados pelo servidor')}.`);
  if (counters.healthUnreadable > 0) notes.push(`${plural(counters.healthUnreadable, 'tipo de dado do app Saúde não pôde ser lido neste iPhone', 'tipos de dado do app Saúde não puderam ser lidos neste iPhone')}.`);
  if (counters.workoutsMaybeTruncated > 0) notes.push('Há períodos com muitos treinos: toque de novo para trazer o restante.');
  if (counters.routesDeferred > 0) notes.push(`${plural(counters.routesDeferred, 'percurso ficou para a próxima sincronização', 'percursos ficaram para a próxima sincronização')}.`);
  if (counters.windowsPending > 0) notes.push(`${plural(counters.windowsPending, 'período do histórico ainda falta', 'períodos do histórico ainda faltam')}.`);
  return notes;
}

export function messageFor(outcome: SyncOutcome, counters: SyncCounters): { text: string; ok: boolean } {
  switch (outcome) {
    case 'completed':
      return { ok: true, text: `Sincronização concluída. ${summarize(counters)}.${counters.healthUnreadable > 0 ? ` ${plural(counters.healthUnreadable, 'tipo de dado do app Saúde não existe ou não pôde ser lido neste iPhone', 'tipos de dado do app Saúde não existem ou não puderam ser lidos neste iPhone')}.` : ''}` };
    case 'partial':
      return { ok: false, text: `Sincronização parcial. ${summarize(counters)}. Pendente: ${pendingNotes(counters).join(' ')} Toque de novo para repetir só o que falta: o que já foi importado não é duplicado.` };
    case 'no_activities':
      return { ok: false, text: 'Não encontramos treinos nem dados de saúde para importar. Pode ser que não haja dados no app Saúde ou que o acesso não tenha sido permitido; o iPhone não informa qual dos dois. Você pode conferir em Ajustes > Saúde > Acesso a Dados e Dispositivos > Panzeri Run.' };
    case 'native_failure':
      return { ok: false, text: 'Não foi possível ler o app Saúde agora. Feche e abra o Panzeri Run e tente de novo.' };
    case 'not_authorized':
      return { ok: false, text: 'O Panzeri Run não tem autorização registrada para importar estes dados. Revise suas autorizações acima e tente de novo.' };
    case 'server_failure':
      return { ok: false, text: `O servidor do Panzeri Run teve um problema agora. ${counters.created + counters.enriched + counters.already > 0 ? `${summarize(counters)}. ` : ''}Tente novamente em alguns minutos.` };
    case 'communication_failure':
      return { ok: false, text: `Falha de comunicação com o servidor. Confira sua conexão. ${counters.created + counters.enriched + counters.already > 0 ? `${summarize(counters)}. ` : ''}Tente novamente.` };
  }
}

// ── Historico e sincronizacao incremental (29/10/2026) ──────────────────────────────────────────────────────
// Janelas de datas (dia local inteiro), da mais RECENTE para a mais antiga, com os grupos autorizados que ainda precisam delas.
//  - A janela mais recente vai de max(ultimos `recentDays` dias, 2 dias antes da ultima sincronizacao concluida) ate amanha: o Watch pode entregar dado atrasado e o servidor e' idempotente. Se a
//    aluna ficou semanas sem sincronizar, essa janela cresce ate' cobrir o intervalo — nunca fica buraco entre uma sincronizacao e outra.
//  - As anteriores (historico, `windowDays` por janela, ate' `horizonDays` atras) so' entram para o grupo que ainda nao as cobriu (`coverage.from`, guardado no aparelho).
// A cobertura so' avanca DEPOIS de a janela ser enviada por inteiro (markCovered), entao uma falha no meio nunca marca como coberto o que nao foi.
export const HISTORY_HORIZON_DAYS = 1095;
export const WINDOW_DAYS = 60;
export const RECENT_DAYS = 14;

export type Coverage = { from: Record<string, string>; through?: string };
export type SyncWindow = { start: Date; end: Date; groups: string[] };

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const midnightPlus = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const fromDayKey = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

export function planSyncWindows(now: Date, granted: ReadonlySet<string>, coverage: Coverage, options: { horizonDays?: number; windowDays?: number; recentDays?: number } = {}): SyncWindow[] {
  const horizonDays = options.horizonDays ?? HISTORY_HORIZON_DAYS;
  const windowDays = options.windowDays ?? WINDOW_DAYS;
  const recentDays = options.recentDays ?? RECENT_DAYS;
  const horizon = midnightPlus(now, -horizonDays);
  const tomorrow = midnightPlus(now, 1);
  let firstStart = midnightPlus(now, -recentDays);
  if (coverage.through) {
    const sinceLast = midnightPlus(fromDayKey(coverage.through), -2);
    if (sinceLast < firstStart) firstStart = sinceLast;
  }
  if (firstStart < horizon) firstStart = horizon;
  const windows: SyncWindow[] = [];
  const all = [...granted].sort();
  if (all.length > 0) windows.push({ start: firstStart, end: tomorrow, groups: all });
  let end = firstStart;
  while (end > horizon) {
    const start = midnightPlus(end, -windowDays) < horizon ? horizon : midnightPlus(end, -windowDays);
    const startKey = dayKey(start);
    const groups = all.filter((group) => coverage.from[group] === undefined || startKey < coverage.from[group]);
    if (groups.length > 0) windows.push({ start, end, groups });
    end = start;
  }
  return windows;
}

export function markCovered(coverage: Coverage, window: SyncWindow): Coverage {
  const from = { ...coverage.from };
  const startKey = dayKey(window.start);
  for (const group of window.groups) if (from[group] === undefined || startKey < from[group]) from[group] = startKey;
  return { ...coverage, from };
}

// Sincronizacao inteira concluida (todas as janelas planejadas enviadas): a proxima comeca a partir de hoje.
export const markThrough = (coverage: Coverage, now: Date): Coverage => ({ ...coverage, through: dayKey(now) });

// Grupo retirado no servidor: os dados dele foram apagados, entao a cobertura local tambem some (se for autorizado de novo, o historico e' lido outra vez).
export function dropRevoked(coverage: Coverage, granted: ReadonlySet<string>): Coverage {
  return { ...coverage, from: Object.fromEntries(Object.entries(coverage.from).filter(([group]) => granted.has(group))) };
}

export function parseCoverage(raw: string | null): Coverage {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { from: {} };
    const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const from = parsed.from && typeof parsed.from === 'object' ? Object.fromEntries(Object.entries(parsed.from).filter(([, v]) => isDay(v))) as Record<string, string> : {};
    return { from, ...(isDay(parsed.through) ? { through: parsed.through } : {}) };
  } catch {
    return { from: {} };
  }
}

// Lotes de registros de saude: ate `maxRecords` registros e `maxBytes` de corpo (o limite global de ~100 KB da API nao foi aumentado).
export const bodySizeOfRecords = (records: unknown[]) => JSON.stringify({ records }).length;
export function packRecords<T>(records: T[], limits: { maxRecords: number; maxBytes: number } = { maxRecords: 100, maxBytes: 80_000 }): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  for (const record of records) {
    const candidate = [...current, record];
    if (current.length > 0 && (candidate.length > limits.maxRecords || bodySizeOfRecords(candidate) > limits.maxBytes)) {
      batches.push(current);
      current = [record];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
