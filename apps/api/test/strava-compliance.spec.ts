import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { STRAVA_CACHE_TTL_MS, STRAVA_SCOPE, StravaService } from '../src/strava/strava.service';
import { decryptToken, encryptToken, isEncryptedToken, parseTokenKey } from '../src/common/token-crypto';
import { postRestoreSafeguard } from '../src/backup/backup-restore';
import { BACKUP_EXCLUDED_TABLE_DATA } from '../src/backup/backup.service';

// Strava compliance (05/10/2026): OAuth com tentativa unica, tokens cifrados, webhook (sem assinatura oficial), desconexao,
// exclusao, retencao de 7 dias e isolamento (nada de Strava no treinador/Admin nem na IA). Sem rede nem Postgres reais.

type Row = Record<string, any>;
const KEY_HEX = 'cd'.repeat(32);
const KEY = parseTokenKey(KEY_HEX);
const ENV: Record<string, string | undefined> = {
  STRAVA_CLIENT_ID: 'cid', STRAVA_CLIENT_SECRET: 'csecret', STRAVA_REDIRECT_URI: 'https://api.test/strava/callback',
  STRAVA_WEBHOOK_VERIFY_TOKEN: 'vt-secreto-de-teste', STRAVA_TOKEN_ENCRYPTION_KEY: KEY_HEX, APP_PUBLIC_URL: 'https://api.test',
};
const U = 'user-1';
const OTHER = 'user-2';
const SUB_ID = 777;

const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, cond]) => {
  const value = row[k] ?? null;
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('gt' in cond) return value > cond.gt;
    if ('lt' in cond) return value < cond.lt;
    if ('not' in cond) return value !== cond.not;
  }
  return value === (cond ?? null);
});

function makeDb(seed: Record<string, Row[]> = {}) {
  const t: Record<string, Row[]> = { ...Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))])) };
  const rows = (n: string) => (t[n] ??= []);
  let seq = 0;
  const delegate = (name: string) => ({
    findUnique: async ({ where }: { where: Row }) => { const r = rows(name).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) => { const hit = rows(name).filter((x) => matches(x, where)); if (orderBy?.startDate === 'desc') hit.sort((a, b) => +b.startDate - +a.startDate); return hit[0] ? { ...hit[0] } : null; },
    findMany: async ({ where }: { where?: Row } = {}) => rows(name).filter((x) => matches(x, where)).map((r) => ({ ...r })),
    create: async ({ data }: { data: Row }) => {
      if (name === 'stravaWebhookEvent' && rows(name).some((r) => r.dedupeKey === data.dedupeKey)) {
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
      }
      const r = { id: `gen-${++seq}`, createdAt: new Date(), ...data }; rows(name).push(r); return r;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows(name).find((x) => matches(x, where))!; return Object.assign(r, data); },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => { const hit = rows(name).filter((x) => matches(x, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const r = rows(name).find((x) => matches(x, where));
      if (r) return Object.assign(r, update);
      const n = { id: `gen-${++seq}`, createdAt: new Date(), ...create }; rows(name).push(n); return n;
    },
    deleteMany: async ({ where }: { where?: Row } = {}) => { const before = rows(name).length; t[name] = rows(name).filter((x) => !matches(x, where)); return { count: before - t[name].length }; },
  });
  const prisma: any = new Proxy({ $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma) } as Record<string, unknown>, { get: (target, prop: string) => (prop in target ? target[prop] : delegate(prop)) });
  return { prisma, t };
}

function tokenResponse(overrides: Row = {}) {
  return { access_token: 'acc-novo', refresh_token: 'ref-novo', expires_at: Math.floor(Date.now() / 1000) + 21600, athlete: { id: 4242 }, ...overrides };
}

function mockFetch(routes: Array<[RegExp, (url: string, init?: RequestInit) => unknown]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find(([re]) => re.test(url));
    const body = route ? route[1](url, init) : { error: 'sem rota' };
    return { ok: !(body as Row)?.__status, status: (body as Row)?.__status ?? 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  }) as never;
  return calls;
}

function build(seed: Record<string, Row[]> = {}, env: Record<string, string | undefined> = ENV) {
  const db = makeDb(seed);
  const service = new StravaService(db.prisma, { get: (n: string) => env[n] } as never);
  return { service, ...db };
}
const stateFrom = (url: string) => new URL(url).searchParams.get('state')!;
const baseRoutes: Array<[RegExp, (url: string, init?: RequestInit) => unknown]> = [
  [/push_subscriptions/, () => [{ id: SUB_ID }]],
  [/oauth\/token/, () => tokenResponse()],
  [/athlete\/activities/, () => []],
];

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

describe('OAuth Strava', () => {
  beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => undefined); });

  it('conexao valida: state aleatorio com hash no banco, so o escopo necessario, tokens cifrados em repouso', async () => {
    const { service, t } = build({ user: [{ id: U }] });
    const calls = mockFetch(baseRoutes);
    const { url } = await service.connectUrl(U);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toBe(STRAVA_SCOPE);
    expect(STRAVA_SCOPE).toBe('activity:read_all');
    const state = stateFrom(url);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).not.toContain(U);
    expect(t.stravaOAuthAttempt[0].stateHash).toBe(createHash('sha256').update(state).digest('hex'));
    expect(JSON.stringify(t.stravaOAuthAttempt)).not.toContain(state);

    await expect(service.callback({ state, code: 'abc', scope: 'read activity:read_all' })).resolves.toContain('Strava conectado');
    const connection = t.stravaConnection[0];
    expect(connection.userId).toBe(U);
    expect(isEncryptedToken(connection.accessToken) && isEncryptedToken(connection.refreshToken)).toBe(true);
    expect(JSON.stringify(connection)).not.toMatch(/acc-novo|ref-novo/);
    expect(decryptToken(connection.accessToken, KEY)).toBe('acc-novo');
    expect(decryptToken(connection.refreshToken, KEY)).toBe('ref-novo');
    expect(calls.filter((c) => /oauth\/token/.test(c.url))).toHaveLength(1);
  });

  it('state invalido, desconhecido e expirado sao recusados sem trocar o code', async () => {
    const { service, t } = build({ user: [{ id: U }] });
    const calls = mockFetch(baseRoutes);
    await expect(service.callback({ state: 'curto', code: 'x', scope: STRAVA_SCOPE })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.callback({ state: U, code: 'x', scope: STRAVA_SCOPE })).rejects.toBeInstanceOf(BadRequestException); // o antigo state=userId nao vale mais
    await expect(service.callback({ state: 'a'.repeat(43), code: 'x', scope: STRAVA_SCOPE })).rejects.toBeInstanceOf(BadRequestException);
    const state = stateFrom((await service.connectUrl(U)).url);
    t.stravaOAuthAttempt[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.callback({ state, code: 'x', scope: STRAVA_SCOPE })).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.some((c) => /oauth\/token/.test(c.url))).toBe(false);
    expect(t.stravaConnection ?? []).toHaveLength(0);
  });

  it('replay do mesmo state NAO e sucesso e nao repete a troca do code', async () => {
    const { service, t } = build({ user: [{ id: U }] });
    const calls = mockFetch(baseRoutes);
    const state = stateFrom((await service.connectUrl(U)).url);
    await service.callback({ state, code: 'abc', scope: STRAVA_SCOPE });
    await expect(service.callback({ state, code: 'abc', scope: STRAVA_SCOPE })).rejects.toThrow('ja foi utilizada');
    expect(calls.filter((c) => /oauth\/token/.test(c.url))).toHaveLength(1);
    expect(t.stravaConnection).toHaveLength(1);
  });

  it('escopo concedido insuficiente, cancelamento e conta Strava de outro aluno: nada e gravado', async () => {
    const { service, t } = build({ user: [{ id: U }, { id: OTHER }], stravaConnection: [{ userId: OTHER, athleteId: '4242', accessToken: 'x', refreshToken: 'y', expiresAt: new Date() }] });
    const calls = mockFetch(baseRoutes);
    let state = stateFrom((await service.connectUrl(U)).url);
    await expect(service.callback({ state, code: 'abc', scope: 'read' })).rejects.toThrow('leitura das suas atividades');
    state = stateFrom((await service.connectUrl(U)).url);
    await expect(service.callback({ state, error: 'access_denied' })).rejects.toBeInstanceOf(BadRequestException);
    state = stateFrom((await service.connectUrl(U)).url);
    await expect(service.callback({ state, code: 'abc', scope: STRAVA_SCOPE })).rejects.toThrow('outro aluno'); // athlete 4242 ja e do OTHER
    expect(t.stravaConnection.map((c) => c.userId)).toEqual([OTHER]);
    expect(calls.filter((c) => /oauth\/token/.test(c.url))).toHaveLength(1); // so' a do ultimo caso (escopo ok)
  });

  it('sem chave de cifra o servico nao inicia autorizacao (nunca grava token em texto)', async () => {
    const { service } = build({ user: [{ id: U }] }, { ...ENV, STRAVA_TOKEN_ENCRYPTION_KEY: undefined });
    await expect(service.connectUrl(U)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refresh token: renova com o refresh decifrado e regrava os novos tokens cifrados', async () => {
    const { service, t } = build({
      user: [{ id: U }],
      stravaConnection: [{ userId: U, athleteId: '4242', accessToken: encryptToken('acc-velho', KEY), refreshToken: encryptToken('ref-velho', KEY), expiresAt: new Date(Date.now() - 1000) }],
    });
    const calls = mockFetch([[/oauth\/token/, () => tokenResponse({ access_token: 'acc-2', refresh_token: 'ref-2' })], ...baseRoutes]);
    await service.sync(U);
    const body = String((calls.find((c) => /oauth\/token/.test(c.url))!.init!.body as URLSearchParams));
    expect(body).toContain('refresh_token=ref-velho');
    expect(decryptToken(t.stravaConnection[0].accessToken, KEY)).toBe('acc-2');
    expect(decryptToken(t.stravaConnection[0].refreshToken, KEY)).toBe('ref-2');
    expect(JSON.stringify(t.stravaConnection)).not.toMatch(/acc-2|ref-2|ref-velho/);
    const activities = calls.find((c) => /athlete\/activities/.test(c.url))!;
    expect((activities.init!.headers as Record<string, string>).Authorization).toBe('Bearer acc-2');
  });

  it('tokens antigos em texto migram para cifrados sem quebrar quem ja esta conectado', async () => {
    const future = new Date(Date.now() + 3 * 3600_000);
    const { service, t } = build({ user: [{ id: U }], stravaConnection: [{ userId: U, athleteId: '4242', accessToken: 'plano-acc', refreshToken: 'plano-ref', expiresAt: future }] });
    mockFetch(baseRoutes);
    await service.sync(U); // uso normal com token legado funciona e ja regrava cifrado
    expect(isEncryptedToken(t.stravaConnection[0].accessToken)).toBe(true);
    expect(decryptToken(t.stravaConnection[0].accessToken, KEY)).toBe('plano-acc');
    t.stravaConnection[0].refreshToken = 'plano-ref-2';
    t.stravaConnection[0].accessToken = 'plano-acc-2';
    expect(await service.migrateLegacyTokens()).toEqual({ migrated: 1 });
    expect(decryptToken(t.stravaConnection[0].refreshToken, KEY)).toBe('plano-ref-2');
    expect(await service.migrateLegacyTokens()).toEqual({ migrated: 0 }); // idempotente
  });
});

describe('webhook Strava (sem assinatura oficial)', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const event = (over: Row = {}) => ({ object_type: 'activity', object_id: 99, aspect_type: 'create', owner_id: 4242, subscription_id: SUB_ID, event_time: now(), updates: {}, ...over });
  const connected = () => build({
    user: [{ id: U }, { id: OTHER }],
    stravaConnection: [{ userId: U, athleteId: '4242', accessToken: encryptToken('acc', KEY), refreshToken: encryptToken('ref', KEY), expiresAt: new Date(Date.now() + 3 * 3600_000) }],
  });
  const routes = () => mockFetch([...baseRoutes, [/activities\/99/, () => ({ id: 99, name: 'Corrida', sport_type: 'Run', start_date: new Date().toISOString(), distance: 5000, moving_time: 1500 })]]);

  it('verificacao GET exige verify token configurado, sem valor padrao, e compara o valor', () => {
    const { service } = build({}, { ...ENV, STRAVA_WEBHOOK_VERIFY_TOKEN: undefined });
    expect(() => service.verifyWebhook('subscribe', 'c', 'panzeri-run-strava-webhook-2026')).toThrow(ServiceUnavailableException);
    const ok = build();
    expect(ok.service.verifyWebhook('subscribe', 'desafio', ENV.STRAVA_WEBHOOK_VERIFY_TOKEN!)).toEqual({ 'hub.challenge': 'desafio' });
    expect(() => ok.service.verifyWebhook('subscribe', 'desafio', 'panzeri-run-strava-webhook-2026')).toThrow(BadRequestException);
    expect(() => ok.service.verifyWebhook('subscribe', 'desafio', 'vt-secreto-de-teste-x')).toThrow(BadRequestException);
    expect(() => ok.service.verifyWebhook('unsubscribe', 'desafio', ENV.STRAVA_WEBHOOK_VERIFY_TOKEN!)).toThrow(BadRequestException);
    const source = readFileSync(join(__dirname, '../src/strava/strava.service.ts'), 'utf8');
    expect(source).not.toContain('panzeri-run-strava-webhook-2026'); // fallback inseguro removido
  });

  it('evento valido: rebusca a atividade na API, grava com fetchedAt e responde idempotente a duplicata', async () => {
    const { service, t } = connected();
    routes();
    expect(await service.handleWebhook(event())).toBe('processed');
    expect(t.stravaActivity).toHaveLength(1);
    expect(t.stravaActivity[0].fetchedAt).toBeInstanceOf(Date);
    expect(await service.handleWebhook(event())).toBe('duplicate'); // reenvio do Strava (ate 3x) nao reprocessa
    expect(t.stravaActivity).toHaveLength(1);
    expect(t.stravaWebhookEvent).toHaveLength(1);
  });

  it('formato invalido, inscricao de outro app, evento antigo/futuro e dono desconhecido sao ignorados sem efeito', async () => {
    const { service, t } = connected();
    const calls = routes();
    expect(await service.handleWebhook(event({ object_type: 'club' }))).toBe('ignored');
    expect(await service.handleWebhook(event({ object_id: '99' }))).toBe('ignored');
    expect(await service.handleWebhook(event({ subscription_id: 1 }))).toBe('ignored'); // nao e' a nossa inscricao
    expect(await service.handleWebhook(event({ event_time: now() - 3 * 86400 }))).toBe('ignored'); // replay antigo
    expect(await service.handleWebhook(event({ event_time: now() + 3600 }))).toBe('ignored');
    expect(await service.handleWebhook(event({ owner_id: 5555 }))).toBe('ignored'); // atleta sem conexao
    expect(await service.handleWebhook(null as never)).toBe('ignored');
    expect(t.stravaActivity ?? []).toHaveLength(0);
    expect(calls.some((c) => /activities\/99/.test(c.url))).toBe(false);
  });

  it('evento delete remove so a atividade do dono do evento (nunca de outro aluno)', async () => {
    const { service, t } = connected();
    routes();
    t.stravaActivity = [{ id: 'a1', userId: U, stravaId: '99' }, { id: 'a2', userId: OTHER, stravaId: '99' }];
    expect(await service.handleWebhook(event({ aspect_type: 'delete', event_time: now() }))).toBe('processed');
    expect(t.stravaActivity.map((a) => a.id)).toEqual(['a2']);
  });

  it('desautorizacao (athlete authorized=false): apaga toda a cadeia Strava do aluno, preserva o resto e audita', async () => {
    const { service, t } = connected();
    routes();
    t.stravaActivity = [{ id: 'a1', userId: U, stravaId: '1' }, { id: 'a2', userId: OTHER, stravaId: '2' }];
    t.stravaAnalysisCache = [{ userId: U, analysis: { x: 1 } }, { userId: OTHER, analysis: { x: 2 } }];
    t.trainingExecutionInsight = [{ id: 'i1', userId: U }, { id: 'i2', userId: OTHER }];
    t.polarConnection = [{ userId: U, accessTokenEncrypted: 'v1:polar' }];
    t.activityLog = [{ id: 'log1', userId: U, provider: 'polar' }];
    expect(await service.handleWebhook(event({ object_type: 'athlete', object_id: 4242, aspect_type: 'update', updates: { authorized: 'false' } }))).toBe('processed');
    expect(t.stravaConnection ?? []).toHaveLength(0);
    expect(t.stravaActivity.map((a) => a.id)).toEqual(['a2']);
    expect(t.stravaAnalysisCache.map((a) => a.userId)).toEqual([OTHER]);
    expect(t.trainingExecutionInsight.map((a) => a.id)).toEqual(['i2']);
    expect(t.polarConnection).toHaveLength(1); // Polar intacta
    expect(t.activityLog).toHaveLength(1);
    expect(t.providerConnectionEvent[0]).toMatchObject({ userId: U, provider: 'strava', type: 'strava_deauthorized' });
    // reenvio do mesmo evento de desautorizacao e' duplicata
    expect(await service.handleWebhook(event({ object_type: 'athlete', object_id: 4242, aspect_type: 'update', updates: { authorized: 'false' } }))).toBe('duplicate');
  });

  it('o controller nao dispensa mais o throttle do webhook e responde 200', () => {
    const controller = readFileSync(join(__dirname, '../src/strava/strava.controller.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    expect(controller).not.toContain('SkipThrottle');
    expect(controller.match(/@Throttle\(/g)).toHaveLength(2);
    expect(controller).toContain('@HttpCode(200)');
  });
});

describe('desconexao, exclusao e retencao', () => {
  const seeded = () => build({
    user: [{ id: U }, { id: OTHER }],
    stravaConnection: [
      { userId: U, athleteId: '4242', accessToken: encryptToken('acc-U', KEY), refreshToken: encryptToken('ref-U', KEY), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: OTHER, athleteId: '9', accessToken: encryptToken('acc-O', KEY), refreshToken: encryptToken('ref-O', KEY), expiresAt: new Date(Date.now() + 3600_000) },
    ],
    stravaActivity: [{ id: 'a1', userId: U, stravaId: '1', fetchedAt: new Date() }, { id: 'a2', userId: OTHER, stravaId: '2', fetchedAt: new Date() }],
    stravaAnalysisCache: [{ userId: U, analysis: { a: 1 } }],
    trainingExecutionInsight: [{ id: 'i1', userId: U }],
    stravaOAuthAttempt: [{ stateHash: 'h', userId: U, expiresAt: new Date(Date.now() + 1000) }],
    polarConnection: [{ userId: U, accessTokenEncrypted: 'v1:polar', disconnectedAt: null }],
    activityLog: [{ id: 'log1', userId: U, provider: 'polar' }],
  });

  it('desconectar para a coleta na hora, apaga a cadeia Strava, revoga no Strava (/oauth/revoke) e preserva Polar e outros alunos', async () => {
    const { service, t } = seeded();
    const calls = mockFetch([[/oauth\/revoke/, () => ({})]]);
    const result = await service.disconnect(U);
    expect(result).toMatchObject({ status: 'disconnected', stravaRevocation: 'revoked', deleted: { activities: 1, analysisCaches: 1, executionInsights: 1, oauthAttempts: 1, connections: 1 } });
    expect(t.stravaConnection.map((c) => c.userId)).toEqual([OTHER]);
    expect(t.stravaActivity.map((a) => a.id)).toEqual(['a2']);
    expect(t.polarConnection).toHaveLength(1);
    expect(t.polarConnection[0].disconnectedAt).toBeNull();
    expect(t.activityLog).toHaveLength(1);
    const revoke = calls.find((c) => /oauth\/revoke/.test(c.url))!;
    expect(String(revoke.init!.body)).toContain('token=acc-U');
    expect((revoke.init!.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(JSON.stringify(t.providerConnectionEvent)).not.toMatch(/acc-U|ref-U/);
    // sem coleta: a sincronizacao deste aluno agora recusa
    await expect(service.sync(U)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('falha ao revogar no Strava nao desfaz a revogacao local; repetir e idempotente', async () => {
    const { service, t } = seeded();
    mockFetch([[/oauth\/revoke/, () => ({ __status: 500 })]]);
    expect((await service.disconnect(U)).stravaRevocation).toBe('failed');
    expect(t.stravaConnection.map((c) => c.userId)).toEqual([OTHER]);
    const again = await service.disconnect(U);
    expect(again).toMatchObject({ status: 'not_connected', deleted: { connections: 0, activities: 0 } });
    expect(t.stravaConnection.map((c) => c.userId)).toEqual([OTHER]);
  });

  it('retencao: cache vale 7 dias desde a ultima busca; expira atividades antigas e derivados residuais', async () => {
    expect(STRAVA_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const { service, t } = seeded();
    const day = 86400_000;
    t.stravaActivity = [
      { id: 'velha', userId: U, stravaId: '1', fetchedAt: new Date(Date.now() - 8 * day) },
      { id: 'limite', userId: U, stravaId: '2', fetchedAt: new Date(Date.now() - 6 * day) },
      { id: 'nova', userId: OTHER, stravaId: '3', fetchedAt: new Date() },
    ];
    t.stravaWebhookEvent = [{ dedupeKey: 'old', receivedAt: new Date(Date.now() - 9 * day) }, { dedupeKey: 'new', receivedAt: new Date() }];
    const result = await service.purgeExpiredData();
    expect(result).toEqual({ activities: 1 });
    expect(t.stravaActivity.map((a) => a.id).sort()).toEqual(['limite', 'nova']);
    expect(t.stravaWebhookEvent.map((e) => e.dedupeKey)).toEqual(['new']);
    expect(t.trainingExecutionInsight).toEqual([]);
    expect(t.stravaAnalysisCache).toEqual([]);
  });

  it('a migration elimina o que passou do prazo e limpa derivados Strava existentes', () => {
    const sql = readFileSync(join(__dirname, '../prisma/migrations/20261005200000_strava_compliance/migration.sql'), 'utf8');
    expect(sql).toContain('DELETE FROM "StravaActivity" WHERE "fetchedAt" < NOW() - INTERVAL \'7 days\'');
    expect(sql).toContain('DELETE FROM "TrainingExecutionInsight"');
    expect(sql).toContain('UPDATE "StravaAnalysisCache" SET "analysis" = NULL');
    expect(sql).toMatch(/stravaRunMinutes[\s\S]*stravaAnalysis/);
    expect(sql).toContain('Dados do Strava');
  });

  it('backup: dados Strava nao entram nos dumps e a restauracao os purga (fail-closed)', async () => {
    expect(BACKUP_EXCLUDED_TABLE_DATA).toEqual(expect.arrayContaining(['StravaActivity', 'StravaConnection', 'StravaAnalysisCache', 'TrainingExecutionInsight']));
    const source = readFileSync(join(__dirname, '../src/backup/backup.service.ts'), 'utf8');
    expect(source).toContain('--exclude-table-data=');
    const { t, prisma } = seeded();
    prisma.polarConnection.updateMany = async () => ({ count: 0 });
    await postRestoreSafeguard(prisma);
    expect(t.stravaConnection).toEqual([]);
    expect(t.stravaActivity).toEqual([]);
    expect(t.stravaAnalysisCache).toEqual([]);
    expect(t.trainingExecutionInsight).toEqual([]);
  });
});

describe('isolamento: nada de Strava no treinador/Admin nem na IA', () => {
  const SRC = join(__dirname, '../src');
  const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  const walk = (dir: string, out: string[] = []) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.ts')) out.push(p); } return out; };
  const rel = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, '/');

  it('so os arquivos autorizados tocam as tabelas/servico Strava (qualquer novo uso quebra este teste)', () => {
    const pattern = /stravaActivity|stravaAnalysisCache|trainingExecutionInsight|stravaConnection|stravaOAuthAttempt|stravaWebhookEvent|StravaService|StravaModule/;
    const touching = walk(SRC).filter((f) => pattern.test(stripComments(readFileSync(f, 'utf8')))).map(rel).sort();
    expect(touching).toEqual([
      'account-deletion/account-deletion.service.ts', // apaga as tabelas (exclusao de conta)
      'app.module.ts', // registra o modulo
      'backup/backup-restore.ts', // purga apos restauracao
      'coach/coach.service.ts', // so' o booleano "conectado" da lista (estado da integracao, nao dado do Strava)
      'integrations/integrations.service.ts', // so' o booleano "conectado" do proprio aluno no catalogo (select id; nenhum dado do Strava)
      'strava/strava-data-deletion.ts',
      'strava/strava.controller.ts',
      'strava/strava.module.ts',
      'strava/strava.service.ts',
    ]);
  });

  it('coach.service so le o estado de conexao; nenhuma atividade, resumo ou analise Strava', () => {
    const code = stripComments(readFileSync(join(SRC, 'coach/coach.service.ts'), 'utf8'));
    expect(code).not.toMatch(/stravaActivity\b|trainingExecutionInsight|serializeStravaActivity|unmatchedStrava|analyzeStudentStrava/);
    expect([...code.matchAll(/prisma\.strava\w+/g)].map((m) => m[0])).toEqual(['prisma.stravaConnection']);
    const detail = code.slice(code.indexOf('async student('), code.indexOf('async student(') + 20000);
    expect(detail).not.toMatch(/stravaStatus|analysisAgent/);
    const controller = stripComments(readFileSync(join(SRC, 'coach/coach.controller.ts'), 'utf8'));
    expect(controller).not.toMatch(/strava\/analyze|analyzeStudentStrava/i);
    const admin = readFileSync(join(__dirname, '../../admin/app/page.tsx'), 'utf8');
    expect(admin).not.toMatch(/StravaActivity|stravaActivity|unmatchedStrava|Km Strava|Atividade recebida do Strava/);
  });

  it('IA: nenhum agente recebe atividades, derivados ou contexto Strava; agente de analise e agendador foram removidos', () => {
    expect(existsSync(join(SRC, 'training-plans/strava-analysis-agent.service.ts'))).toBe(false);
    expect(existsSync(join(SRC, 'training-plans/strava-analysis-scheduler.service.ts'))).toBe(false);
    for (const file of ['training-plans/training-plans.service.ts', 'training-plans/prescription-agent.service.ts', 'training-plans/training-methodology.ts', 'technical-manager/technical-manager-agent.service.ts', 'training-plans/weekly-checkin.service.ts']) {
      const code = stripComments(readFileSync(join(SRC, file), 'utf8'));
      expect(code).not.toMatch(/\bstrava/i); // nem tabela, nem campo de payload, nem texto de prompt
    }
    // nenhuma chamada de IA do repositorio usa dados Strava
    const aiFiles = walk(SRC).filter((f) => /api\.anthropic\.com|@anthropic-ai|new Anthropic/.test(readFileSync(f, 'utf8')));
    for (const f of aiFiles) expect(stripComments(readFileSync(f, 'utf8'))).not.toMatch(/\bstrava/i);
  });

  it('Gerente Tecnico nao tem mais ferramentas Strava e o check-in semanal conta so pelo registro do aluno', () => {
    const tm = readFileSync(join(SRC, 'technical-manager/technical-manager-agent.service.ts'), 'utf8');
    expect(tm).not.toMatch(/get_strava_report|set_strava_analysis_frequency/);
    const wc = stripComments(readFileSync(join(SRC, 'training-plans/weekly-checkin.service.ts'), 'utf8'));
    expect(wc).not.toMatch(/\.report\(/);
  });
});

describe('regressao: Polar e fundacao provider-agnostica nao foram alteradas', () => {
  it('nenhum arquivo de Polar, WorkoutDelivery, reconciliacao ou ActivityLog menciona Strava e todos seguem independentes', () => {
    const SRC = join(__dirname, '../src');
    const check = (dir: string) => readdirSync(join(SRC, dir)).filter((n) => n.endsWith('.ts') && !/provider-data-deletion/.test(n));
    for (const dir of ['polar', 'workout-delivery']) {
      for (const name of check(dir)) {
        const code = readFileSync(join(SRC, dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
        expect(code).not.toMatch(/stravaActivity|StravaService|stravaConnection/);
      }
    }
    // o servico de reconciliacao continua sem importar nada de provider especifico
    const link = readFileSync(join(SRC, 'activity-execution/session-execution-link.service.ts'), 'utf8');
    expect(link).not.toMatch(/from '\.\.\/(polar|strava)\//);
  });
});
