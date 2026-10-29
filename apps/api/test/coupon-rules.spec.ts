import { BadGatewayException } from '@nestjs/common';
import { CouponDefinition, evaluateCoupon, priceLabelFromCharge, subscriptionValueMatches, validateDefinition } from '../src/billing/coupon-rules';
import { ensureExistingSubscriptionValue, verifyCreatedSubscriptionValue, AsaasCall } from '../src/billing/coupon-charge';

// Cupons flexiveis (30/10/2026): condicoes vem do cadastro; cobranca so' executa o que e' suportado e confirma o valor no provedor. Chamadas ao Asaas SIMULADAS (nenhuma cobranca real).

const NOW = new Date('2026-10-30T12:00:00Z');
const coupon = (over: Partial<CouponDefinition> = {}): CouponDefinition => ({
  id: 'c1', code: 'TESTE', active: true, discountType: 'percent', discountPercent: 50, discountAmountCents: null, durationMonths: null, maxRedemptions: null, validFrom: null, validUntil: null, ...over,
});
const ctx = (over: Record<string, unknown> = {}) => ({ baseValue: 19.9, now: NOW, countedRedemptions: 0, ...over });

describe('condicoes do cupom', () => {
  it('percentual: valor cobrado = o cadastrado; rotulo mostra desconto e valor final', () => {
    const decision = evaluateCoupon(coupon(), ctx());
    expect(decision).toMatchObject({ ok: true, plan: { kind: 'discount', chargeValue: 9.95, discountLabel: '50% de desconto' } });
    expect(priceLabelFromCharge(19.9, 9.95, '50% de desconto')).toBe('R$ 9,95 por mês (50% de desconto, de R$ 19,90)');
  });

  it('valor fixo: abate o valor cadastrado de cada mensalidade', () => {
    const decision = evaluateCoupon(coupon({ discountType: 'fixed', discountPercent: 0, discountAmountCents: 500 }), ctx());
    expect(decision).toMatchObject({ ok: true, plan: { kind: 'discount', chargeValue: 14.9, discountLabel: 'R$ 5,00 de desconto' } });
  });

  it('desconto que zera a mensalidade (100% ou valor fixo igual ou maior) e acesso liberado, sem cobranca', () => {
    expect(evaluateCoupon(coupon({ discountPercent: 100 }), ctx())).toMatchObject({ ok: true, plan: { kind: 'free_access' } });
    expect(evaluateCoupon(coupon({ discountType: 'fixed', discountAmountCents: 1990 }), ctx())).toMatchObject({ ok: true, plan: { kind: 'free_access' } });
    expect(evaluateCoupon(coupon({ discountType: 'fixed', discountAmountCents: 5000 }), ctx())).toMatchObject({ ok: true, plan: { kind: 'free_access' } });
  });

  it('abaixo do minimo do cartao e recusado; nada e inventado para contornar', () => {
    expect(evaluateCoupon(coupon({ discountPercent: 80 }), ctx())).toMatchObject({ ok: false, code: 'below_minimum' });
    expect(evaluateCoupon(coupon({ discountType: 'fixed', discountAmountCents: 1600 }), ctx())).toMatchObject({ ok: false, code: 'below_minimum' });
  });

  it('desconto limitado a N mensalidades nao e simulado: recusado com a incompatibilidade explicada, tanto no uso quanto no cadastro', () => {
    const limited = coupon({ durationMonths: 3 });
    const decision = evaluateCoupon(limited, ctx());
    expect(decision).toMatchObject({ ok: false, code: 'unsupported' });
    expect((decision as { message: string }).message).toContain('3 primeiras mensalidades');
    expect(validateDefinition(limited)).toContain('ainda não é suportado');
    expect(validateDefinition(coupon({ durationMonths: null }))).toBeNull();
  });

  it('validade, limite de usos e cupom inativo so valem quando cadastrados; sem cadastro nao ha limite', () => {
    expect(evaluateCoupon(coupon({ active: false }), ctx())).toMatchObject({ ok: false, code: 'inactive' });
    expect(evaluateCoupon(coupon({ validFrom: new Date('2026-11-01T00:00:00Z') }), ctx())).toMatchObject({ ok: false, code: 'not_started' });
    expect(evaluateCoupon(coupon({ validUntil: new Date('2026-10-29T23:59:59Z') }), ctx())).toMatchObject({ ok: false, code: 'expired' });
    expect(evaluateCoupon(coupon({ maxRedemptions: 2 }), ctx({ countedRedemptions: 2 }))).toMatchObject({ ok: false, code: 'exhausted' });
    expect(evaluateCoupon(coupon({ maxRedemptions: 2 }), ctx({ countedRedemptions: 1 })).ok).toBe(true);
    expect(evaluateCoupon(coupon(), ctx({ countedRedemptions: 100000 })).ok).toBe(true);
  });

  it('cadastro invalido e recusado (tipo, percentual, valor, duracao, limite, datas)', () => {
    const base = { discountType: 'percent', discountPercent: 50, discountAmountCents: null, durationMonths: null, maxRedemptions: null, validFrom: null, validUntil: null };
    expect(validateDefinition({ ...base, discountType: 'sorteio' })).toContain('Tipo de desconto');
    expect(validateDefinition({ ...base, discountPercent: 0 })).toContain('percentual');
    expect(validateDefinition({ ...base, discountPercent: 101 })).toContain('percentual');
    expect(validateDefinition({ ...base, discountType: 'fixed', discountAmountCents: 0 })).toContain('valor fixo');
    expect(validateDefinition({ ...base, maxRedemptions: 0 })).toContain('limite de usos');
    expect(validateDefinition({ ...base, validFrom: new Date('2026-11-02'), validUntil: new Date('2026-11-01') })).toContain('validade');
  });

  it('comparacao de valores do provedor e exata em centavos', () => {
    expect(subscriptionValueMatches(9.95, 9.95)).toBe(true);
    expect(subscriptionValueMatches(19.9, 9.95)).toBe(false);
    expect(subscriptionValueMatches(undefined, 9.95)).toBe(false);
    expect(subscriptionValueMatches('9.95', 9.95)).toBe(false);
  });
});

describe('execucao no Asaas: so e aplicado se o valor relido for o planejado', () => {
  const calls: Array<{ path: string; method: string }> = [];
  const fake = (values: { putValue?: number; getValue?: number; putFails?: boolean }): AsaasCall => (async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ path, method });
    if (method === 'PUT') { if (values.putFails) throw new Error('recusado'); return {}; }
    if (method === 'DELETE') return {};
    return { id: 'sub', value: values.getValue };
  }) as AsaasCall;
  beforeEach(() => { calls.length = 0; });

  it('assinatura existente ja com o valor certo: nada a atualizar', async () => {
    await ensureExistingSubscriptionValue(fake({}), { id: 'sub', value: 9.95 }, 9.95);
    expect(calls).toEqual([]);
  });

  it('assinatura existente com valor diferente: atualiza e confirma relendo; se o Asaas ignorar o valor, falha sem desconto', async () => {
    await ensureExistingSubscriptionValue(fake({ getValue: 9.95 }), { id: 'sub', value: 19.9 }, 9.95);
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'GET']);
    await expect(ensureExistingSubscriptionValue(fake({ getValue: 19.9 }), { id: 'sub', value: 19.9 }, 9.95)).rejects.toBeInstanceOf(BadGatewayException);
    await expect(ensureExistingSubscriptionValue(fake({ putFails: true }), { id: 'sub', value: 19.9 }, 9.95)).rejects.toThrow('Nenhum desconto foi registrado');
  });

  it('assinatura nova: valor conferido na resposta; se diferir e a releitura tambem, cancela a assinatura e falha', async () => {
    await verifyCreatedSubscriptionValue(fake({}), { id: 'sub', value: 9.95 }, 9.95);
    expect(calls).toEqual([]);
    await expect(verifyCreatedSubscriptionValue(fake({ getValue: 19.9 }), { id: 'sub', value: 19.9 }, 9.95)).rejects.toBeInstanceOf(BadGatewayException);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE']);
    calls.length = 0;
    await verifyCreatedSubscriptionValue(fake({ getValue: 9.95 }), { id: 'sub' }, 9.95); // resposta sem valor, releitura confirma
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });
});
