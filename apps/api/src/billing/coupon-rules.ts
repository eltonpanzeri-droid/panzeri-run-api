import { ASAAS_CARD_MIN_VALUE, formatBRL } from './coupon-pricing';

// Regras de cupom (30/10/2026). Separa DUAS coisas que nao devem se misturar:
//   1. a DEFINICAO das condicoes do cupom, cadastrada no painel (tipo de desconto, valor, limite de usos, validade, duracao);
//   2. a EXECUCAO da cobranca (Asaas), que so' recebe um plano de cobranca ja' validado por esta funcao.
// Nenhuma condicao comercial e' inventada aqui: o que o cupom nao define fica sem limite (usos, validade) e o que ele define e' respeitado. Condicao que o meio de pagamento ainda nao suporta
// (hoje: desconto limitado a algumas mensalidades) NAO e' simulada: o cupom e' recusado com a incompatibilidade explicada, e o cadastro de novas condicoes exige so' declarar o suporte em
// PAYMENT_CAPABILITIES e implementar a execucao correspondente.

export interface CouponDefinition {
  id: string;
  code: string;
  active: boolean;
  // 'percent' usa discountPercent (1 a 100); 'fixed' usa discountAmountCents (valor abatido de cada mensalidade)
  discountType: string;
  discountPercent: number;
  discountAmountCents: number | null;
  // numero de mensalidades com desconto; null = todas as mensalidades da assinatura
  durationMonths: number | null;
  maxRedemptions: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
}

// O que cada meio de pagamento executa de verdade. Asaas (cartao): valor constante em todas as mensalidades da assinatura; desconto que termina depois de N mensalidades exigiria devolver o
// valor cheio no meio da assinatura (nao implementado nem verificavel sem cobranca real).
export const PAYMENT_CAPABILITIES = {
  asaas: { constantDiscount: true, limitedDurationDiscount: false },
} as const;
export type PaymentChannel = keyof typeof PAYMENT_CAPABILITIES;

export type CouponPlan =
  | { kind: 'free_access' }
  | { kind: 'discount'; baseValue: number; chargeValue: number; discountLabel: string };

export type CouponRefusal = 'inactive' | 'not_started' | 'expired' | 'exhausted' | 'unsupported' | 'invalid' | 'below_minimum';
export type CouponDecision = { ok: true; plan: CouponPlan } | { ok: false; code: CouponRefusal; message: string };

const cents = (value: number) => Math.round(value * 100);

// Condicoes que o painel pode gravar: validadas na criacao/edicao (mesma funcao da cobranca, entao nao existe cupom cadastravel que a cobranca nao entenda).
export function validateDefinition(def: Pick<CouponDefinition, 'discountType' | 'discountPercent' | 'discountAmountCents' | 'durationMonths' | 'maxRedemptions' | 'validFrom' | 'validUntil'>, channel: PaymentChannel = 'asaas'): string | null {
  if (def.discountType !== 'percent' && def.discountType !== 'fixed') return 'Tipo de desconto desconhecido. Use percentual ou valor fixo.';
  if (def.discountType === 'percent' && (!Number.isInteger(def.discountPercent) || def.discountPercent < 1 || def.discountPercent > 100)) return 'O percentual de desconto precisa ser um número inteiro de 1 a 100.';
  if (def.discountType === 'fixed' && (!Number.isInteger(def.discountAmountCents) || (def.discountAmountCents ?? 0) < 1)) return 'O valor fixo de desconto precisa ser maior que zero (em centavos).';
  if (def.durationMonths !== null && (!Number.isInteger(def.durationMonths) || def.durationMonths < 1)) return 'A duração do desconto precisa ser de pelo menos 1 mensalidade.';
  if (def.durationMonths !== null && !PAYMENT_CAPABILITIES[channel].limitedDurationDiscount) {
    return `Desconto limitado às ${def.durationMonths} primeiras mensalidades ainda não é suportado pela cobrança por cartão. Deixe a duração em branco (todas as mensalidades) ou aguarde essa condição ser habilitada.`;
  }
  if (def.maxRedemptions !== null && (!Number.isInteger(def.maxRedemptions) || def.maxRedemptions < 1)) return 'O limite de usos precisa ser de pelo menos 1.';
  if (def.validFrom && def.validUntil && def.validUntil.getTime() < def.validFrom.getTime()) return 'A validade termina antes de começar.';
  return null;
}

export function evaluateCoupon(def: CouponDefinition, context: { baseValue: number; now: Date; countedRedemptions: number; channel?: PaymentChannel }): CouponDecision {
  const refuse = (code: CouponRefusal, message: string): CouponDecision => ({ ok: false, code, message });
  if (!def.active) return refuse('inactive', 'Este cupom está inativo.');
  if (def.validFrom && context.now.getTime() < def.validFrom.getTime()) return refuse('not_started', 'Este cupom ainda não está valendo.');
  if (def.validUntil && context.now.getTime() > def.validUntil.getTime()) return refuse('expired', 'Este cupom expirou.');
  if (def.maxRedemptions !== null && context.countedRedemptions >= def.maxRedemptions) return refuse('exhausted', 'Este cupom atingiu o limite de usos.');
  const problem = validateDefinition(def, context.channel ?? 'asaas');
  if (problem) return refuse(problem.includes('ainda não é suportado') ? 'unsupported' : 'invalid', problem);

  const base = context.baseValue;
  const discount = def.discountType === 'percent' ? Math.round(base * def.discountPercent) / 100 : (def.discountAmountCents ?? 0) / 100;
  const charge = Math.round((base - discount) * 100) / 100;
  // desconto que zera (ou passa de) a mensalidade e' acesso liberado, sem cobranca
  if (cents(charge) <= 0) return { ok: true, plan: { kind: 'free_access' } };
  if (charge < ASAAS_CARD_MIN_VALUE) return refuse('below_minimum', 'Este cupom deixaria a mensalidade abaixo do valor mínimo aceito no cartão. Fale com o suporte.');
  const label = def.discountType === 'percent' ? `${def.discountPercent}% de desconto` : `${formatBRL(discount)} de desconto`;
  return { ok: true, plan: { kind: 'discount', baseValue: base, chargeValue: charge, discountLabel: label } };
}

export function priceLabelFromCharge(baseValue: number, chargeValue: number, discountLabel?: string): string {
  if (chargeValue === baseValue || !discountLabel) return `${formatBRL(baseValue)} por mês`;
  return `${formatBRL(chargeValue)} por mês (${discountLabel}, de ${formatBRL(baseValue)})`;
}

// A assinatura no provedor so' vale como "desconto aplicado" se o valor que o provedor guardou for exatamente o valor planejado.
export function subscriptionValueMatches(providerValue: unknown, expected: number): boolean {
  return typeof providerValue === 'number' && Number.isFinite(providerValue) && cents(providerValue) === cents(expected);
}
