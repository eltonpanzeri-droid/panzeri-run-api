import { BillingService } from '../src/billing/billing.service';
import { capturedNotice, isOverdueDay, isStalePaidEvent, noticeKindOfEvent, overdueNotice, pickLatestRelevantPayment, settledNotice, shortBrDate } from '../src/billing/asaas-notices';

// 17/11/2026 — caso Fernando Teodoro (Cod. 0000058): o PAYMENT_RECEIVED (cartao, ~30 dias depois) da cobranca de 14/10 chegou com a de 14/11 vencida e reativou o aluno por engano, com o aviso
// "Pagamento recebido". Agora: cada fase tem texto proprio (pagamento feito / dinheiro liberado / mensalidade atrasada), aviso antigo nao reativa e atraso so' aparece no dia seguinte ao vencimento.

const PAID = new Set(['received', 'confirmed', 'received_in_cash']);
const FERNANDO = [
  { id: 'pay_out', status: 'RECEIVED', dueDate: '2026-10-14' },
  { id: 'pay_nov', status: 'OVERDUE', dueDate: '2026-11-14' },
  { id: 'pay_dez', status: 'PENDING', dueDate: '2026-12-14' },
];

describe('textos dos tres avisos', () => {
  it('formata a data como dd/mm/aa', () => {
    expect(shortBrDate('2026-10-14')).toBe('14/10/26');
    expect(shortBrDate('2026-11-16T03:09:00Z')).toBe('16/11/26');
    expect(shortBrDate(null)).toBeNull();
    expect(shortBrDate('lixo')).toBeNull();
  });
  it('1) pagamento feito: aluno, vencimento e a data em que o Asaas vai efetivar', () => {
    expect(capturedNotice({ name: 'Fernando', code: '0000058', dueDate: '2026-10-14', creditDate: '2026-11-16' }))
      .toBe('Aluno Fernando (Cod. 0000058) fez o pagamento referente ao vencimento 14/10/26. O Asaas vai efetivar o pagamento em 16/11/26.');
    expect(capturedNotice({ name: 'Fernando', code: '0000058', dueDate: '2026-10-14', creditDate: null })).toContain('em data ainda não informada pelo Asaas');
    expect(capturedNotice({ name: 'Ana', code: '0000001', dueDate: '2026-10-14', creditDate: '2026-11-16', firstPayment: true })).toContain('Primeiro pagamento deste aluno.');
  });
  it('2) dinheiro liberado: o banco Asaas efetivou o pagamento referente ao vencimento', () => {
    expect(settledNotice({ name: 'Fernando', code: '0000058', dueDate: '2026-10-14' }))
      .toBe('O banco Asaas efetivou o pagamento do aluno Fernando (Cod. 0000058) referente ao vencimento 14/10/26.');
  });
  it('3) atraso: qual mensalidade e quando venceu', () => {
    expect(overdueNotice({ name: 'Fernando', code: '0000058', dueDate: '2026-11-14' }))
      .toBe('O aluno Fernando (Cod. 0000058) está com a mensalidade de vencimento 14/11/26 atrasada.');
  });
  it('o texto novo nao tem mais o "Pagamento recebido no Panzeri Run!" que confundiu', () => {
    for (const text of [capturedNotice({ name: 'A', code: '1', dueDate: null, creditDate: null }), settledNotice({ name: 'A', code: '1', dueDate: null }), overdueNotice({ name: 'A', code: '1', dueDate: null })]) {
      expect(text).not.toContain('Pagamento recebido no Panzeri Run');
    }
  });
});

describe('regras', () => {
  it('atraso so a partir do dia seguinte ao vencimento (o aluno paga ate o fim do dia)', () => {
    expect(isOverdueDay('2026-11-14', '2026-11-14')).toBe(false); // dia do vencimento
    expect(isOverdueDay('2026-11-14', '2026-11-15')).toBe(true); // dia seguinte
    expect(isOverdueDay('2026-11-14', '2026-11-13')).toBe(false);
    expect(isOverdueDay(undefined, '2026-11-15')).toBe(false);
  });
  it('estorno e chargeback nao sao "atraso"; so confirmado, recebido e vencido tem aviso proprio', () => {
    expect(noticeKindOfEvent('PAYMENT_CONFIRMED')).toBe('captured');
    expect(noticeKindOfEvent('PAYMENT_RECEIVED')).toBe('settled');
    expect(noticeKindOfEvent('PAYMENT_OVERDUE')).toBe('overdue');
    for (const e of ['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CREATED', undefined]) expect(noticeKindOfEvent(e as string | undefined)).toBeNull();
  });
  it('cobranca mais recente: pendente com vencimento futuro nao conta; a vencida de 14/11 e a mais recente', () => {
    const { latest } = pickLatestRelevantPayment(FERNANDO, '2026-11-16');
    expect(latest?.id).toBe('pay_nov');
    expect(pickLatestRelevantPayment(FERNANDO, '2026-12-20').latest?.id).toBe('pay_dez'); // depois do vencimento de dezembro ela passa a contar
    expect(pickLatestRelevantPayment([], '2026-11-16').latest).toBeUndefined();
  });
  it('aviso de pago ANTIGO (14/10) com a mensalidade seguinte vencida e antigo; o da cobranca atual, nao', () => {
    expect(isStalePaidEvent('pay_out', FERNANDO, '2026-11-16', PAID)).toBe(true);
    expect(isStalePaidEvent('pay_nov', FERNANDO, '2026-11-16', PAID)).toBe(false);
    // renovacao normal: a mais recente tambem esta paga
    expect(isStalePaidEvent('pay_out', [{ id: 'pay_out', status: 'RECEIVED', dueDate: '2026-10-14' }, { id: 'pay_nov', status: 'CONFIRMED', dueDate: '2026-11-14' }], '2026-11-16', PAID)).toBe(false);
    // primeiro pagamento: so existe ele
    expect(isStalePaidEvent('pay_1', [{ id: 'pay_1', status: 'CONFIRMED', dueDate: '2026-11-14' }], '2026-11-16', PAID)).toBe(false);
    expect(isStalePaidEvent('pay_1', [], '2026-11-16', PAID)).toBe(false);
  });
});

// ---- webhook e sincronizacao no servico, com banco simulado
type Dict = Record<string, jest.Mock>;
function build(opts: { status: string; payments?: unknown; detail?: Record<string, unknown>; asaasDown?: boolean; alreadyNoticed?: boolean }) {
  const billingEvent: Dict = { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn(async () => (opts.alreadyNoticed ? { id: 'e' } : null)) };
  const billingSubscription: Dict = {
    findUnique: jest.fn().mockResolvedValue({ id: 'b1', userId: 'user-1', externalSubscriptionId: 'sub_1', providerStatus: 'overdue' }),
    update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const user: Dict = {
    findUnique: jest.fn(async (args: { select?: Record<string, boolean> }) => (args?.select?.name ? { name: 'Fernando', studentCode: 58 } : { accountStatus: 'active', subscriptionProvider: 'asaas' })),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Fernando', email: 'f@x.com', subscriptionStatus: opts.status, subscriptionProvider: 'asaas', studentCode: 58, acquisitionAttribution: null }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}),
  };
  const prisma = { billingEvent, billingSubscription, user, $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)) };
  const config = { get: jest.fn((key: string) => (key === 'ASAAS_WEBHOOK_TOKEN' ? 'asaas-token' : key === 'ASAAS_API_KEY' ? 'k' : undefined)) };
  const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
  const messaging = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const trainingPlans = { generateFirstWeekIfNeeded: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notifyUserIfNotRecent: jest.fn().mockResolvedValue(undefined), notifyUser: jest.fn().mockResolvedValue(undefined) };
  const metaCapi = { sendEvent: jest.fn() };
  const service = new BillingService(prisma as never, config as never, telegram as never, messaging as never, trainingPlans as never, notifications as never, metaCapi as never, { record: jest.fn() } as never);
  jest.spyOn(service as never, 'createWelcomeNotificationOnce' as never).mockResolvedValue(undefined as never);
  jest.spyOn(service as never, 'assignStudentCodeIfNeeded' as never).mockResolvedValue(undefined as never);
  jest.spyOn(service as never, 'recordConfirmedPayment' as never).mockResolvedValue(undefined as never);
  jest.spyOn(service as never, 'asaasRequest' as never).mockImplementation((async (path: string) => {
    if (opts.asaasDown) throw new Error('asaas fora do ar');
    if (path.startsWith('/payments?subscription=')) return { data: opts.payments ?? FERNANDO };
    if (path.startsWith('/payments/')) return opts.detail ?? {};
    if (path.startsWith('/subscriptions/')) return { id: 'sub_1', status: 'ACTIVE', nextDueDate: '2026-12-14' };
    return {};
  }) as never);
  return { service, user, billingSubscription, billingEvent, telegram, messaging, notifications };
}

const hook = (event: string, payment: Record<string, unknown>) => ({ event, payment: { subscription: 'sub_1', value: 19.9, ...payment } });
const texts = (telegram: Dict) => telegram.notifyCoach.mock.calls.map((c) => String(c[0]));

describe('webhook: o caso Fernando', () => {
  beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }); jest.setSystemTime(new Date('2026-11-16T06:10:00Z')); });
  afterEach(() => jest.useRealTimers());

  it('PAYMENT_RECEIVED da cobranca de 14/10 com a de 14/11 vencida: NAO reativa, NAO manda e-mail nem notificacao ao aluno; so o aviso "banco efetivou"', async () => {
    const { service, user, messaging, notifications, telegram } = build({ status: 'overdue' });
    const result = await service.processAsaasWebhook('asaas-token', hook('PAYMENT_RECEIVED', { id: 'pay_out', status: 'RECEIVED', dueDate: '2026-10-14' }));
    expect(result).toMatchObject({ received: true, ignored: 'stale_payment_event' });
    expect(user.updateMany).not.toHaveBeenCalled();
    expect(messaging.sendEmail).not.toHaveBeenCalled();
    expect(notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
    expect(texts(telegram)).toEqual(['O banco Asaas efetivou o pagamento do aluno Fernando (Cod. 0000058) referente ao vencimento 14/10/26.']);
  });

  it('o mesmo aviso repetido (Asaas reenvia): o treinador nao recebe duas vezes', async () => {
    const { service, telegram } = build({ status: 'overdue', alreadyNoticed: true });
    await service.processAsaasWebhook('asaas-token', hook('PAYMENT_RECEIVED', { id: 'pay_out', status: 'RECEIVED', dueDate: '2026-10-14' }));
    expect(telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('PAYMENT_CONFIRMED (cartao aprovado) da cobranca ATUAL de quem estava atrasado: reativa e avisa "fez o pagamento ... vai efetivar em"', async () => {
    const { service, user, telegram } = build({ status: 'overdue', payments: [FERNANDO[0], { id: 'pay_nov', status: 'CONFIRMED', dueDate: '2026-11-14' }] });
    await service.processAsaasWebhook('asaas-token', hook('PAYMENT_CONFIRMED', { id: 'pay_nov', status: 'CONFIRMED', dueDate: '2026-11-14', estimatedCreditDate: '2026-12-16' }));
    expect(user.updateMany).toHaveBeenCalledTimes(1);
    expect(user.updateMany.mock.calls[0][0].data.subscriptionStatus).toBe('active');
    expect(texts(telegram)).toEqual(['Aluno Fernando (Cod. 0000058) fez o pagamento referente ao vencimento 14/11/26. O Asaas vai efetivar o pagamento em 16/12/26.']);
  });

  it('renovacao normal (aluno ja ativo): sem conferencia extra no Asaas, status igual, aviso de pagamento feito', async () => {
    const { service, user, telegram } = build({ status: 'active' });
    const spy = (service as unknown as { asaasRequest: jest.Mock }).asaasRequest;
    await service.processAsaasWebhook('asaas-token', hook('PAYMENT_CONFIRMED', { id: 'pay_nov', status: 'CONFIRMED', dueDate: '2026-11-14', estimatedCreditDate: '2026-12-16' }));
    expect(spy.mock.calls.some((c) => String(c[0]).startsWith('/payments?subscription='))).toBe(false);
    expect(user.updateMany).toHaveBeenCalledTimes(1); // o update condicional nao altera (mesmo status) — comportamento anterior
    expect(texts(telegram)[0]).toContain('fez o pagamento referente ao vencimento 14/11/26');
  });

  it('Asaas fora do ar na conferencia: vale o aviso (comportamento anterior) e o aluno nao fica sem acesso', async () => {
    const { service, user } = build({ status: 'overdue', asaasDown: true });
    await service.processAsaasWebhook('asaas-token', hook('PAYMENT_RECEIVED', { id: 'pay_out', status: 'RECEIVED', dueDate: '2026-10-14' }));
    expect(user.updateMany.mock.calls[0][0].data.subscriptionStatus).toBe('active');
  });

  it('PAYMENT_OVERDUE de 14/11 avisado em 16/11: "esta com a mensalidade de vencimento 14/11/26 atrasada"', async () => {
    const { service, telegram } = build({ status: 'active' });
    await service.processAsaasWebhook('asaas-token', hook('PAYMENT_OVERDUE', { id: 'pay_nov', status: 'OVERDUE', dueDate: '2026-11-14' }));
    expect(texts(telegram)).toEqual(['O aluno Fernando (Cod. 0000058) está com a mensalidade de vencimento 14/11/26 atrasada.']);
  });

  it('atraso no PROPRIO dia do vencimento nao e avisado (o aluno pode pagar ate o fim do dia)', async () => {
    jest.setSystemTime(new Date('2026-11-14T20:00:00Z')); // 17h em Sao Paulo, dia do vencimento
    const { service, telegram } = build({ status: 'active' });
    await service.processAsaasWebhook('asaas-token', hook('PAYMENT_OVERDUE', { id: 'pay_nov', status: 'OVERDUE', dueDate: '2026-11-14' }));
    expect(telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('aviso de atraso usa o detalhe do pagamento quando o aviso nao traz o vencimento', async () => {
    const { service, telegram } = build({ status: 'active', detail: { id: 'pay_nov', dueDate: '2026-11-14', invoiceUrl: 'https://x' } });
    await service.processAsaasWebhook('asaas-token', hook('PAYMENT_OVERDUE', { id: 'pay_nov', status: 'OVERDUE' }));
    expect(texts(telegram)[0]).toContain('vencimento 14/11/26 atrasada');
  });

  it('estorno (PAYMENT_REFUNDED) nao gera aviso de atraso', async () => {
    const { service, telegram } = build({ status: 'active' });
    await service.processAsaasWebhook('asaas-token', hook('PAYMENT_REFUNDED', { id: 'pay_out', status: 'REFUNDED', dueDate: '2026-10-14' }));
    expect(telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('falha do Telegram nunca derruba o webhook', async () => {
    const { service, telegram } = build({ status: 'overdue' });
    telegram.notifyCoach.mockRejectedValue(new Error('telegram fora'));
    await expect(service.processAsaasWebhook('asaas-token', hook('PAYMENT_RECEIVED', { id: 'pay_out', status: 'RECEIVED', dueDate: '2026-10-14' }))).resolves.toMatchObject({ received: true });
  });
});

describe('sincronizacao diaria (cobre o que o webhook perdeu)', () => {
  beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }); jest.setSystemTime(new Date('2026-11-16T09:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  it('aluno com a mensalidade de 14/11 vencida: fica atrasado e o treinador recebe o aviso do atraso, uma vez', async () => {
    const h = build({ status: 'active' });
    await (h.service as unknown as { refreshFromAsaas: (b: string, u: string, s: string) => Promise<unknown> }).refreshFromAsaas('b1', 'user-1', 'sub_1');
    expect(h.user.updateMany.mock.calls[0][0].data.subscriptionStatus).toBe('overdue');
    expect(texts(h.telegram)).toEqual(['O aluno Fernando (Cod. 0000058) está com a mensalidade de vencimento 14/11/26 atrasada.']);
    expect(h.billingEvent.create).toHaveBeenCalledWith({ data: { userId: 'user-1', event: 'asaas_notice', externalRef: 'overdue:pay_nov' } });
    // segunda sincronizacao (mesmo atraso): ja avisado
    const again = build({ status: 'overdue', alreadyNoticed: true });
    await (again.service as unknown as { refreshFromAsaas: (b: string, u: string, s: string) => Promise<unknown> }).refreshFromAsaas('b1', 'user-1', 'sub_1');
    expect(again.telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('o texto antigo "Pagamento recebido no Panzeri Run" nao existe mais no codigo de cobranca do Asaas', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'billing', 'billing.service.ts'), 'utf8') as string;
    expect(source).not.toContain('Pagamento recebido no Panzeri Run!\\n\\nAluno:');
  });
});
