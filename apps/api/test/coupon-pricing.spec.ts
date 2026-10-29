import { ASAAS_CARD_MIN_VALUE, discountedPrice, formatBRL, partialCouponProblem, priceLabelWithDiscount } from '../src/billing/coupon-pricing';

// Cupom parcial com efeito financeiro real (29/10/2026).
describe('preco com cupom parcial', () => {
  it('o valor cobrado e o valor com desconto, arredondado em centavos', () => {
    expect(discountedPrice(19.9, 50)).toBe(9.95);
    expect(discountedPrice(19.9, 10)).toBe(17.91);
    expect(discountedPrice(19.9, 25)).toBe(14.93);
  });

  it('mostra o desconto e o valor final antes de contratar', () => {
    expect(priceLabelWithDiscount(19.9, 50)).toBe('R$ 9,95 por mes (50% de desconto, de R$ 19,90)');
    expect(priceLabelWithDiscount(19.9, null)).toBe('R$ 19,90 por mes');
    expect(formatBRL(5)).toBe('R$ 5,00');
  });

  it('recusa desconto que deixaria a mensalidade abaixo do minimo do cartao ou fora de 1 a 99 (nunca confirma um desconto que nao pode ser cobrado)', () => {
    expect(partialCouponProblem(19.9, 50)).toBeNull();
    expect(partialCouponProblem(19.9, 74)).toBeNull();
    expect(discountedPrice(19.9, 75)).toBeLessThan(ASAAS_CARD_MIN_VALUE);
    expect(partialCouponProblem(19.9, 75)).toContain('valor minimo');
    expect(partialCouponProblem(19.9, 0)).toBe('Desconto invalido.');
    expect(partialCouponProblem(19.9, 100)).toBe('Desconto invalido.');
    expect(partialCouponProblem(19.9, 12.5)).toBe('Desconto invalido.');
  });
});
