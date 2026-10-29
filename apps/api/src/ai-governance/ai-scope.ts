import { AsyncLocalStorage } from 'async_hooks';
import type { Prisma } from '@prisma/client';

// Escopo de IA (Central Universal de Integracoes, Lote 1, 19/10/2026).
//
// Tudo que monta contexto para um agente de IA roda DENTRO de um escopo: `runWithAiScope(escopo, ...)`. O escopo diz, para aquele aluno e aquele destino, quais
// provedores NAO podem alimentar a IA. Os leitores de dados que alimentam prompts consultam o escopo (aiBlockedProviders / aiActivityWhere /
// isProviderBlockedForAi) e tratam os dados desses provedores como se nao existissem; fora de um escopo (telas, painel do treinador, calculos internos) nada
// muda. A protecao final (AiEgressGuard, dentro da fila unica de chamadas a Anthropic) exige que a chamada aconteca dentro de um escopo valido — chamada de
// IA com dado de dispositivo fora de escopo FALHA FECHADA.
//
// AsyncLocalStorage em vez de parametro: o contexto do Prescritor atravessa dezenas de servicos (Training Intelligence, analise de execucao, perfil...); passar um
// parametro por todos eles espalharia a regra e um leitor novo esqueceria dela. Aqui, qualquer leitor novo que use estes helpers fica coberto automaticamente.
// Este arquivo e' uma folha (sem dependencia de servicos) para poder ser importado de qualquer modulo sem criar ciclos.

export type AiDestination = 'internal_ai' | 'external_ai';

export interface AiScope {
  readonly userId: string;
  readonly destination: AiDestination;
  // Provedores cujos dados NAO podem entrar nesta chamada de IA para este aluno.
  readonly blocked: readonly string[];
  // Dados de SAUDE e RECUPERACAO (sono, HRV, diario, FC de repouso) sao autorizados por categoria: aqui ficam os pares "provedor:categoria" que NAO podem alimentar a IA
  // (categoria nao autorizada, finalidade do Atlas nao concedida, provedor nao liberado...). Ausente = escopo montado antes deste campo: tratado como TUDO bloqueado (fail-closed).
  readonly blockedHealth?: readonly string[];
  readonly computedAt: number;
}

const storage = new AsyncLocalStorage<AiScope>();

export function runWithAiScope<T>(scope: AiScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function currentAiScope(): AiScope | undefined {
  return storage.getStore();
}

export function aiBlockedProviders(): readonly string[] {
  return storage.getStore()?.blocked ?? [];
}

export function isProviderBlockedForAi(provider: string | null | undefined): boolean {
  if (!provider) return false;
  return aiBlockedProviders().includes(provider);
}

// Dado de saude de um provedor numa categoria pode entrar na IA? Fora de escopo (telas, painel) nada muda. Dentro de escopo: bloqueado se o provedor inteiro esta bloqueado, se o par
// provedor:categoria esta bloqueado ou se o escopo nao avaliou saude (fail-closed).
// Ha escopo de IA ativo? Consultas que alimentam a IA sem escopo devem falhar fechado (nada sai).
export function hasAiScope(): boolean {
  return storage.getStore() !== undefined;
}

export function isHealthBlockedForAi(provider: string, category: string): boolean {
  const scope = storage.getStore();
  if (!scope) return false;
  if (scope.blocked.includes(provider)) return true;
  if (scope.blockedHealth === undefined) return true;
  return scope.blockedHealth.includes(`${provider}:${category}`);
}

// Fragmento de filtro para consultas a ActivityLog. Vazio fora de escopo (ou sem provedor bloqueado): a consulta fica identica a de antes.
export function aiActivityWhere(): Prisma.ActivityLogWhereInput {
  const blocked = aiBlockedProviders();
  return blocked.length > 0 ? { provider: { notIn: [...blocked] } } : {};
}
