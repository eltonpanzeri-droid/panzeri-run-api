import { BillingLogEvent, CommercialUserFacts, deriveCommercialState, providerFromRef } from '../src/leo/commercial-state';

const d = (s: string) => new Date(`${s}T12:00:00.000Z`);
const baseline = (at: string, status: string, hadAccess = false): BillingLogEvent => ({
  event: 'baseline_snapshot', at: d(at), prevStatus: null, nextStatus: status, ref: hadAccess ? 'baseline:had_access' : 'baseline:no_access',
});
const change = (at: string, prev: string, next: string): BillingLogEvent => ({
  event: 'status_changed', at: d(at), prevStatus: prev, nextStatus: next, ref: 'test',
});
const facts = (over: Partial<CommercialUserFacts> = {}): CommercialUserFacts => ({
  createdAt: d('2026-08-01'), currentStatus: 'active', statusUpdatedAt: d('2026-09-10'), firstPaidAt: null, hasStudentCode: true, ...over,
});
const LOG_START = d('2026-09-19');
const stateAt = (events: BillingLogEvent[], f: CommercialUserFacts, at: string) => deriveCommercialState(events, f, d(at), LOG_START);

describe('estado comercial temporal', () => {
  it('antes do cadastro a pessoa e prospect por definicao', () => {
    const r = stateAt([], facts({ createdAt: d('2026-09-05') }), '2026-09-01');
    expect(r).toEqual({ state: 'prospect', subscriptionStatus: null, basis: 'no_account_yet' });
  });

  it('exemplo do Joao: prospect em 01/09, assinou em 10/09 — o status ATUAL nao reescreve o passado', () => {
    // Cadastrado depois do inicio do log (19/09 simulado como 01/09 para o teste): sem baseline, nasce pending.
    const logStart = d('2026-08-30');
    const f = facts({ createdAt: d('2026-09-01'), currentStatus: 'active', statusUpdatedAt: d('2026-09-10'), hasStudentCode: true });
    const events = [change('2026-09-10', 'pending', 'active')];
    expect(deriveCommercialState(events, f, d('2026-09-01'), logStart).state).toBe('prospect');
    expect(deriveCommercialState(events, f, d('2026-09-09'), logStart).state).toBe('prospect');
    expect(deriveCommercialState(events, f, d('2026-09-10'), logStart).state).toBe('active');
    expect(deriveCommercialState(events, f, d('2026-09-19'), logStart)).toEqual({ state: 'active', subscriptionStatus: 'active', basis: 'transition_log' });
  });

  it('prospect -> assinante -> ex-assinante -> reativado dentro da mesma historia', () => {
    const events = [
      baseline('2026-09-19', 'pending', false),
      change('2026-09-20', 'pending', 'active'),
      change('2026-10-20', 'active', 'canceled'),
      change('2026-11-05', 'canceled', 'pending'), // abriu novo checkout: ainda ex-assinante
      change('2026-11-06', 'pending', 'active'),
    ];
    const f = facts({ createdAt: d('2026-08-01'), currentStatus: 'active' });
    expect(stateAt(events, f, '2026-09-19').state).toBe('prospect');
    expect(stateAt(events, f, '2026-09-25').state).toBe('active');
    expect(stateAt(events, f, '2026-10-25').state).toBe('ex_subscriber');
    expect(stateAt(events, f, '2026-11-05').state).toBe('ex_subscriber');
    expect(stateAt(events, f, '2026-11-06').state).toBe('reactivated');
    expect(stateAt(events, f, '2026-12-30').state).toBe('reactivated');
  });

  it('reativado que cancela de novo volta a ex-assinante', () => {
    const events = [
      baseline('2026-09-19', 'canceled', true),
      change('2026-10-01', 'canceled', 'active'),
      change('2026-11-01', 'active', 'canceled'),
    ];
    const f = facts({ currentStatus: 'canceled' });
    expect(stateAt(events, f, '2026-09-25').state).toBe('ex_subscriber');
    expect(stateAt(events, f, '2026-10-15').state).toBe('reactivated');
    expect(stateAt(events, f, '2026-11-15').state).toBe('ex_subscriber');
  });

  it('atraso nao e perda de relacao: active -> overdue -> active nao e reativacao', () => {
    const events = [
      baseline('2026-09-19', 'active', true),
      change('2026-10-01', 'active', 'overdue'),
      change('2026-10-03', 'overdue', 'pending'), // novo checkout de quem estava em atraso
      change('2026-10-05', 'pending', 'active'),
    ];
    const f = facts();
    const mid = stateAt(events, f, '2026-10-02');
    expect(mid.state).toBe('active');
    expect(mid.subscriptionStatus).toBe('overdue'); // o status bruto continua visivel
    expect(stateAt(events, f, '2026-10-04').state).toBe('active');
    expect(stateAt(events, f, '2026-10-06').state).toBe('active');
  });

  it('cancelado sem nunca ter tido acesso continua prospect (checkout cancelado nao vira ex-assinante)', () => {
    const events = [baseline('2026-09-19', 'pending', false), change('2026-09-22', 'pending', 'canceled')];
    const f = facts({ currentStatus: 'canceled', hasStudentCode: false });
    expect(stateAt(events, f, '2026-09-23').state).toBe('prospect');
  });

  it('pendente depois de ter sido assinante e ex-assinante (baseline had_access)', () => {
    const events = [baseline('2026-09-19', 'pending', true)];
    expect(stateAt(events, facts({ currentStatus: 'pending' }), '2026-09-20').state).toBe('ex_subscriber');
  });

  it('cortesia/manual_active conta como relacao ativa', () => {
    const events = [baseline('2026-09-19', 'pending', false), change('2026-09-21', 'pending', 'manual_active')];
    expect(stateAt(events, facts({ currentStatus: 'manual_active' }), '2026-09-22').state).toBe('active');
  });

  it('anterior ao log: usa o status atual so quando ele nao mudou desde antes de T', () => {
    const f = facts({ currentStatus: 'active', statusUpdatedAt: d('2026-08-10'), hasStudentCode: true });
    expect(stateAt([baseline('2026-09-19', 'active', true)], f, '2026-08-20')).toEqual({
      state: 'active', subscriptionStatus: 'active', basis: 'current_status_unchanged_since',
    });
  });

  it('anterior ao log e status mudou depois de T sem registro: unknown (nunca inventa)', () => {
    const f = facts({ currentStatus: 'active', statusUpdatedAt: d('2026-09-10') });
    expect(stateAt([baseline('2026-09-19', 'active', true)], f, '2026-09-01')).toEqual({
      state: 'unknown', subscriptionStatus: null, basis: 'insufficient_history',
    });
  });

  it('anterior ao log mas antes do primeiro pagamento confirmado: prospect (com base explicita)', () => {
    const f = facts({ currentStatus: 'active', statusUpdatedAt: d('2026-09-10'), firstPaidAt: d('2026-09-10') });
    expect(stateAt([baseline('2026-09-19', 'active', true)], f, '2026-09-05')).toEqual({
      state: 'prospect', subscriptionStatus: null, basis: 'first_paid_bound',
    });
  });

  it('eventos de outros tipos (payment_confirmed) nao alteram o estado', () => {
    const events: BillingLogEvent[] = [
      baseline('2026-09-19', 'pending', false),
      { event: 'payment_confirmed', at: d('2026-09-20'), prevStatus: null, nextStatus: 'active', ref: 'pay_1' },
    ];
    expect(stateAt(events, facts({ currentStatus: 'pending', hasStudentCode: false }), '2026-09-21').state).toBe('prospect');
  });
});

describe('origem do registro comercial', () => {
  it('deriva a origem do prefixo de externalRef', () => {
    expect(providerFromRef('asaas:webhook:PAYMENT_CONFIRMED:pay_1')).toBe('asaas');
    expect(providerFromRef('revenuecat:INITIAL_PURCHASE:123')).toBe('revenuecat');
    expect(providerFromRef('coupon:ABC')).toBe('coupon');
    expect(providerFromRef('pay_998877')).toBe('asaas');
    expect(providerFromRef(null)).toBeNull();
  });
});
