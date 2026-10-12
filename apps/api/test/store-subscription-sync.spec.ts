import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ServiceUnavailableException } from '@nestjs/common';
import { BillingService } from '../src/billing/billing.service';
import { BillingController } from '../src/billing/billing.controller';

// Assinatura Apple/Google via RevenueCat: validacao ATIVA no servidor (nunca so' o aparelho), restauracao/transferencia e separacao do Asaas.
const future = () => new Date(Date.now() + 20 * 86_400_000).toISOString();
const past = () => new Date(Date.now() - 2 * 86_400_000).toISOString();

function build(user: Record<string, unknown> | null, secret: string = 'sk_teste', subs: Record<string, unknown> = {}, mockHandle = true) {
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  const config = { get: jest.fn((k: string) => (k === 'REVENUECAT_SECRET_API_KEY' ? secret : k === 'REVENUECAT_WEBHOOK_SECRET' ? 'rc' : undefined)) };
  const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
  const service = new BillingService(prisma as never, config as never, telegram as never, {} as never, {} as never, {} as never, {} as never, { record: jest.fn() } as never);
  const handle = mockHandle ? jest.spyOn(service as never, 'handleRevenueCatEvent' as never).mockResolvedValue({ received: true } as never) : (jest.fn() as jest.SpyInstance);
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ subscriber: { subscriptions: subs } }) } as never);
  return { service, handle, telegram, fetchMock };
}
const base = { accountStatus: 'active', subscriptionStatus: 'pending', subscriptionProvider: 'asaas' };
afterEach(() => jest.restoreAllMocks());

describe('validacao da assinatura da loja no servidor', () => {
  it('compra aprovada na Apple: o servidor confirma no RevenueCat (chave secreta, so no servidor) e libera pelo MESMO tratamento do webhook', async () => {
    const t = build(base, 'sk_teste', { 'panzeri.mensal': { expires_date: future(), original_purchase_date: '2026-10-11T12:00:00Z', store: 'app_store', product_identifier: 'panzeri.mensal' } });
    const result = await t.service.syncStoreSubscription('u1');
    expect(result).toEqual({ status: 'active', store: 'app_store' });
    expect(t.handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'INITIAL_PURCHASE', app_user_id: 'u1', product_id: 'panzeri.mensal' }));
    expect(String(t.fetchMock.mock.calls[0][0])).toContain('/v1/subscribers/u1');
    expect((t.fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer sk_teste');
  });

  it('compra recusada/sem assinatura na loja: nada e liberado e nada muda', async () => {
    const t = build(base, 'sk_teste', {});
    expect(await t.service.syncStoreSubscription('u1')).toEqual({ status: 'unchanged', store: null });
    expect(t.handle).not.toHaveBeenCalled();
  });

  it('expirada (cancelou/falha de pagamento nao regularizada): quem tinha acesso PELA LOJA perde; vencida na loja = EXPIRATION', async () => {
    const t = build({ ...base, subscriptionStatus: 'active', subscriptionProvider: 'revenuecat' }, 'sk_teste', { p: { expires_date: past(), store: 'app_store' } });
    expect(await t.service.syncStoreSubscription('u1')).toEqual({ status: 'inactive', store: null });
    expect(t.handle).toHaveBeenCalledWith({ type: 'EXPIRATION', app_user_id: 'u1' });
  });

  it('NUNCA rebaixa assinante do Asaas nem grant manual por causa da loja', async () => {
    for (const user of [{ ...base, subscriptionStatus: 'active', subscriptionProvider: 'asaas' }, { ...base, subscriptionStatus: 'manual_active', subscriptionProvider: 'revenuecat' }]) {
      const t = build(user, 'sk_teste', {});
      await t.service.syncStoreSubscription('u1');
      expect(t.handle).not.toHaveBeenCalled();
    }
  });

  it('ja ativo na loja: idempotente (sem novo evento); conta excluida: ignorada; sem chave configurada: 503 (nunca libera)', async () => {
    const active = build({ ...base, subscriptionStatus: 'active', subscriptionProvider: 'revenuecat' }, 'sk_teste', { p: { expires_date: future(), store: 'app_store' } });
    expect(await active.service.syncStoreSubscription('u1')).toMatchObject({ status: 'active' });
    expect(active.handle).not.toHaveBeenCalled();
    const deleted = build({ ...base, accountStatus: 'deleted' }, 'sk_teste', { p: { expires_date: future() } });
    expect(await deleted.service.syncStoreSubscription('u1')).toEqual({ status: 'unchanged', store: null });
    expect(deleted.handle).not.toHaveBeenCalled();
    await expect(build(base, '').service.syncStoreSubscription('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('RESTAURACAO em outra conta (TRANSFER): valida origem e destino no RevenueCat; sem chave, avisa o treinador e nao altera ninguem', async () => {
    const t = build(base, 'sk_teste', { p: { expires_date: future(), store: 'app_store' } }, false);
    const sync = jest.spyOn(t.service, 'syncStoreSubscription').mockResolvedValue({ status: 'unchanged', store: null });
    await t.service.processRevenueCatWebhook('Bearer rc', { event: { type: 'TRANSFER', transferred_from: ['a', '$RCAnonymousID:x'], transferred_to: ['b'] } });
    expect(sync.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b']); // anonimo ignorado
    const none = build(base, '', {}, false);
    await none.service.processRevenueCatWebhook('Bearer rc', { event: { type: 'TRANSFER', transferred_from: ['a'], transferred_to: ['b'] } });
    expect(none.telegram.notifyCoach).toHaveBeenCalledTimes(1);
    expect(none.handle).not.toHaveBeenCalled();
  });

  it('endpoint: exige JWT, tem limite e usa SEMPRE o usuario do token', async () => {
    expect(Reflect.getMetadata('__guards__', BillingController.prototype.syncStore)).toHaveLength(1);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', BillingController.prototype.syncStore)).toBe(10);
    const syncStoreSubscription = jest.fn(async () => ({}));
    await new BillingController({ syncStoreSubscription } as never).syncStore({ sub: 'u-token' } as never);
    expect(syncStoreSubscription).toHaveBeenCalledWith('u-token');
  });
});

describe('app: iOS usa a loja; Android e web inalterados', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
  it('chave por plataforma; CPF so fora da loja; restaurar compras; sincronizacao no servidor apos comprar; preco da loja', () => {
    expect(app).toContain("Platform.OS === 'ios' ? REVENUECAT_IOS_API_KEY : Platform.OS === 'android' ? REVENUECAT_ANDROID_API_KEY : ''");
    expect(app).toContain('return revenueCatApiKey().length > 0;'); // web: chave vazia => segue no Asaas
    expect(app).toContain('Purchases.restorePurchases()');
    expect(app).toContain('/billing/store/sync');
    expect(app.match(/await syncStoreAccess\(accessToken\);/g)).toHaveLength(3); // compra (2 telas) + restauracao
    expect(app.match(/<RestorePurchasesButton/g)?.length).toBeGreaterThanOrEqual(3);
    expect(app).toContain('product?.priceString');
    expect(app).toContain('renovação automática'); // Apple 3.1.2
    expect(app).toContain('onPress={() => Linking.openURL(LEGAL_TERMS_URL)}');
    expect(app.match(/!isNativeStorePurchaseAvailable\(\) \? \(/g)?.length).toBeGreaterThanOrEqual(2);
    const config = JSON.parse(readFileSync(join(__dirname, '..', '..', 'mobile', 'app.json'), 'utf8')) as { expo: { extra: Record<string, unknown> } };
    expect(config.expo.extra).toHaveProperty('revenueCatIosApiKey');
    expect(config.expo.extra.revenueCatAndroidApiKey).toBe('goog_FLrWawYScrxGhBOzuyNKTlxJxAQ'); // Android intacto
  });
});
