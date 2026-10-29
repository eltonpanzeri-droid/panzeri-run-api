import { BadGatewayException } from '@nestjs/common';
import { subscriptionValueMatches } from './coupon-rules';

// EXECUCAO do desconto no Asaas (30/10/2026), separada das regras do cupom. Contrato oficial (docs.asaas.com): POST /v3/subscriptions cria a assinatura com `value`; PUT /v3/subscriptions/{id}
// atualiza (updatePendingPayments aplica as mudancas as cobrancas pendentes). Como a pagina oficial do PUT nao lista `value` com clareza, NENHUM desconto e' dado como aplicado so' porque a
// chamada respondeu 200: o valor e' RELIDO da assinatura (GET /v3/subscriptions/{id}) e precisa ser exatamente o planejado. Se nao for, a assinatura nova e' cancelada (best effort), o
// resgate do cupom NAO e' registrado e o aluno recebe um erro claro, nunca um desconto que nao sera cobrado.
export type AsaasCall = <T>(path: string, init?: { method?: string; body?: string }) => Promise<T>;
interface SubscriptionView { id: string; value?: number }

const NOT_APPLIED = 'Não foi possível aplicar o desconto na sua assinatura agora. Nenhum desconto foi registrado. Tente novamente em instantes ou fale com o suporte.';

async function readValue(asaas: AsaasCall, id: string): Promise<unknown> {
  const fresh = await asaas<SubscriptionView>(`/subscriptions/${id}`);
  return fresh?.value;
}

export async function ensureExistingSubscriptionValue(asaas: AsaasCall, subscription: SubscriptionView, expected: number): Promise<void> {
  if (subscriptionValueMatches(subscription.value, expected)) return;
  try {
    await asaas(`/subscriptions/${subscription.id}`, { method: 'PUT', body: JSON.stringify({ value: expected, updatePendingPayments: true }) });
    if (subscriptionValueMatches(await readValue(asaas, subscription.id), expected)) return;
  } catch {
    // cai no erro unico abaixo
  }
  throw new BadGatewayException(NOT_APPLIED);
}

export async function verifyCreatedSubscriptionValue(asaas: AsaasCall, created: SubscriptionView, expected: number): Promise<void> {
  if (subscriptionValueMatches(created.value, expected)) return;
  let confirmed = false;
  try {
    confirmed = subscriptionValueMatches(await readValue(asaas, created.id), expected);
  } catch {
    confirmed = false;
  }
  if (confirmed) return;
  try {
    await asaas(`/subscriptions/${created.id}`, { method: 'DELETE' });
  } catch {
    // best effort: a assinatura nao foi vinculada ao aluno nem cobrada ate' aqui
  }
  throw new BadGatewayException(NOT_APPLIED);
}
