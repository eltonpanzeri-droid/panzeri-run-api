import { BillingService, isStoreReviewAccountEmail, storeEnvironmentOf, storeLabelOf } from '../src/billing/billing.service';

// 09/11/2026 (caso Tiago): compra de TESTE da loja (SANDBOX) nao e' compra real. Prisma e servicos externos totalmente simulados.
type Dict = Record<string, jest.Mock>;

function build(opts: { userStatus?: string; studentCode?: number | null; isTestAccount?: boolean; email?: string; billingRow?: { id: string; firstPaidAt: Date | null } | null; statusChanges?: boolean } = {}) {
  const { userStatus = 'canceled', studentCode = 50, isTestAccount = false, email = 'tiago@x.com', billingRow = null, statusChanges = true } = opts;
  const billingEvent: Dict = { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) };
  const billingSubscription: Dict = {
    findUnique: jest.fn().mockResolvedValue(billingRow), create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}),
  };
  const row = { name: 'Tiago', email, subscriptionStatus: userStatus, studentCode, isTestAccount, accountStatus: 'active' };
  const user: Dict = {
    findUnique: jest.fn().mockResolvedValue(row),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ ...row, acquisitionAttribution: null }),
    updateMany: jest.fn().mockResolvedValue({ count: statusChanges ? 1 : 0 }),
    update: jest.fn().mockResolvedValue({}),
  };
  const prisma = { billingEvent, billingSubscription, user, $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)) };
  const config = { get: jest.fn((key: string) => (key === 'REVENUECAT_WEBHOOK_SECRET' ? 'rc-secret' : undefined)) };
  const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
  const messaging = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const trainingPlans = { generateFirstWeekIfNeeded: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notifyUserIfNotRecent: jest.fn().mockResolvedValue(undefined), notifyUser: jest.fn().mockResolvedValue(undefined) };
  const service = new BillingService(prisma as never, config as never, telegram as never, messaging as never, trainingPlans as never, notifications as never, { sendEvent: jest.fn() } as never, { record: jest.fn() } as never);
  jest.spyOn(service as never, 'createWelcomeNotificationOnce' as never).mockResolvedValue(undefined as never);
  jest.spyOn(service as never, 'assignStudentCodeIfNeeded' as never).mockResolvedValue(undefined as never);
  return { service, user, billingSubscription, telegram, messaging, notifications };
}
const rc = (type: string, extra: Record<string, unknown> = {}) => ({ event: { type, app_user_id: 'user-1', product_id: 'panzeri_monthly', transaction_id: 'tx-1', purchased_at_ms: Date.UTC(2026, 10, 8, 15, 0, 0), ...extra } });
const userUpdates = (user: Dict) => user.update.mock.calls.map((c) => c[0].data);

describe('funcoes puras', () => {
  it('ambiente: SANDBOX/PRODUCTION (qualquer caixa); qualquer outra coisa = desconhecido', () => {
    expect(storeEnvironmentOf({ environment: 'SANDBOX' })).toBe('SANDBOX');
    expect(storeEnvironmentOf({ environment: ' production ' })).toBe('PRODUCTION');
    expect(storeEnvironmentOf({ environment: 'staging' })).toBeNull();
    expect(storeEnvironmentOf({})).toBeNull();
    expect(storeEnvironmentOf(undefined)).toBeNull();
  });
  it('contas de revisao das lojas', () => {
    expect(isStoreReviewAccountEmail('revisao-apple-1@x.com')).toBe(true);
    expect(isStoreReviewAccountEmail('Revisao-Google-2@x.com')).toBe(true);
    expect(isStoreReviewAccountEmail('tiago@x.com')).toBe(false);
    expect(isStoreReviewAccountEmail(null)).toBe(false);
  });
});

describe('aviso de pagamento com a loja certa (09/11/2026)', () => {
  it('nome da loja: Google Play, App Store; desconhecida mantem o texto generico', () => {
    expect(storeLabelOf('PLAY_STORE')).toBe('Google Play');
    expect(storeLabelOf('play_store')).toBe('Google Play');
    expect(storeLabelOf('APP_STORE')).toBe('App Store');
    expect(storeLabelOf('app store')).toBe('App Store');
    expect(storeLabelOf('MAC_APP_STORE')).toBe('App Store');
    expect(storeLabelOf('STRIPE')).toBe('App Store / Google Play');
    expect(storeLabelOf(undefined)).toBe('App Store / Google Play');
  });
  it('pagamento real pelo Google Play: "Eba!! Pagamento recebido" com a loja certa', async () => {
    const { service, telegram } = build({ userStatus: 'pending', studentCode: null });
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('INITIAL_PURCHASE', { environment: 'PRODUCTION', store: 'PLAY_STORE' }));
    const message = telegram.notifyCoach.mock.calls[0][0] as string;
    expect(message).toContain('Eba!! Pagamento recebido no Panzeri Run!');
    expect(message).toContain('via Google Play');
    expect(message).not.toContain('App Store');
  });
  it('pagamento real pela App Store diz App Store', async () => {
    const { service, telegram } = build({ userStatus: 'pending', studentCode: null });
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('INITIAL_PURCHASE', { store: 'APP_STORE' }));
    expect(telegram.notifyCoach.mock.calls[0][0]).toContain('via App Store');
    expect(telegram.notifyCoach.mock.calls[0][0]).not.toContain('Google Play');
  });
  it('compra de TESTE tambem diz a loja e nunca comemora como pagamento', async () => {
    const { service, telegram } = build({ userStatus: 'pending', studentCode: null });
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('INITIAL_PURCHASE', { environment: 'SANDBOX', store: 'PLAY_STORE' }));
    const message = telegram.notifyCoach.mock.calls[0][0] as string;
    expect(message).toContain('Compra de TESTE na Google Play');
    expect(message).not.toContain('Eba!!');
  });
});

describe('compra de TESTE (SANDBOX)', () => {
  it('libera o acesso, marca a conta como teste, avisa o treinador como TESTE e nao grava primeira compra nem manda e-mail de pagamento', async () => {
    const { service, user, billingSubscription, telegram, messaging } = build({ userStatus: 'pending', studentCode: null });
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('INITIAL_PURCHASE', { environment: 'SANDBOX' }));
    expect(user.updateMany).toHaveBeenCalled(); // acesso liberado (status ativo)
    expect(user.updateMany.mock.calls[0][0].data.subscriptionStatus).toBe('active');
    expect(userUpdates(user)).toContainEqual({ isTestAccount: true });
    expect(billingSubscription.create).not.toHaveBeenCalled();
    expect(billingSubscription.updateMany).not.toHaveBeenCalled();
    expect(messaging.sendEmail).not.toHaveBeenCalled();
    expect(telegram.notifyCoach).toHaveBeenCalledTimes(1);
    expect(telegram.notifyCoach.mock.calls[0][0]).toContain('Compra de TESTE');
    expect(telegram.notifyCoach.mock.calls[0][0]).not.toContain('Pagamento recebido');
  });
  it('conta ja marcada como teste nao e regravada', async () => {
    const { service, user } = build({ userStatus: 'pending', studentCode: null, isTestAccount: true });
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('INITIAL_PURCHASE', { environment: 'SANDBOX' }));
    expect(userUpdates(user)).not.toContainEqual({ isTestAccount: true });
  });
  it('CANCELLATION de teste NAO vira "pediu cancelamento" nem notifica a aluna (mas marca como teste)', async () => {
    const { service, user, notifications } = build({ userStatus: 'active' });
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('CANCELLATION', { environment: 'SANDBOX' }));
    expect(userUpdates(user).some((d) => 'subscriptionCancelRequestedAt' in d)).toBe(false);
    expect(notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
    expect(userUpdates(user)).toContainEqual({ isTestAccount: true });
  });
  it('EXPIRATION de teste continua encerrando o acesso (a conta ja esta fora das contagens)', async () => {
    const { service, user } = build({ userStatus: 'active', isTestAccount: true });
    jest.spyOn(service as never, 'verifyExpirationWithStore' as never).mockResolvedValue('expired' as never); // a loja confirma o vencimento
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('EXPIRATION', { environment: 'SANDBOX' }));
    expect(user.updateMany).toHaveBeenCalled();
  });
});

describe('compra de PRODUCAO', () => {
  it('conta marcada como teste que faz a 1a compra REAL: desmarca, grava a data real da 1a compra e avisa como pagamento real', async () => {
    const { service, user, billingSubscription, telegram } = build({ userStatus: 'canceled', studentCode: 50, isTestAccount: true, billingRow: { id: 'b1', firstPaidAt: new Date('2026-11-08T12:00:00Z') } });
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('INITIAL_PURCHASE', { environment: 'PRODUCTION' }));
    expect(userUpdates(user)).toContainEqual({ isTestAccount: false });
    expect(billingSubscription.updateMany).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { provider: 'revenuecat', firstPaidAt: new Date(Date.UTC(2026, 10, 8, 15, 0, 0)), firstPaidPaymentId: 'revenuecat:tx-1' } });
    expect(telegram.notifyCoach.mock.calls[0][0]).toContain('Pagamento recebido');
  });
  it('conta de revisao da loja continua marcada como teste mesmo com compra de producao', async () => {
    const { service, user } = build({ isTestAccount: true, email: 'revisao-apple-1@x.com' });
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('INITIAL_PURCHASE', { environment: 'PRODUCTION' }));
    expect(userUpdates(user)).not.toContainEqual({ isTestAccount: false });
  });
  it('conta real (nao marcada) com compra de producao: nada muda na marca de teste', async () => {
    const { service, user } = build({ userStatus: 'pending', studentCode: null });
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('INITIAL_PURCHASE', { environment: 'PRODUCTION' }));
    expect(userUpdates(user).some((d) => 'isTestAccount' in d)).toBe(false);
  });
  it('RENEWAL de producao nao desmarca por engano uma conta de teste de outro tipo de evento (so compra/renovacao reais contam, e RENEWAL conta)', async () => {
    const { service, user } = build({ userStatus: 'active', isTestAccount: true });
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('EXPIRATION', { environment: 'PRODUCTION' }));
    expect(userUpdates(user).some((d) => 'isTestAccount' in d)).toBe(false); // EXPIRATION nao e' compra
  });
});

describe('ambiente desconhecido (comportamento antigo preservado)', () => {
  it('sem o campo de ambiente: nao marca teste, grava a primeira compra e avisa como pagamento', async () => {
    const { service, user, billingSubscription, telegram } = build({ userStatus: 'pending', studentCode: null });
    await service.processRevenueCatWebhook('Bearer rc-secret', rc('INITIAL_PURCHASE'));
    expect(userUpdates(user).some((d) => 'isTestAccount' in d)).toBe(false);
    expect(billingSubscription.create).toHaveBeenCalledTimes(1);
    expect(telegram.notifyCoach.mock.calls[0][0]).toContain('Pagamento recebido');
  });
});
