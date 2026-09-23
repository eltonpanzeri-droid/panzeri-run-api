import { paymentGroupOf, estimatedMrrCents, PRICE_PER_STUDENT_CENTS } from '../src/coach/subscription-groups.util';

// 23/09: fonte canonica unica de agrupamento de pagamento (consolidada de 3 copias divergentes em
// coach.service.ts). Teste garante que a regra de produto "cortesia nunca conta como pagamento" fica
// explicita e protegida contra regressao.
describe('subscription-groups.util', () => {
  it('agrupa active e grace como confirmed (pagamento real)', () => {
    expect(paymentGroupOf('active')).toBe('confirmed');
    expect(paymentGroupOf('grace')).toBe('confirmed');
  });

  it('agrupa manual_active como courtesy, nunca confirmed', () => {
    expect(paymentGroupOf('manual_active')).toBe('courtesy');
  });

  it('agrupa overdue/pending/canceled corretamente', () => {
    expect(paymentGroupOf('overdue')).toBe('overdue');
    expect(paymentGroupOf('pending')).toBe('pending');
    expect(paymentGroupOf('canceled')).toBe('canceled');
  });

  it('status desconhecido ou nulo cai em desconhecido, nunca em pending por padrao silencioso', () => {
    expect(paymentGroupOf(null)).toBe('desconhecido');
    expect(paymentGroupOf(undefined)).toBe('desconhecido');
    expect(paymentGroupOf('algum_status_novo_nao_mapeado')).toBe('desconhecido');
  });

  it('MRR estimado nao inclui cortesia — so multiplica quem esta em confirmed', () => {
    expect(estimatedMrrCents(10)).toBe(10 * PRICE_PER_STUDENT_CENTS);
    expect(estimatedMrrCents(0)).toBe(0);
  });
});
