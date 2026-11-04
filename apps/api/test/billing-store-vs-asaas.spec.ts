import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { BillingService } from '../src/billing/billing.service';
import { NotificationTriggersService } from '../src/messaging/notification-triggers.service';

// 04/11/2026 — caso Thais: ela pagou pela Google Play, mas a assinatura antiga do Asaas gerou uma cobranca que venceu. O aviso do Asaas mudou o status dela para "atrasado", o app bloqueou os treinos e
// o e-mail de atraso foi enviado; depois o botao "Verificar pagamento" a marcou como cancelada. Quem paga pela LOJA (provider 'revenuecat') nunca pode ter o status decidido pelo Asaas.
type Dict = Record<string, jest.Mock>;

function build(opts: { provider: string; billingProviderStatus?: string }) {
  const billingEvent: Dict = { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) };
  const billingSubscription: Dict = {
    findUnique: jest.fn().mockResolvedValue({ id: 'b1', userId: 'user-1', externalSubscriptionId: 'sub_1', providerStatus: opts.billingProviderStatus ?? 'active' }),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockResolvedValue({}),
  };
  const user: Dict = {
    findUnique: jest.fn().mockResolvedValue({ accountStatus: 'active', subscriptionProvider: opts.provider }),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Thais', email: 't@x.com', subscriptionStatus: 'active', subscriptionProvider: opts.provider, studentCode: 48, acquisitionAttribution: null }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({}),
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
  return { service, user, billingSubscription, billingEvent, telegram, messaging, metaCapi };
}

const asaasEvent = (event: string, status: string, paymentId = 'pay_1') => ({ event, payment: { id: paymentId, subscription: 'sub_1', status, value: 19.9 } });

describe('aviso do Asaas (webhook) x quem paga pela loja', () => {
  it('PAYMENT_OVERDUE de aluna da loja: status NAO muda, estado da cobranca e registrado e o treinador e avisado UMA vez', async () => {
    const { service, user, billingSubscription, telegram, messaging } = build({ provider: 'revenuecat', billingProviderStatus: 'pending' });
    const result = await service.processAsaasWebhook('asaas-token', asaasEvent('PAYMENT_OVERDUE', 'OVERDUE'));
    expect(result).toMatchObject({ received: true, ignored: 'store_managed' });
    expect(user.updateMany).not.toHaveBeenCalled();
    expect(billingSubscription.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { providerStatus: 'overdue' } });
    expect(telegram.notifyCoach).toHaveBeenCalledTimes(1);
    expect(String(telegram.notifyCoach.mock.calls[0][0])).toContain('paga pela loja');
    expect(String(telegram.notifyCoach.mock.calls[0][0])).toContain('NAO foi alterado');
    expect(messaging.sendEmail).not.toHaveBeenCalled();
  });

  it('mesmo evento repetido (estado da cobranca igual): nao avisa de novo', async () => {
    const { service, telegram, user } = build({ provider: 'revenuecat', billingProviderStatus: 'overdue' });
    await service.processAsaasWebhook('asaas-token', asaasEvent('PAYMENT_OVERDUE', 'OVERDUE'));
    expect(telegram.notifyCoach).not.toHaveBeenCalled();
    expect(user.updateMany).not.toHaveBeenCalled();
  });

  it('pagamento CONFIRMADO no Asaas de aluna da loja: o registro financeiro e preservado, mas o status nao muda', async () => {
    const { service, user, billingEvent } = build({ provider: 'revenuecat', billingProviderStatus: 'pending' });
    await service.processAsaasWebhook('asaas-token', asaasEvent('PAYMENT_CONFIRMED', 'CONFIRMED'));
    expect(user.updateMany).not.toHaveBeenCalled();
    expect(billingEvent.create).toHaveBeenCalledTimes(1);
  });

  it('REGRESSAO: aluna do Asaas continua tendo o status atualizado pelo aviso do Asaas', async () => {
    const { service, user } = build({ provider: 'asaas' });
    await service.processAsaasWebhook('asaas-token', asaasEvent('PAYMENT_OVERDUE', 'OVERDUE'));
    expect(user.updateMany).toHaveBeenCalledTimes(1);
    expect(user.updateMany.mock.calls[0][0].data.subscriptionStatus).toBe('overdue');
  });
});

describe('botao "Verificar pagamento" do painel x quem paga pela loja', () => {
  it('aluna da loja: recusa com explicacao e NAO consulta o Asaas', async () => {
    const { service } = build({ provider: 'revenuecat' });
    const spy = jest.spyOn(service as never, 'refreshFromAsaas' as never).mockResolvedValue({} as never);
    await expect(service.refreshStatusForStudent('user-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.refreshStatusForStudent('user-1')).rejects.toThrow(/paga pela loja/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('REGRESSAO: aluna do Asaas continua sendo verificada normalmente', async () => {
    const { service } = build({ provider: 'asaas' });
    const spy = jest.spyOn(service as never, 'refreshFromAsaas' as never).mockResolvedValue({ appStatus: 'active' } as never);
    await service.refreshStatusForStudent('user-1');
    expect(spy).toHaveBeenCalledWith('b1', 'user-1', 'sub_1');
  });
});

describe('e-mail e push de "pagamento nao processado" x quem paga pela loja', () => {
  const make = () => {
    const svc = Object.create(NotificationTriggersService.prototype) as Record<string, unknown>;
    svc.messaging = { hasRecentTriggerMessage: jest.fn().mockResolvedValue(false), sendEmail: jest.fn().mockResolvedValue(undefined) };
    svc.notifications = { notifyUserIfNotRecent: jest.fn().mockResolvedValue(undefined) };
    return svc as { messaging: { sendEmail: jest.Mock }; notifications: { notifyUserIfNotRecent: jest.Mock }; checkPaymentPending: (student: unknown) => Promise<void> };
  };

  it('aluna da loja com status atrasado: NAO recebe e-mail nem push', async () => {
    const svc = make();
    await svc.checkPaymentPending({ id: 'u1', name: 'Thais', subscriptionStatus: 'overdue', subscriptionProvider: 'revenuecat', billingSubscription: { checkoutUrl: 'https://asaas/x' } });
    expect(svc.messaging.sendEmail).not.toHaveBeenCalled();
    expect(svc.notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
  });

  it('REGRESSAO: aluna do Asaas atrasada continua recebendo o aviso', async () => {
    const svc = make();
    await svc.checkPaymentPending({ id: 'u2', name: 'Ana', subscriptionStatus: 'overdue', subscriptionProvider: 'asaas', billingSubscription: { checkoutUrl: 'https://asaas/y' } });
    expect(svc.messaging.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('leitura da propria aluna (getMine): sem reconciliar com o Asaas quem paga pela loja', () => {
  it('a condicao do sync automatico exclui provider revenuecat', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'billing', 'billing.service.ts'), 'utf8');
    expect(source).toContain("billing?.externalSubscriptionId && asaasConfigured && !user.subscriptionManualOverride && user.subscriptionProvider !== 'revenuecat'");
  });
});
