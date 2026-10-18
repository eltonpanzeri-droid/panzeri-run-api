import 'reflect-metadata';
import { generateKeyPairSync, verify } from 'crypto';
import { BillingService } from '../src/billing/billing.service';
import { buildAppleJwt, fetchAppleSubscriptionVerdict, interpretAppleStatuses, readAppleCredentials } from '../src/billing/apple-store-status';

// 18/10/2026: consulta DIRETA a Apple para confirmar expiracao quando o RevenueCat esta desatualizado (caso real: aluno de teste cancelou na Apple e o
// RevenueCat continuou "ativa/renova"). A Apple so' pode CONFIRMAR EXPIRACAO; nunca concede acesso; falha nunca vira expiracao.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const creds = { keyId: 'KEY123', issuerId: 'issuer-abc', privateKey: pem, bundleId: 'com.panzerirun.app' };
const b64url = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const jws = (payload: Record<string, unknown>) => `h.${b64url(payload)}.s`;
const future = () => new Date(Date.now() + 20 * 86_400_000).toISOString();

const appleBody = (status: number, id = '2000') => ({ data: [{ lastTransactions: [{ originalTransactionId: id, status, signedTransactionInfo: jws({ transactionId: id, originalTransactionId: id }) }] }] });

afterEach(() => jest.restoreAllMocks());

describe('apple-store-status (modulo)', () => {
  it('credenciais: so existem com key id, issuer e chave; aceita "\\n" literais; bundle padrao', () => {
    expect(readAppleCredentials(() => undefined)).toBeNull();
    expect(readAppleCredentials((k) => ({ APPLE_IAP_KEY_ID: 'k', APPLE_IAP_ISSUER_ID: 'i' } as Record<string, string>)[k])).toBeNull();
    const ok = readAppleCredentials((k) => ({ APPLE_IAP_KEY_ID: 'k', APPLE_IAP_ISSUER_ID: 'i', APPLE_IAP_PRIVATE_KEY: 'AB' } as Record<string, string>)[k]);
    expect(ok).toMatchObject({ keyId: 'k', issuerId: 'i', bundleId: 'com.panzerirun.app' });
    expect(readAppleCredentials((k) => ({ APPLE_IAP_KEY_ID: 'k', APPLE_IAP_ISSUER_ID: 'i', APPLE_IAP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY----- -----END PRIVATE KEY-----' } as Record<string, string>)[k])).toBeNull();
  });

  it('chave .p8 colada de qualquer jeito no ambiente (caso real: DECODER unsupported): quebras reais, "\\n" literais, aspas, espacos no lugar das quebras e CRLF geram o MESMO JWT valido', () => {
    const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    const variants = [
      pem,
      pem.replace(/\n/g, '\\n'),
      `"${pem.replace(/\n/g, '\\n')}"`,
      `'${pem}'`,
      pem.replace(/\n/g, ' '),
      pem.replace(/\n/g, '\r\n'),
      `  ${pem}  \n`,
      `-----BEGIN PRIVATE KEY-----${body}-----END PRIVATE KEY-----`,
    ];
    for (const variant of variants) {
      const credentials = readAppleCredentials((k) => ({ APPLE_IAP_KEY_ID: 'KEY123', APPLE_IAP_ISSUER_ID: 'issuer-abc', APPLE_IAP_PRIVATE_KEY: variant } as Record<string, string>)[k]);
      expect(credentials).not.toBeNull();
      const [h, p, s] = buildAppleJwt(credentials!, 1_800_000_000).split('.');
      expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
    }
  });

  it('JWT ES256 valido: cabecalho/claims corretos e assinatura confere com a chave publica', () => {
    const token = buildAppleJwt(creds, 1_800_000_000);
    const [h, p, s] = token.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iss: 'issuer-abc', iat: 1_800_000_000, exp: 1_800_000_600, aud: 'appstoreconnect-v1', bid: 'com.panzerirun.app' });
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('interpreta status: 1/3/4 preservam; 2/5 confirmam expiracao; vazio/desconhecido nunca e expiracao', () => {
    expect(interpretAppleStatuses(appleBody(1), '2000')).toBe('active');
    expect(interpretAppleStatuses(appleBody(3), '2000')).toBe('active'); // nova tentativa de cobranca
    expect(interpretAppleStatuses(appleBody(4), '2000')).toBe('active'); // tolerancia
    expect(interpretAppleStatuses(appleBody(2), '2000')).toBe('expired');
    expect(interpretAppleStatuses(appleBody(5), '2000')).toBe('expired');
    expect(interpretAppleStatuses({}, '2000')).toBe('unknown');
    expect(interpretAppleStatuses({ data: [{ lastTransactions: [] }] }, '2000')).toBe('unknown');
    expect(interpretAppleStatuses(appleBody(9), '2000')).toBe('unknown');
  });

  it('rede: usa o endereco do ambiente informado; sem ambiente tenta producao e cai no Sandbox em 404; erro HTTP lanca (nao vira expiracao)', async () => {
    const calls: string[] = [];
    const respond = (map: Record<string, { status: number; body?: unknown }>) => jest.spyOn(global, 'fetch').mockImplementation((async (url: string) => {
      calls.push(String(url));
      const host = Object.keys(map).find((h) => String(url).startsWith(h)) as string;
      const r = map[host];
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
    }) as never);
    respond({ 'https://api.storekit-sandbox.itunes.apple.com': { status: 200, body: appleBody(2) }, 'https://api.storekit.itunes.apple.com': { status: 404 } });
    expect(await fetchAppleSubscriptionVerdict(creds, '2000', true)).toBe('expired');
    expect(calls).toEqual(['https://api.storekit-sandbox.itunes.apple.com/inApps/v1/subscriptions/2000']);
    calls.length = 0;
    expect(await fetchAppleSubscriptionVerdict(creds, '2000', undefined)).toBe('expired'); // producao 404 -> Sandbox
    expect(calls.map((c) => c.split('/inApps')[0])).toEqual(['https://api.storekit.itunes.apple.com', 'https://api.storekit-sandbox.itunes.apple.com']);
    jest.restoreAllMocks();
    respond({ 'https://api.storekit.itunes.apple.com': { status: 401 } });
    await expect(fetchAppleSubscriptionVerdict(creds, '2000', false)).rejects.toThrow();
    jest.restoreAllMocks();
    respond({ 'https://api.storekit.itunes.apple.com': { status: 404 } });
    expect(await fetchAppleSubscriptionVerdict(creds, '2000', false)).toBe('unknown');
  });
});

describe('reconciliacao com a Apple como fonte da verdade', () => {
  type Env = Record<string, string | undefined>;
  function build(user: Record<string, unknown>, env: Env, rcSubs: Record<string, unknown>, apple: { status: number; body?: unknown } | 'fail') {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user), findUniqueOrThrow: jest.fn().mockResolvedValue(user), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([]) },
      billingSubscription: { findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const config = { get: jest.fn((k: string) => env[k]) };
    const service = new BillingService(prisma as never, config as never, { notifyCoach: jest.fn() } as never, {} as never, {} as never, {} as never, {} as never, { record: jest.fn() } as never);
    const handle = jest.spyOn(service as never, 'handleRevenueCatEvent' as never).mockResolvedValue({ received: true } as never);
    const logger = (service as never as { logger: { warn: () => void; error: () => void } }).logger;
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((async (url: string) => {
      if (String(url).includes('api.revenuecat.com')) return { ok: true, status: 200, json: async () => ({ subscriber: { subscriptions: rcSubs } }) };
      if (apple === 'fail') throw new Error('apple down');
      return { ok: apple.status < 300, status: apple.status, json: async () => apple.body };
    }) as never);
    return { service, handle, fetchMock };
  }
  const storeUser = (extra: Record<string, unknown> = {}) => ({ accountStatus: 'active', subscriptionStatus: 'active', subscriptionProvider: 'revenuecat', subscriptionManualOverride: false, subscriptionCancelRequestedAt: null, studentCode: 1, cpf: null, ...extra });
  const rcLive = { p: { expires_date: future(), store: 'app_store', is_sandbox: true, store_transaction_id: '2000', product_identifier: 'panzeri_run_mensal' } };
  const env = (): Env => ({ REVENUECAT_SECRET_API_KEY: 'sk_teste', APPLE_IAP_KEY_ID: 'KEY123', APPLE_IAP_ISSUER_ID: 'iss', APPLE_IAP_PRIVATE_KEY: pem });
  const appleCalls = (t: { fetchMock: jest.SpyInstance }) => t.fetchMock.mock.calls.filter((c) => String(c[0]).includes('storekit'));

  it('RevenueCat diz vigente, mas a Apple confirma EXPIRADA: encerra o acesso (caso real do aluno de teste)', async () => {
    const t = build(storeUser(), env(), rcLive, { status: 200, body: appleBody(2) });
    expect(await t.service.syncStoreSubscription('u1')).toEqual({ status: 'inactive', store: null });
    expect(t.handle).toHaveBeenCalledWith({ type: 'EXPIRATION', app_user_id: 'u1' });
    expect(String(appleCalls(t)[0][0])).toContain('api.storekit-sandbox.itunes.apple.com/inApps/v1/subscriptions/2000');
  });

  it('Apple diz ativa (inclusive cancelada com acesso vigente, tolerancia e nova tentativa): mantem o acesso', async () => {
    for (const status of [1, 3, 4]) {
      const t = build(storeUser(), env(), rcLive, { status: 200, body: appleBody(status) });
      const logs: string[] = [];
      jest.spyOn((t.service as never as { logger: { log: (m: string) => void } }).logger, 'log').mockImplementation((m: string) => { logs.push(m); });
      await t.service.syncStoreSubscription('u1');
      expect(t.handle).not.toHaveBeenCalled();
      expect(logs).toContainEqual(expect.stringContaining('veredito=active'));
    }
  });

  it('falha ou resposta inconclusiva da Apple: preserva o resultado do RevenueCat e nunca expira', async () => {
    for (const apple of ['fail', { status: 500 }, { status: 401 }, { status: 404 }, { status: 200, body: {} }] as const) {
      const t = build(storeUser(), env(), rcLive, apple as never);
      expect(await t.service.syncStoreSubscription('u1')).toMatchObject({ status: 'active' });
      expect(t.handle).not.toHaveBeenCalled();
    }
  });

  it('sem credenciais da Apple: comportamento anterior, nenhuma chamada a Apple; assinatura que nao e da App Store ou sem id de transacao tambem nao consulta', async () => {
    const none = build(storeUser(), { REVENUECAT_SECRET_API_KEY: 'sk_teste' }, rcLive, { status: 200, body: appleBody(2) });
    const noneLogs: string[] = [];
    jest.spyOn((none.service as never as { logger: { log: (m: string) => void } }).logger, 'log').mockImplementation((m: string) => { noneLogs.push(m); });
    await none.service.syncStoreSubscription('u1');
    await none.service.syncStoreSubscription('u1');
    expect(noneLogs.filter((m) => m.includes('desativada'))).toHaveLength(1); // avisa uma vez so
    expect(appleCalls(none)).toHaveLength(0);
    expect(none.handle).not.toHaveBeenCalled();
    for (const sub of [{ p: { ...rcLive.p, store: 'play_store' } }, { p: { ...rcLive.p, store_transaction_id: null } }]) {
      const t = build(storeUser(), env(), sub, { status: 200, body: appleBody(2) });
      await t.service.syncStoreSubscription('u1');
      expect(appleCalls(t)).toHaveLength(0);
      expect(t.handle).not.toHaveBeenCalled();
    }
  });

  it('a Apple nao concede nem recupera acesso: conta cancelada com RevenueCat vigente e Apple expirada continua cancelada; protecoes mantidas', async () => {
    const canceled = build(storeUser({ subscriptionStatus: 'canceled' }), env(), rcLive, { status: 200, body: appleBody(2) });
    await canceled.service.getMine('u1');
    expect(canceled.handle).not.toHaveBeenCalled();
    for (const user of [storeUser({ subscriptionStatus: 'manual_active' }), storeUser({ subscriptionManualOverride: true }), storeUser({ subscriptionProvider: 'asaas' })]) {
      const t = build(user, env(), rcLive, { status: 200, body: appleBody(2) });
      await t.service.getMine('u1');
      expect(t.handle).not.toHaveBeenCalled();
    }
  });

  it('leitura de /billing/me e rotina usam a verificacao: Apple expirada derruba o acesso; webhook EXPIRATION so revoga com Apple/RevenueCat confirmando', async () => {
    const read = build(storeUser(), env(), rcLive, { status: 200, body: appleBody(2) });
    await read.service.getMine('u1');
    expect(read.handle).toHaveBeenCalledWith({ type: 'EXPIRATION', app_user_id: 'u1' });
    // webhook EXPIRATION atrasado: RevenueCat vigente + Apple ativa => ignora; RevenueCat vigente + Apple expirada => revoga
    const e = { ...env(), REVENUECAT_WEBHOOK_SECRET: 'wh' };
    const ignored = build(storeUser(), e, rcLive, { status: 200, body: appleBody(1) });
    expect(await ignored.service.processRevenueCatWebhook('Bearer wh', { event: { type: 'EXPIRATION', app_user_id: 'u1' } })).toEqual({ received: true, expirationIgnored: 'active' });
    expect(ignored.handle).not.toHaveBeenCalled();
    const revoked = build(storeUser(), e, rcLive, { status: 200, body: appleBody(2) });
    await revoked.service.processRevenueCatWebhook('Bearer wh', { event: { type: 'EXPIRATION', app_user_id: 'u1' } });
    expect(revoked.handle).toHaveBeenCalledWith({ type: 'EXPIRATION', app_user_id: 'u1' });
  });
});
