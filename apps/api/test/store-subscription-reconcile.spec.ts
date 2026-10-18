import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BadGatewayException } from '@nestjs/common';
import { BillingService, deriveSubscriptionContext } from '../src/billing/billing.service';
import { BillingController } from '../src/billing/billing.controller';
import { BillingSyncSchedulerService } from '../src/billing/billing-sync-scheduler.service';

// 18/10/2026: assinatura Apple Sandbox expirada continuava "Ativa" (GET /billing/me nao consultava a loja; webhook nao chegou).
// Aqui: vigente, cancelada com acesso vigente, expirada de fato, falha de consulta e ausencia — cinco desfechos que NAO podem se confundir.
const future = () => new Date(Date.now() + 20 * 86_400_000).toISOString();
const past = () => new Date(Date.now() - 2 * 86_400_000).toISOString();

type UserRow = Record<string, unknown>;
const storeUser = (extra: UserRow = {}): UserRow => ({
  accountStatus: 'active', subscriptionStatus: 'active', subscriptionProvider: 'revenuecat', subscriptionManualOverride: false,
  subscriptionCancelRequestedAt: null, subscriptionUpdatedAt: null, studentCode: 1, cpf: null, ...extra,
});

function build(user: UserRow, subs: Record<string, unknown> | 'fail' | 'http500' | 'nosubscriber', secret = 'sk_teste') {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      findUniqueOrThrow: jest.fn().mockResolvedValue(user),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    billingSubscription: { findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const config = { get: jest.fn((k: string) => (k === 'REVENUECAT_SECRET_API_KEY' ? secret : undefined)) };
  const service = new BillingService(prisma as never, config as never, { notifyCoach: jest.fn() } as never, {} as never, {} as never, {} as never, {} as never, { record: jest.fn() } as never);
  const handle = jest.spyOn(service as never, 'handleRevenueCatEvent' as never).mockResolvedValue({ received: true } as never);
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((async () => {
    if (subs === 'fail') throw new Error('network down');
    if (subs === 'http500') return { ok: false, status: 500, json: async () => ({}) };
    if (subs === 'nosubscriber') return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ subscriber: { subscriptions: subs } }) };
  }) as never);
  return { service, prisma, handle, fetchMock };
}
afterEach(() => jest.restoreAllMocks());

describe('GET /billing/me reconcilia a assinatura da loja', () => {
  it('assinatura vigente (renovacao ativa): continua ativa, grava a data real de fim do periodo e nao dispara expiracao', async () => {
    const end = future();
    const t = build(storeUser(), { p: { expires_date: end, store: 'app_store' } });
    const me = await t.service.getMine('u1');
    expect(me.status).toBe('active');
    expect(me.syncError).toBe(false);
    expect(t.handle).not.toHaveBeenCalled();
    expect(t.prisma.billingSubscription.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { nextChargeAt: new Date(end), providerStatus: 'active' } });
  });

  it('renovacao cancelada com acesso vigente: segue ativa ate expires_date e marca o cancelamento (sem EXPIRATION)', async () => {
    const unsub = new Date(Date.now() - 86_400_000).toISOString();
    const t = build(storeUser(), { p: { expires_date: future(), store: 'app_store', unsubscribe_detected_at: unsub } });
    await t.service.getMine('u1');
    expect(t.handle).not.toHaveBeenCalled();
    expect(t.prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { subscriptionCancelRequestedAt: new Date(unsub) } }));
    const ctx = deriveSubscriptionContext(
      { subscriptionStatus: 'active', subscriptionCancelRequestedAt: new Date(unsub), studentCode: 1 },
      { overdueInvoiceUrl: null, nextChargeAt: new Date('2026-11-05T12:00:00Z') },
      { storeManaged: true },
    );
    expect(ctx.state).toBe('cancellation_scheduled');
    expect(ctx.statusMessage).toBe('Ativa até 05/11/2026');
  });

  it('renovacao religada na loja: limpa a marca de cancelamento', async () => {
    const t = build(storeUser({ subscriptionCancelRequestedAt: new Date() }), { p: { expires_date: future(), store: 'app_store' } });
    await t.service.getMine('u1');
    expect(t.prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { subscriptionCancelRequestedAt: null } }));
  });

  it('expiracao efetiva (todas as assinaturas vencidas): aplica EXPIRATION e a tela diz "Assinatura expirada"', async () => {
    const t = build(storeUser(), { p: { expires_date: past(), store: 'app_store' } });
    t.prisma.user.findUniqueOrThrow.mockResolvedValueOnce(storeUser()).mockResolvedValue(storeUser({ subscriptionStatus: 'canceled' }));
    const me = await t.service.getMine('u1');
    expect(t.handle).toHaveBeenCalledWith({ type: 'EXPIRATION', app_user_id: 'u1' });
    expect(me.status).toBe('canceled');
    expect(me.subscriptionContext.state).toBe('ex_subscriber');
    expect(me.subscriptionContext.statusMessage).toBe('Assinatura expirada');
    // fora da loja o texto antigo continua
    expect(deriveSubscriptionContext({ subscriptionStatus: 'canceled', subscriptionCancelRequestedAt: null, studentCode: 1 }, null).statusMessage).toBe('Acesso encerrado');
  });

  it('periodo de tolerancia de cobranca (grace) vigente: ainda NAO e expiracao', async () => {
    const t = build(storeUser(), { p: { expires_date: past(), grace_period_expires_date: future(), store: 'app_store' } });
    await t.service.getMine('u1');
    expect(t.handle).not.toHaveBeenCalled();
  });

  it('falha de consulta (rede, HTTP 500, resposta sem assinante): preserva o ultimo estado, sinaliza syncError e NUNCA expira', async () => {
    for (const failure of ['fail', 'http500', 'nosubscriber'] as const) {
      const t = build(storeUser(), failure);
      const warn = jest.spyOn((t.service as never as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
      const me = await t.service.getMine('u1');
      expect(me.status).toBe('active');
      expect(me.syncError).toBe(true);
      expect(t.handle).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled(); // registrado para diagnostico
      await expect(t.service.syncStoreSubscription('u1')).rejects.toBeInstanceOf(BadGatewayException);
    }
  });

  it('ausencia (RevenueCat sem nenhuma assinatura) NAO e expiracao; so revoga quando a origem de uma transferencia pede', async () => {
    const t = build(storeUser(), {});
    jest.spyOn((t.service as never as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    const me = await t.service.getMine('u1');
    expect(me.status).toBe('active');
    expect(me.syncError).toBe(false);
    expect(t.handle).not.toHaveBeenCalled();
    expect(await t.service.syncStoreSubscription('u1', { revokeWhenAbsent: true })).toEqual({ status: 'inactive', store: null });
    expect(t.handle).toHaveBeenCalledWith({ type: 'EXPIRATION', app_user_id: 'u1' });
  });

  it('protege grants manuais, override do treinador e assinantes Asaas: nem consulta a loja na leitura', async () => {
    for (const user of [storeUser({ subscriptionStatus: 'manual_active' }), storeUser({ subscriptionManualOverride: true }), storeUser({ subscriptionProvider: 'asaas' })]) {
      const t = build(user, { p: { expires_date: past(), store: 'app_store' } });
      await t.service.getMine('u1');
      expect(t.fetchMock).not.toHaveBeenCalled();
      expect(t.handle).not.toHaveBeenCalled();
    }
    // e a validacao ativa tambem nao revoga override manual mesmo com assinatura da loja vencida
    const forced = build(storeUser({ subscriptionManualOverride: true }), { p: { expires_date: past(), store: 'app_store' } });
    await forced.service.syncStoreSubscription('u1');
    expect(forced.handle).not.toHaveBeenCalled();
  });

  it('controle de frequencia: leitura automatica 1x por minuto; botao 1x a cada 10s; falha nao conta como consulta feita', async () => {
    const t = build(storeUser(), { p: { expires_date: future(), store: 'app_store' } });
    await t.service.getMine('u1');
    await t.service.getMine('u1');
    await t.service.getMine('u1', { force: true }); // dentro de 10s da consulta anterior
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    const map = (t.service as never as { storeReadSyncAt: Map<string, number> }).storeReadSyncAt;
    map.set('u1', Date.now() - 15_000); // passou o intervalo do botao, nao o da leitura automatica
    await t.service.getMine('u1');
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    await t.service.getMine('u1', { force: true });
    expect(t.fetchMock).toHaveBeenCalledTimes(2);

    const callsBefore = t.fetchMock.mock.calls.length; // o spy de fetch e' compartilhado entre os dois build()
    const failing = build(storeUser(), 'fail');
    jest.spyOn((failing.service as never as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    await failing.service.getMine('u1');
    await failing.service.getMine('u1');
    expect(failing.fetchMock.mock.calls.length - callsBefore).toBe(2);
  });
});

describe('P1 — tolerancia de cobranca NAO e pagamento recebido', () => {
  it('pendente (overdue) em tolerancia: continua pendente, sem INITIAL_PURCHASE, sem gravar nada, sem aviso de recebimento', async () => {
    const t = build(storeUser({ subscriptionStatus: 'overdue' }), { p: { expires_date: past(), grace_period_expires_date: future(), store: 'app_store' } });
    const me = await t.service.getMine('u1');
    expect(me.status).toBe('overdue');
    expect(t.handle).not.toHaveBeenCalled();
    expect(t.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(t.prisma.billingSubscription.updateMany).not.toHaveBeenCalled();
    expect(await t.service.syncStoreSubscription('u1')).toEqual({ status: 'unchanged', store: 'app_store' });
  });

  it('ativo em tolerancia: acesso preservado e sem nenhum evento; sem tolerancia vigente e vencida = expiracao', async () => {
    const t = build(storeUser(), { p: { expires_date: past(), grace_period_expires_date: future(), store: 'app_store' } });
    expect(await t.service.syncStoreSubscription('u1')).toEqual({ status: 'active', store: 'app_store' });
    expect(t.handle).not.toHaveBeenCalled();
    const expired = build(storeUser(), { p: { expires_date: past(), grace_period_expires_date: past(), store: 'app_store' } });
    await expired.service.syncStoreSubscription('u1');
    expect(expired.handle).toHaveBeenCalledWith({ type: 'EXPIRATION', app_user_id: 'u1' });
  });

  it('renovacao efetivamente confirmada (expires_date futuro) de quem estava pendente volta a ativo', async () => {
    const t = build(storeUser({ subscriptionStatus: 'overdue' }), { p: { expires_date: future(), store: 'app_store' } });
    await t.service.syncStoreSubscription('u1');
    expect(t.handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'RENEWAL', app_user_id: 'u1' })); // ja era assinante da loja: renovacao, nao primeira compra
  });
});

describe('P2 — chave RevenueCat ausente', () => {
  it('leitura: erro de sincronizacao (syncError), estado preservado, nenhuma consulta, log de erro sem expor chave', async () => {
    const t = build(storeUser(), {}, '');
    const logged = jest.spyOn((t.service as never as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
    const me = await t.service.getMine('u1');
    expect(me.status).toBe('active');
    expect(me.syncError).toBe(true);
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.handle).not.toHaveBeenCalled();
    expect(String((logged.mock.calls[0] as unknown[])[0])).toContain('REVENUECAT_SECRET_API_KEY');
    // quem nao e' da loja nao e' afetado pela falta da chave
    const asaas = build(storeUser({ subscriptionProvider: 'asaas' }), {}, '');
    expect((await asaas.service.getMine('u1')).syncError).toBe(false);
  });

  it('rotina periodica: registra erro e nao executa; sync ativo continua lancando 503', async () => {
    const t = build(storeUser(), {}, '');
    const logged = jest.spyOn((t.service as never as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
    expect(await t.service.refreshAllStoreSubscriptions()).toMatchObject({ skipped: true, checked: 0 });
    expect(logged).toHaveBeenCalled();
    await expect(t.service.syncStoreSubscription('u1')).rejects.toThrow();
  });

  it('app: o sync pos-compra/restauracao so conta como sucesso com HTTP 2xx', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain('async function syncStoreAccess(accessToken: string, automatic = false): Promise<boolean>');
    expect(app).toContain('return response.ok;');
    expect(app.split('const synced = await syncStoreAccess(accessToken);')).toHaveLength(4); // 3 usos: 2 compras + restauracao
    expect(app).toContain('nao consegui confirmar seu acesso agora');
  });
});

describe('P3 — data de expiracao invalida e FALHA de validacao', () => {
  it('expires_date ou grace ilegivel: lanca BadGateway, preserva o estado e nunca expira (nem com outra assinatura valida junto)', async () => {
    const cases: Array<Record<string, unknown>> = [
      { p: { expires_date: 'nao-e-data', store: 'app_store' } },
      { p: { expires_date: past(), grace_period_expires_date: '???', store: 'app_store' } },
      { old: { expires_date: past() }, p: { expires_date: 'xx' } },
    ];
    for (const subs of cases) {
      const t = build(storeUser(), subs);
      const warn = jest.spyOn((t.service as never as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
      await expect(t.service.syncStoreSubscription('u1')).rejects.toBeInstanceOf(BadGatewayException);
      const me = await t.service.getMine('u1');
      expect(me.status).toBe('active');
      expect(me.syncError).toBe(true);
      expect(t.handle).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    }
  });

  it('expires_date ausente/nulo continua significando assinatura sem vencimento (nao e invalida)', async () => {
    const t = build(storeUser(), { p: { expires_date: null, store: 'app_store' } });
    expect(await t.service.syncStoreSubscription('u1')).toEqual({ status: 'active', store: 'app_store' });
    expect(t.handle).not.toHaveBeenCalled();
  });
});

describe('Recuperacao de assinatura cancelada indevidamente', () => {
  const live = () => ({ p: { expires_date: future(), store: 'app_store' } });

  it('cancelada (provedor loja) com assinatura vigente confirmada volta a ativa por RENEWAL — na leitura de /billing/me', async () => {
    const t = build(storeUser({ subscriptionStatus: 'canceled' }), live());
    t.prisma.user.findUniqueOrThrow.mockResolvedValueOnce(storeUser({ subscriptionStatus: 'canceled' })).mockResolvedValue(storeUser({ subscriptionStatus: 'active' }));
    const me = await t.service.getMine('u1');
    expect(t.handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'RENEWAL', app_user_id: 'u1' }));
    expect(t.handle).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'INITIAL_PURCHASE' }));
    expect(me.status).toBe('active');
  });

  it('renovacao APOS a expiracao: a rotina periodica tambem recupera, sem abrir o app', async () => {
    const t = build(storeUser({ subscriptionStatus: 'canceled' }), live());
    t.prisma.user.findMany.mockResolvedValue([{ id: 'u1', subscriptionStatus: 'canceled' }]);
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 as never; }) as never);
    const result = await t.service.refreshAllStoreSubscriptions();
    expect(result).toMatchObject({ checked: 1, recovered: 1, failed: 0 });
    expect(t.handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'RENEWAL' }));
  });

  it('protecoes: sem assinatura vigente nao recupera; Asaas, grant manual, override e quem nunca foi da loja NAO ganham acesso por varredura automatica', async () => {
    const none = build(storeUser({ subscriptionStatus: 'canceled' }), { p: { expires_date: past(), store: 'app_store' } });
    await none.service.getMine('u1');
    expect(none.handle).not.toHaveBeenCalled();
    const absent = build(storeUser({ subscriptionStatus: 'canceled' }), {});
    await absent.service.getMine('u1');
    expect(absent.handle).not.toHaveBeenCalled();
    for (const user of [
      storeUser({ subscriptionStatus: 'canceled', subscriptionProvider: 'asaas' }),
      storeUser({ subscriptionStatus: 'canceled', subscriptionManualOverride: true }),
      storeUser({ subscriptionStatus: 'manual_active' }),
      storeUser({ subscriptionStatus: 'pending', subscriptionProvider: null }),
    ]) {
      const t = build(user, live());
      t.fetchMock.mockClear(); // o spy de fetch e compartilhado entre os build()
      await t.service.getMine('u1');
      expect(t.fetchMock).not.toHaveBeenCalled();
      expect(t.handle).not.toHaveBeenCalled();
    }
    // varredura automatica chamada direto para uma conta que nunca foi da loja: tambem nao concede
    const pending = build(storeUser({ subscriptionStatus: 'pending', subscriptionProvider: 'asaas' }), live());
    const rec = pending.service as never as { reconcileStoreSubscription: (id: string, o: object) => Promise<unknown> };
    await rec.reconcileStoreSubscription('u1', { automatic: true });
    expect(pending.handle).not.toHaveBeenCalled();
    // compra explicita pelo app (POST store/sync) continua concedendo como antes
    await pending.service.syncStoreSubscription('u1');
    expect(pending.handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'INITIAL_PURCHASE' }));
  });
});

describe('Webhook EXPIRATION fora de ordem', () => {
  const rcSecret = 'whsec';
  function webhookBuild(user: UserRow, subs: Parameters<typeof build>[1], key = 'sk_teste') {
    const t = build(user, subs, key);
    (t.service as never as { config: { get: (k: string) => string | undefined } }).config.get = ((k: string) => (k === 'REVENUECAT_SECRET_API_KEY' ? key : k === 'REVENUECAT_WEBHOOK_SECRET' ? rcSecret : undefined)) as never;
    const logger = (t.service as never as { logger: { warn: () => void; error: () => void } }).logger;
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    return t;
  }
  const expiration = { event: { type: 'EXPIRATION', app_user_id: 'u1' } };

  it('evento atrasado: a loja mostra assinatura vigente (renovada) => NAO revoga', async () => {
    const t = webhookBuild(storeUser(), { p: { expires_date: future(), store: 'app_store' } });
    expect(await t.service.processRevenueCatWebhook(`Bearer ${rcSecret}`, expiration)).toEqual({ received: true, expirationIgnored: 'active' });
    expect(t.handle).not.toHaveBeenCalled();
  });

  it('expiracao confirmada pela loja => revoga normalmente (tratamento existente)', async () => {
    const t = webhookBuild(storeUser(), { p: { expires_date: past(), store: 'app_store' } });
    await t.service.processRevenueCatWebhook(`Bearer ${rcSecret}`, expiration);
    expect(t.handle).toHaveBeenCalledWith(expiration.event);
  });

  it('RevenueCat indisponivel, resposta inconclusiva, sem chave, tolerancia vigente ou data invalida => preserva (nao revoga) e responde 2xx', async () => {
    for (const subs of ['fail', 'http500', 'nosubscriber', {}, { p: { expires_date: 'xx' } }, { p: { expires_date: past(), grace_period_expires_date: future() } }] as const) {
      const t = webhookBuild(storeUser(), subs as never);
      const result = (await t.service.processRevenueCatWebhook(`Bearer ${rcSecret}`, expiration)) as { received: boolean; expirationIgnored?: string };
      expect(result.received).toBe(true);
      expect(result.expirationIgnored).toBeDefined();
      expect(t.handle).not.toHaveBeenCalled();
    }
    const noKey = webhookBuild(storeUser(), {}, '');
    expect(await noKey.service.processRevenueCatWebhook(`Bearer ${rcSecret}`, expiration)).toEqual({ received: true, expirationIgnored: 'inconclusive' });
    expect(noKey.handle).not.toHaveBeenCalled();
  });

  it('REFUND segue regra propria (sem consulta) e a rotina corrige depois o que o webhook preservou', async () => {
    const refund = webhookBuild(storeUser(), 'fail');
    await refund.service.processRevenueCatWebhook(`Bearer ${rcSecret}`, { event: { type: 'REFUND', app_user_id: 'u1' } });
    expect(refund.fetchMock).not.toHaveBeenCalled();
    expect(refund.handle).toHaveBeenCalledWith({ type: 'REFUND', app_user_id: 'u1' });
    // webhook preservou por falha; depois a loja confirma a expiracao e a reconciliacao revoga
    const later = webhookBuild(storeUser(), { p: { expires_date: past(), store: 'app_store' } });
    expect(await later.service.syncStoreSubscription('u1')).toEqual({ status: 'inactive', store: null });
    expect(later.handle).toHaveBeenCalledWith({ type: 'EXPIRATION', app_user_id: 'u1' });
  });
});

describe('Recuperacao de acesso NAO e nova transacao financeira (sem aviso de pagamento)', () => {
  function realHandler(currentStatus: string) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ accountStatus: 'active', name: 'Aluna', email: 'a@x.com', subscriptionStatus: currentStatus, studentCode: 7 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ studentCode: 7 }),
      },
      billingSubscription: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), updateMany: jest.fn() },
    };
    const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
    const messaging = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new BillingService(prisma as never, { get: jest.fn() } as never, telegram as never, messaging as never, {} as never, {} as never, {} as never, { record: jest.fn() } as never);
    const internals = service as never as Record<string, unknown>;
    jest.spyOn(internals, 'recordStatusTransition' as never).mockResolvedValue(undefined as never);
    jest.spyOn(internals, 'createWelcomeNotificationOnce' as never).mockResolvedValue(undefined as never);
    jest.spyOn(internals, 'assignStudentCodeIfNeeded' as never).mockResolvedValue(undefined as never);
    jest.spyOn(internals, 'triggerFirstWeekGeneration' as never).mockImplementation((() => undefined) as never);
    const run = (event: Record<string, unknown>) => (service as never as { handleRevenueCatEvent: (e: unknown) => Promise<unknown> }).handleRevenueCatEvent(event);
    return { prisma, telegram, messaging, run };
  }

  it('recuperacao por reconciliacao: o status volta a ativo mas NAO dispara "Pagamento recebido" nem e-mail de confirmacao', async () => {
    const t = realHandler('canceled');
    await t.run({ type: 'RENEWAL', app_user_id: 'u1', reconciliation_recovery: true });
    expect(t.prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriptionStatus: 'active' }) }));
    expect(t.telegram.notifyCoach).not.toHaveBeenCalled();
    expect(t.messaging.sendEmail).not.toHaveBeenCalled();
  });

  it('compras e renovacoes confirmadas (webhook / compra explicita) continuam notificando', async () => {
    for (const [status, type] of [['pending', 'INITIAL_PURCHASE'], ['canceled', 'INITIAL_PURCHASE'], ['overdue', 'RENEWAL'], ['canceled', 'RENEWAL']] as const) {
      const t = realHandler(status);
      await t.run({ type, app_user_id: 'u1' });
      expect(t.telegram.notifyCoach).toHaveBeenCalledTimes(1);
      expect(t.messaging.sendEmail).toHaveBeenCalledTimes(1);
    }
  });

  it('reconciliacao automatica marca a recuperacao; compra/restauracao explicita (sem auto) nao marca e segue notificando', async () => {
    const auto = build(storeUser({ subscriptionStatus: 'canceled' }), { p: { expires_date: future(), store: 'app_store' } });
    await auto.service.syncStoreSubscription('u1', { automatic: true });
    expect(auto.handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'RENEWAL', reconciliation_recovery: true }));
    const explicit = build(storeUser({ subscriptionStatus: 'canceled' }), { p: { expires_date: future(), store: 'app_store' } });
    await explicit.service.syncStoreSubscription('u1');
    expect(explicit.handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'RENEWAL' }));
    expect(explicit.handle).not.toHaveBeenCalledWith(expect.objectContaining({ reconciliation_recovery: true }));
    // a leitura de /billing/me e a rotina de 6h usam o modo automatico
    const read = build(storeUser({ subscriptionStatus: 'canceled' }), { p: { expires_date: future(), store: 'app_store' } });
    await read.service.getMine('u1');
    expect(read.handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'RENEWAL', reconciliation_recovery: true }));
  });

  it('endpoint: auto=1 vira modo automatico; sem auto segue o fluxo de compra; app envia auto=1 so na consulta ao abrir/voltar', async () => {
    const syncStoreSubscription = jest.fn(async () => ({}));
    const controller = new BillingController({ syncStoreSubscription } as never);
    await controller.syncStore({ sub: 'u1' } as never, '1');
    expect(syncStoreSubscription).toHaveBeenLastCalledWith('u1', { automatic: true });
    await controller.syncStore({ sub: 'u1' } as never);
    expect(syncStoreSubscription).toHaveBeenLastCalledWith('u1');
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain("billing/store/sync${automatic ? '?auto=1' : ''}");
    expect(app).toContain('void syncStoreAccess(accessToken, true);');
  });
});

describe('rotina periodica de assinaturas da loja', () => {
  it('varre so alunos com acesso pela loja (nunca Asaas nem manual), segue apos falha e conta expiradas', async () => {
    const t = build(storeUser(), { p: { expires_date: past(), store: 'app_store' } });
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 as never; }) as never);
    t.prisma.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const reconcile = jest.spyOn(t.service as never, 'reconcileStoreSubscription' as never)
      .mockRejectedValueOnce(new BadGatewayException('x') as never)
      .mockResolvedValueOnce({ status: 'inactive' } as never);
    jest.spyOn((t.service as never as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    const result = await t.service.refreshAllStoreSubscriptions();
    expect(result).toEqual({ checked: 2, changed: 1, recovered: 0, failed: 1, skipped: false });
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(t.prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ subscriptionProvider: 'revenuecat', subscriptionManualOverride: false, subscriptionStatus: { in: ['active', 'overdue', 'canceled'] } }),
    }));
  });

  it('agendador: cron proprio (a cada 6h), com trava, e a varredura do Asaas continua separada', async () => {
    const billing = { refreshAllStoreSubscriptions: jest.fn().mockResolvedValue({}), refreshAllPendingStudents: jest.fn().mockResolvedValue({ checked: 0, changed: 0, failed: 0 }) };
    const scheduler = new BillingSyncSchedulerService(billing as never);
    await scheduler.syncStoreSubscribers();
    expect(billing.refreshAllStoreSubscriptions).toHaveBeenCalledTimes(1);
    expect(billing.refreshAllPendingStudents).not.toHaveBeenCalled();
    billing.refreshAllStoreSubscriptions.mockRejectedValueOnce(new Error('boom'));
    await expect(scheduler.syncStoreSubscribers()).resolves.toBeUndefined(); // falha nao derruba nem trava o proximo ciclo
    await scheduler.syncStoreSubscribers();
    expect(billing.refreshAllStoreSubscriptions).toHaveBeenCalledTimes(3);
  });
});

describe('app: sync ao abrir/voltar ao primeiro plano e textos de estado', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
  it('reconcilia ao abrir e ao voltar (AppState), no maximo a cada 5 minutos; botao usa force=1', () => {
    expect(app).toContain("AppState.addEventListener('change'");
    expect(app).toContain('5 * 60 * 1000');
    expect(app).toContain("'/billing/me' + (showConfirmation ? '?force=1' : '')");
    expect(app).toContain("subscriptionState === 'cancellation_scheduled' ? 'Renovacao cancelada (acesso vigente)'");
    expect(app).toContain("subscriptionState === 'ex_subscriber' && details?.storeManaged ? 'Assinatura expirada'");
  });
});
