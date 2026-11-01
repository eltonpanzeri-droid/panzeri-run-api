import { AsyncLocalStorage } from 'async_hooks';

// Filtro CENTRAL de atividades excluidas (01/11/2026). Uma atividade 'ignored'/'deleted' (ActivityLog.exclusionMode) some de TODA leitura de ActivityLog sem que cada
// leitor precise lembrar: o PrismaService instala este filtro em find*/count/aggregate/groupBy do model ActivityLog (inclusive dentro de transacoes interativas).
// Arquivo FOLHA (sem dependencia de servicos).
//
// O que o filtro NAO cobre — e por que e' seguro:
//   - leitura por RELACAO (ex.: SessionExecutionLink -> activityLog): toda leitura assim passa por vinculo ATIVO, e a regra do sistema e' que atividade excluida NUNCA
//     tem vinculo ativo ou candidato (a exclusao os revoga na mesma transacao e a leitura por id/janela, filtrada, impede novos vinculos);
//   - escritas (create/update/upsert/delete): as ingestoes consultam `isActivityExcluded` ANTES de gravar (nao deixam o relogio trazer de volta o que foi excluido).
// Telas de gestao (listar para desfazer, o proprio ato de excluir/restaurar) e as ingestoes enxergam tudo dentro de `includeExcludedActivities`.

const storage = new AsyncLocalStorage<true>();

// ATENCAO: o Prisma so' executa a consulta quando ela e' AGUARDADA (PrismaPromise preguicosa). Por isso o `await` precisa acontecer DENTRO do contexto: se a funcao devolvesse a
// promessa ainda nao executada, a consulta rodaria fora do contexto e o filtro central esconderia as excluidas mesmo aqui (defeito achado no teste ponta a ponta de 01/11/2026).
export function includeExcludedActivities<T>(fn: () => PromiseLike<T>): Promise<T> {
  return storage.run(true, async () => {
    const result = await fn();
    return result;
  });
}

export function isIncludingExcludedActivities(): boolean {
  return storage.getStore() === true;
}

/**
 * Guarda das INGESTOES (todos os provedores): a atividade ja' foi excluida/ignorada pela aluna ou treinador? Se sim, a sincronizacao NAO regrava nada (nem payload bruto,
 * nem metricas, nem busca amostras na rede) — senao o relogio traria de volta o que foi excluido. Enxerga as excluidas (opt-out do filtro central).
 */
export async function isActivityExcluded(client: object, userId: string, provider: string, externalId: string): Promise<boolean> {
  const delegate = (client as { activityLog?: { findFirst?: (args: unknown) => Promise<{ exclusionMode: string | null } | null> } }).activityLog;
  // Cliente sem a consulta (so' acontece em dublês de teste parciais; em producao e' sempre o PrismaClient): nao ha como provar exclusao, segue o fluxo normal. Erro de banco NAO e' engolido.
  const findFirst = delegate?.findFirst;
  if (typeof findFirst !== 'function') return false;
  const row = await includeExcludedActivities(() => findFirst.call(delegate, { where: { userId, provider, externalId }, select: { exclusionMode: true } }));
  return row?.exclusionMode != null;
}

const FILTERED_ACTIONS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']);

interface MiddlewareParams { model?: string; action: string; args?: { where?: Record<string, unknown> } & Record<string, unknown> }

/** Funcao pura (testavel): devolve os params com o filtro aplicado, ou os mesmos params quando o filtro nao se aplica. */
export function applyActivityExclusionFilter(params: MiddlewareParams): MiddlewareParams {
  if (params.model !== 'ActivityLog' || !FILTERED_ACTIONS.has(params.action) || isIncludingExcludedActivities()) return params;
  const args = params.args ?? {};
  // Chave irma no mesmo nivel (nao AND): findUnique exige a chave unica no topo do where; nos demais o efeito e' o mesmo (AND implicito).
  return { ...params, args: { ...args, where: { ...(args.where ?? {}), exclusionMode: null } } };
}

/** Instala o filtro num PrismaClient (uso: PrismaService). */
export function installActivityExclusionFilter(client: { $use?: (middleware: (params: never, next: (params: never) => Promise<unknown>) => Promise<unknown>) => void }): void {
  if (typeof client.$use !== 'function') return;
  client.$use(async (params, next) => next(applyActivityExclusionFilter(params as MiddlewareParams) as never));
}
