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
}

export const emptyCounters = (): SyncCounters => ({ created: 0, enriched: 0, already: 0, rejected: 0, routesStored: 0, routesFailed: 0, routesTooLarge: 0, workoutsNotSent: 0 });

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function summarize(counters: SyncCounters): string {
  const parts = [
    counters.created > 0 ? plural(counters.created, 'treino novo importado', 'treinos novos importados') : null,
    counters.enriched > 0 ? `${plural(counters.enriched, 'treino atualizado', 'treinos atualizados')} com mais dados` : null,
    counters.already > 0 ? `${plural(counters.already, 'já estava', 'já estavam')} no Panzeri Run` : null,
    counters.routesStored > 0 ? plural(counters.routesStored, 'percurso guardado', 'percursos guardados') : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Nada novo para importar';
}

export function pendingNotes(counters: SyncCounters): string[] {
  const notes: string[] = [];
  if (counters.workoutsNotSent > 0) notes.push(`${plural(counters.workoutsNotSent, 'treino não foi enviado', 'treinos não foram enviados')}.`);
  if (counters.rejected > 0) notes.push(`${plural(counters.rejected, 'treino foi recusado pelo servidor', 'treinos foram recusados pelo servidor')}.`);
  if (counters.routesFailed > 0) notes.push(`${plural(counters.routesFailed, 'percurso não foi enviado', 'percursos não foram enviados')}.`);
  if (counters.routesTooLarge > 0) notes.push(`${plural(counters.routesTooLarge, 'percurso é grande demais para enviar', 'percursos são grandes demais para enviar')}.`);
  return notes;
}

export function messageFor(outcome: SyncOutcome, counters: SyncCounters): { text: string; ok: boolean } {
  switch (outcome) {
    case 'completed':
      return { ok: true, text: `Sincronização concluída. ${summarize(counters)}.` };
    case 'partial':
      return { ok: false, text: `Sincronização parcial. ${summarize(counters)}. Pendente: ${pendingNotes(counters).join(' ')} Toque de novo para repetir só o que falta: o que já foi importado não é duplicado.` };
    case 'no_activities':
      return { ok: false, text: 'Não encontramos treinos de corrida para importar. Pode ser que não haja corridas no app Saúde ou que o acesso não tenha sido permitido; o iPhone não informa qual dos dois. Você pode conferir em Ajustes > Saúde > Acesso a Dados e Dispositivos > Panzeri Run.' };
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
