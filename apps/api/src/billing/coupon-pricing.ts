// Preco da assinatura com cupom de desconto parcial (29/10/2026). O desconto e' REAL: o valor da assinatura criada no Asaas e' o valor com desconto, entao e' isso que o cartao cobra em toda
// mensalidade (decisao: o desconto vale para todas as mensalidades da assinatura nova, nao so' para a primeira). Cupom de 100% e' acesso liberado (fluxo proprio, sem cobranca).
// Nenhum desconto e' mostrado ou confirmado quando nao puder ser cobrado: abaixo do minimo do cartao no Asaas o cupom parcial e' recusado.
export const ASAAS_CARD_MIN_VALUE = 5;

export function discountedPrice(basePrice: number, discountPercent: number): number {
  return Math.round(basePrice * (100 - discountPercent)) / 100;
}

export const formatBRL = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`;

// null = cupom parcial valido para este preco; texto = motivo da recusa
export function partialCouponProblem(basePrice: number, discountPercent: number): string | null {
  if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 99) return 'Desconto invalido.';
  if (discountedPrice(basePrice, discountPercent) < ASAAS_CARD_MIN_VALUE) return 'Este cupom deixaria a mensalidade abaixo do valor minimo aceito no cartao. Fale com o suporte.';
  return null;
}

export function priceLabelWithDiscount(basePrice: number, discountPercent: number | null): string {
  if (!discountPercent) return `${formatBRL(basePrice)} por mes`;
  return `${formatBRL(discountedPrice(basePrice, discountPercent))} por mes (${discountPercent}% de desconto, de ${formatBRL(basePrice)})`;
}
