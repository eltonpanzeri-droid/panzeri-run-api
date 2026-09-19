import { BillingService } from '../src/billing/billing.service';

// Testes do historico comercial (19/09): primeira compra, transicoes de status e receita — com o
// Prisma e os servicos externos totalmente simulados (nenhuma chamada real a banco, Asaas ou loja).

type Dict = Record<string, jest.Mock>;

function build(opts: { userStatus?: string; studentCode?: number | null; statusChanges?: boolean; billingRow?: { id: string; firstPaidAt: Date | null } | null; existingPaymentEvent?: boolean } = {}) {
  const {
    userStatus = 'pending', studentCode = null, statusChanges = true, billingRow = null, existingPaymentEvent = false,
  } = opts;

  const billingEvent: Dict = {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(existingPaymentEvent ? { id: 'existing' } : null),
  };
  const billingSubscription: Dict = {
    findUnique: jest.fn().mockResolvedValue(billingRow),
    create: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({}),
  };
  const user: Dict = {
    findUnique: jest.fn().mockResolvedValue({ name: 'Ana', email: 'ana@x.com', subscriptionStatus: userStatus, studentCode }),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Ana', email: 'ana@x.com', subscriptionStatus: userStatus, studentCode, acquisitionAttribution: null }),
    updateMany: jest.fn().mockResolvedValue({ count: statusChanges ? 1 : 0 }),
    update: jest.fn().mockResolvedValue({}),
  };
  const prisma = {
    billingEvent, billingSubscription, user,
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  const config = { get: jest.fn((key: string) => (key === 'REVENUECAT_WEBHOOK_SECRET' ? 'rc-secret' : key === 'ASAAS_WEBHOOK_TOKEN' ? 'asaas-token' : undefined)) };
  const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
  const messaging = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const trainingPlans = { generateFirstWeekIfNeeded: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notifyUserIfNotRecent: jest.fn().mockResolvedValue(undefined), notifyUser: jest.fn().mockResolvedValue(undefined) };
  const metaCapi = { sendEvent: jest.fn() };

  const service = new BillingService(prisma as never, config as never, telegram as never, messaging as never, trainingPlans as never, notifications as never, metaCapi as never);
  // efeitos colaterais de codigo de aluno / boas-vindas ja sao cobertos em outro lugar; aqui isolam-se
  jest.spyOn(service as never, 'createWelcomeNotificationOnce' as never).mockResolvedValue(undefined as never);
  jest.spyOn(service as never, 'assignStudentCodeIfNeeded' as never).mockResolvedValue(undefined as never);

  return { service, prisma, billingEvent, billingSubscription, user, metaCapi };
}

const eventsCreated = (billingEvent: Dict) => billingEvent.create.mock.calls.map((c) => c[0].data);
const rcEvent = (type: string, extra: Record<string, unknown> = {}) => ({
  event: { type, app_user_id: 'user-1', product_id: 'panzeri_monthly', transaction_id: 'tx-1', purchased_at_ms: Date.UTC(2026, 8, 20, 15, 0, 0), ...extra },
});
const asaasEvent = (event: string, paymentId = 'pay_1', value = 19.9) => ({
  event, payment: { id: paymentId, subscription: 'sub_1', status: 'RECEIVED', value },
});

describe('CI-001 — RevenueCat: primeira compra + provider', () => {
  it('INITIAL_PURCHASE (1a compra real): cria BillingSubscription provider=revenuecat com firstPaidAt e id de transacao da loja', async () => {
    const { service, billingSubscription } = build({ userStatus: 'pending', studentCode: null });
    await service.processRevenueCatWebhook('Bearer rc-secret', rcEvent('INITIAL_PURCHASE'));
    expect(billingSubscription.create).toHaveBeenCalledTimes(1);
    expect(billingSubscription.create.mock.calls[0][0].data).toMatchObject({
      userId: 'user-1', provider: 'revenuecat', firstPaidPaymentId: 'revenuecat:tx-1',
    });
    expect(billingSubscription.create.mock.calls[0][0].data.firstPaidAt).toEqual(new Date(Date.UTC(2026, 8, 20, 15, 0, 0)));
  });

  it('nunca usa userId como identificador de pagamento; sem id de transacao fica null', async () => {
    const { service, billingSubscription } = build();
    await service.processRevenueCatWebhook('Bearer rc-secret', rcEvent('INITIAL_PURCHASE', { transaction_id: undefined, original_transaction_id: undefined }));
    expect(billingSubscription.create.mock.calls[0][0].data.firstPaidPaymentId).toBeNull();
  });

  it('webhook INITIAL_PURCHASE REPETIDO: status ja ativo -> nao cria nem altera nada (idempotente)', async () => {
    const { service, billingSubscription, billingEvent } = build({ userStatus: 'active', studentCode: 12, statusChanges: false });
    await service.processRevenueCatWebhook('Bearer rc-secret', rcEvent('INITIAL_PURCHASE'));
    expect(billingSubscription.create).not.toHaveBeenCalled();
    expect(billingSubscription.updateMany).not.toHaveBeenCalled();
    expect(eventsCreated(billingEvent)).toHaveLength(0);
  });

  it('RENEWAL nunca marca primeira compra (nem em transicao)', async () => {
    const { service, billingSubscription } = build({ userStatus: 'overdue', studentCode: 12, statusChanges: true });
    await service.processRevenueCatWebhook('Bearer rc-secret', rcEvent('RENEWAL'));
    expect(billingSubscription.create).not.toHaveBeenCalled();
    expect(billingSubscription.updateMany).not.toHaveBeenCalled();
  });

  it('assinante ANTIGO (studentCode existente, anterior a instrumentacao) que reativa via loja NAO ganha primeira compra falsa', async () => {
    const { service, billingSubscription, billingEvent } = build({ userStatus: 'canceled', studentCode: 5, statusChanges: true });
    await service.processRevenueCatWebhook('Bearer rc-secret', rcEvent('INITIAL_PURCHASE'));
    expect(billingSubscription.create).not.toHaveBeenCalled();
    expect(billingSubscription.updateMany).not.toHaveBeenCalled();
    // mas a TRANSICAO de estado e registrada (fato de estado)
    expect(eventsCreated(billingEvent)).toEqual([
      expect.objectContaining({ event: 'status_changed', prevStatus: 'canceled', nextStatus: 'active', externalRef: 'revenuecat:INITIAL_PURCHASE:tx-1' }),
    ]);
  });

  it('BillingSubscription ja existente (checkout Asaas nunca pago) e firstPaidAt nulo: atualiza a MESMA linha, sem duplicar', async () => {
    const { service, billingSubscription } = build({ userStatus: 'pending', studentCode: null, billingRow: { id: 'bill-1', firstPaidAt: null } });
    await service.processRevenueCatWebhook('Bearer rc-secret', rcEvent('INITIAL_PURCHASE'));
    expect(billingSubscription.create).not.toHaveBeenCalled();
    expect(billingSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bill-1', firstPaidAt: null } }));
  });

  it('BillingSubscription com firstPaidAt ja preenchido (outro provider foi primeiro): NAO sobrescreve', async () => {
    const { service, billingSubscription } = build({ userStatus: 'pending', studentCode: null, billingRow: { id: 'bill-1', firstPaidAt: new Date('2026-09-01') } });
    await service.processRevenueCatWebhook('Bearer rc-secret', rcEvent('INITIAL_PURCHASE'));
    expect(billingSubscription.create).not.toHaveBeenCalled();
    expect(billingSubscription.updateMany).not.toHaveBeenCalled();
  });

  it('RECEITA: nenhum payment_confirmed e criado para RevenueCat (nada de valor inventado)', async () => {
    const { service, billingEvent } = build({ userStatus: 'pending', studentCode: null });
    await service.processRevenueCatWebhook('Bearer rc-secret', rcEvent('INITIAL_PURCHASE'));
    expect(eventsCreated(billingEvent).some((e) => e.event === 'payment_confirmed')).toBe(false);
    expect(eventsCreated(billingEvent).every((e) => e.value === undefined)).toBe(true);
  });

  it('token invalido continua sendo rejeitado', async () => {
    const { service } = build();
    await expect(service.processRevenueCatWebhook('Bearer errado', rcEvent('INITIAL_PURCHASE'))).rejects.toThrow();
  });
});

describe('Asaas — pagamento confirmado, primeira compra e transicoes', () => {
  const billing = { id: 'bill-1', userId: 'user-1', externalSubscriptionId: 'sub_1' };
  const withBilling = (h: ReturnType<typeof build>) => {
    h.billingSubscription.findUnique.mockResolvedValue(billing);
    return h;
  };

  it('1o pagamento (studentCode nulo, transicao pending->active): registra payment_confirmed COM valor, firstPaidAt e a transicao', async () => {
    const h = withBilling(build({ userStatus: 'pending', studentCode: null, statusChanges: true }));
    await h.service.processAsaasWebhook('asaas-token', asaasEvent('PAYMENT_CONFIRMED'));
    const created = eventsCreated(h.billingEvent);
    expect(created).toContainEqual(expect.objectContaining({ event: 'status_changed', prevStatus: 'pending', nextStatus: 'active', externalRef: 'asaas:webhook:PAYMENT_CONFIRMED:pay_1' }));
    expect(created).toContainEqual(expect.objectContaining({ event: 'payment_confirmed', value: 19.9, externalRef: 'pay_1' }));
    expect(h.billingSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'bill-1', firstPaidAt: null }, data: expect.objectContaining({ firstPaidPaymentId: 'pay_1' }),
    }));
  });

  it('RENOVACAO mensal (status ja active, sem transicao): a receita e registrada, mas NAO e primeira compra e nao ha transicao', async () => {
    const h = withBilling(build({ userStatus: 'active', studentCode: 7, statusChanges: false }));
    await h.service.processAsaasWebhook('asaas-token', asaasEvent('PAYMENT_RECEIVED', 'pay_2'));
    const created = eventsCreated(h.billingEvent);
    expect(created).toEqual([expect.objectContaining({ event: 'payment_confirmed', value: 19.9, externalRef: 'pay_2' })]);
    expect(h.billingSubscription.updateMany).not.toHaveBeenCalled();
  });

  it('PAYMENT_CONFIRMED + PAYMENT_RECEIVED do MESMO pagamento: receita contada uma vez so', async () => {
    const h = withBilling(build({ userStatus: 'active', studentCode: 7, statusChanges: false, existingPaymentEvent: true }));
    await h.service.processAsaasWebhook('asaas-token', asaasEvent('PAYMENT_RECEIVED', 'pay_3'));
    expect(eventsCreated(h.billingEvent).some((e) => e.event === 'payment_confirmed')).toBe(false);
  });

  it('corrida real: duas entregas simultaneas passam pelo findFirst e o indice unico (P2002) barra a segunda — sem erro e sem duplicar', async () => {
    const h = withBilling(build({ userStatus: 'pending', studentCode: null, statusChanges: true }));
    h.billingEvent.create.mockImplementation(async (args: { data: { event: string } }) => {
      if (args.data.event === 'payment_confirmed') throw Object.assign(new Error('unique'), { code: 'P2002' });
      return {};
    });
    await expect(h.service.processAsaasWebhook('asaas-token', asaasEvent('PAYMENT_RECEIVED', 'pay_race'))).resolves.toEqual({ received: true });
    // a 1a compra continua sendo marcada (guard firstPaidAt:null) mesmo com o payment_confirmed ja existente
    expect(h.billingSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bill-1', firstPaidAt: null } }));
  });

  it('assinante antigo que volta (overdue->active, studentCode existente): registra a transicao, NAO marca primeira compra', async () => {
    const h = withBilling(build({ userStatus: 'overdue', studentCode: 3, statusChanges: true }));
    await h.service.processAsaasWebhook('asaas-token', asaasEvent('PAYMENT_CONFIRMED', 'pay_4'));
    expect(h.billingSubscription.updateMany).not.toHaveBeenCalled();
    expect(eventsCreated(h.billingEvent)).toContainEqual(expect.objectContaining({ event: 'status_changed', prevStatus: 'overdue', nextStatus: 'active' }));
  });

  it('testador (manual_active) que passa a pagar de verdade conta como primeira compra', async () => {
    const h = withBilling(build({ userStatus: 'manual_active', studentCode: 9, statusChanges: true }));
    await h.service.processAsaasWebhook('asaas-token', asaasEvent('PAYMENT_CONFIRMED', 'pay_5'));
    expect(h.billingSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bill-1', firstPaidAt: null } }));
  });

  it('falha ao gravar historico NUNCA derruba o webhook de pagamento (best-effort)', async () => {
    const h = withBilling(build({ userStatus: 'pending', studentCode: null, statusChanges: true }));
    h.billingEvent.create.mockRejectedValue(new Error('banco indisponivel'));
    await expect(h.service.processAsaasWebhook('asaas-token', asaasEvent('PAYMENT_CONFIRMED', 'pay_6'))).resolves.toEqual({ received: true });
  });

  it('cancelamento via webhook (SUBSCRIPTION_DELETED) registra a transicao active->canceled', async () => {
    const h = withBilling(build({ userStatus: 'active', studentCode: 7, statusChanges: true }));
    await h.service.processAsaasWebhook('asaas-token', { event: 'SUBSCRIPTION_DELETED', payment: { id: 'pay_7', subscription: 'sub_1', status: 'DELETED', value: 19.9 } });
    expect(eventsCreated(h.billingEvent)).toContainEqual(expect.objectContaining({ event: 'status_changed', prevStatus: 'active', nextStatus: 'canceled' }));
    expect(eventsCreated(h.billingEvent).some((e) => e.event === 'payment_confirmed')).toBe(false);
  });
});
