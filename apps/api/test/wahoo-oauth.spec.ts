import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProviderDataDeletionService } from '../src/activity-execution/provider-data-deletion.service';
import { isWahooEnabledFor } from '../src/wahoo/wahoo-access';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { WahooService } from '../src/wahoo/wahoo.service';
import { WahooController } from '../src/wahoo/wahoo.controller';
import { decryptSecret } from '../src/wahoo/wahoo-crypto';

const redirectUri = 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host/wahoo/callback';
const KEY = 'cd'.repeat(32);
const baseSettings: Record<string, string> = {
  WAHOO_CLIENT_ID: 'wahoo-client-id',
  WAHOO_CLIENT_SECRET: 'wahoo-client-secret-VALUE',
  WAHOO_REDIRECT_URI: redirectUri,
  WAHOO_TOKEN_ENCRYPTION_KEY: KEY,
  WAHOO_ENABLED_USER_IDS: 'user-a,user-b',
  POLAR_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
  STRAVA_TOKEN_ENCRYPTION_KEY: 'ef'.repeat(32),
};

type Row = Record<string, any>;

function fixture(overrides: Record<string, string | undefined> = {}) {
  const attempts = new Map<string, Row>();
  const connections = new Map<string, Row>(); // por userId
  const events: Row[] = [];
  const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([field, cond]) => {
    if (field === 'OR') return (cond as Row[]).some((c) => matches(row, c));
    const value = row[field];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('lt' in cond) return value != null && value < cond.lt;
      if ('gt' in cond) return value != null && value > cond.gt;
    }
    return cond === null ? value == null : value === cond;
  });
  const prisma = {
    user: { findUnique: jest.fn(async ({ where }: Row) => ({ id: where.id })) },
    wahooOAuthAttempt: {
      create: jest.fn(async ({ data }: Row) => { attempts.set(data.stateHash, { ...data, consumedAt: null }); }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const attempt = attempts.get(where.stateHash);
        if (!attempt || attempt.consumedAt || attempt.expiresAt <= where.expiresAt.gt) return { count: 0 };
        Object.assign(attempt, data);
        return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where }: Row) => attempts.get(where.stateHash) ?? null),
    },
    wahooConnection: {
      findUnique: jest.fn(async ({ where, select }: Row) => {
        const row = where.userId !== undefined ? connections.get(where.userId) : [...connections.values()].find((c) => c.wahooUserId === where.wahooUserId);
        if (!row) return null;
        if (!select) return { ...row };
        return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
      }),
      upsert: jest.fn(async ({ where, create, update }: Row) => {
        const existing = connections.get(where.userId);
        const row = existing ? Object.assign(existing, update) : { id: `c-${where.userId}`, createdAt: new Date(), ...create };
        connections.set(where.userId, row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const hit = [...connections.values()].filter((c) => matches(c, where));
        hit.forEach((c) => Object.assign(c, data));
        return { count: hit.length };
      }),
    },
    providerConnectionEvent: { create: jest.fn(async ({ data }: Row) => { events.push(data); }) },
  };
  const settings = { ...baseSettings, ...overrides };
  const config = { get: jest.fn((name: string) => settings[name]) };
  const providerData = { recordDisconnection: jest.fn(async () => undefined) };
  const service = new WahooService(prisma as unknown as PrismaService, config as unknown as ConfigService, providerData as never);
  jest.spyOn(service as never, 'sleep').mockResolvedValue(undefined as never);
  return { service, prisma, attempts, connections, events, providerData };
}

const stateFrom = (url: string) => new URL(url).searchParams.get('state')!;
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const tokenBody = (n: number) => ({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 7200 });

describe('Wahoo OAuth (Etapa 3)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  // Roteia as chamadas de rede por URL e registra cada uma (corpo/headers) para as asserções.
  function network(handlers: { token?: () => unknown; user?: () => unknown; permissions?: () => unknown }) {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = [];
    global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
      const href = String(url);
      const call = { url: href, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      if (href.endsWith('/oauth/token')) return (handlers.token ?? (() => json(200, tokenBody(1))))();
      if (href.endsWith('/v1/user')) return (handlers.user ?? (() => json(200, { id: 4242 })))();
      if (href.endsWith('/v1/permissions')) return (handlers.permissions ?? (() => json(200, {})))();
      throw new Error(`rede inesperada: ${href}`);
    }) as unknown as typeof fetch;
    return calls;
  }

  describe('autorizacao: state aleatorio, hash, expiracao, PKCE S256', () => {
    it('gera state opaco so com hash no banco, verifier PKCE cifrado e challenge S256 coerente', async () => {
      const { service, attempts } = fixture();
      const { url } = await service.connectUrl('user-a');
      const parsed = new URL(url);
      const state = stateFrom(url);
      expect(parsed.origin + parsed.pathname).toBe('https://api.wahooligan.com/oauth/authorize');
      expect(parsed.searchParams.get('client_id')).toBe('wahoo-client-id');
      expect(parsed.searchParams.get('redirect_uri')).toBe(redirectUri);
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('scope')).toBe('user_read');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(state).not.toContain('user-a');
      const saved = attempts.get(createHash('sha256').update(state).digest('hex'))!;
      expect(saved.userId).toBe('user-a');
      expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(JSON.stringify([...attempts.keys()])).not.toContain(state);
      // O verifier nao esta em texto puro; decifrado, seu SHA-256 (base64url) e' exatamente o challenge enviado.
      expect(saved.codeVerifierEncrypted).toMatch(/^v1:/);
      const verifier = decryptSecret(saved.codeVerifierEncrypted, Buffer.from(KEY, 'hex'));
      expect(createHash('sha256').update(verifier).digest('base64url')).toBe(parsed.searchParams.get('code_challenge'));
      expect(url).not.toContain(verifier);
      expect(url).not.toContain('wahoo-client-secret-VALUE');
    });

    it('cada conexao usa state e verifier novos', async () => {
      const { service } = fixture();
      const a = new URL((await service.connectUrl('user-a')).url);
      const b = new URL((await service.connectUrl('user-a')).url);
      expect(a.searchParams.get('state')).not.toBe(b.searchParams.get('state'));
      expect(a.searchParams.get('code_challenge')).not.toBe(b.searchParams.get('code_challenge'));
    });

    it('sem configuracao completa, a Wahoo recusa iniciar (503)', async () => {
      for (const missing of ['WAHOO_CLIENT_ID', 'WAHOO_CLIENT_SECRET', 'WAHOO_REDIRECT_URI', 'WAHOO_TOKEN_ENCRYPTION_KEY']) {
        const { service } = fixture({ [missing]: undefined });
        await expect(service.connectUrl('user-a')).rejects.toBeInstanceOf(ServiceUnavailableException);
      }
    });

    it('chave de criptografia propria: recusa chave igual a da Polar ou do Strava; redirect precisa ser o callback https', async () => {
      await expect(fixture({ WAHOO_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32) }).service.connectUrl('user-a')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(fixture({ WAHOO_TOKEN_ENCRYPTION_KEY: 'ef'.repeat(32) }).service.connectUrl('user-a')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(fixture({ WAHOO_REDIRECT_URI: 'http://x.com/wahoo/callback' }).service.connectUrl('user-a')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(fixture({ WAHOO_REDIRECT_URI: 'https://x.com/outra/rota' }).service.connectUrl('user-a')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(fixture({ WAHOO_SCOPES: 'workouts_write' }).service.connectUrl('user-a')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('habilitacao controlada (validacao real)', () => {
    it('ids autenticados: so quem esta na lista conecta; vazio/ausente = ninguem; "*" = todos; espacos tolerados', () => {
      expect(isWahooEnabledFor('user-a, user-b', 'user-b')).toBe(true);
      expect(isWahooEnabledFor('user-a,user-b', 'user-c')).toBe(false);
      expect(isWahooEnabledFor('user-a', 'user')).toBe(false); // sem casamento parcial
      expect(isWahooEnabledFor(undefined, 'user-a')).toBe(false);
      expect(isWahooEnabledFor('', 'user-a')).toBe(false);
      expect(isWahooEnabledFor('  ', 'user-a')).toBe(false);
      expect(isWahooEnabledFor(',,', 'user-a')).toBe(false);
      expect(isWahooEnabledFor('*', 'user-z')).toBe(true);
      expect(isWahooEnabledFor('user-a', '')).toBe(false);
    });

    it('aluno nao habilitado: connect-url recusa (403) sem criar tentativa, sem tocar a rede e sem revelar a configuracao', async () => {
      const f = fixture({ WAHOO_ENABLED_USER_IDS: 'user-a', WAHOO_CLIENT_ID: undefined });
      const calls = network({});
      await expect(f.service.connectUrl('user-x')).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.attempts.size).toBe(0);
      expect(calls).toHaveLength(0);
    });

    it('credenciais configuradas mas sem lista: ninguem conecta (configurar nao libera)', async () => {
      const f = fixture({ WAHOO_ENABLED_USER_IDS: undefined });
      await expect(f.service.connectUrl('user-a')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a habilitacao retirada no meio do fluxo bloqueia o callback antes de qualquer troca de code', async () => {
      const f = fixture();
      const calls = network({});
      const state = stateFrom((await f.service.connectUrl('user-a')).url);
      (f.service as any).config.get = (name: string) => (name === 'WAHOO_ENABLED_USER_IDS' ? 'outro' : baseSettings[name]);
      await expect(f.service.callback({ state, code: 'c' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(calls).toHaveLength(0);
      expect(f.connections.size).toBe(0);
    });

    it('desconectar nunca depende da lista: quem ja tem conexao sempre consegue revogar', async () => {
      const f = fixture();
      network({});
      await f.service.callback({ state: stateFrom((await f.service.connectUrl('user-a')).url), code: 'c' });
      (f.service as any).config.get = (name: string) => (name === 'WAHOO_ENABLED_USER_IDS' ? undefined : baseSettings[name]);
      network({});
      await expect(f.service.disconnect('user-a')).resolves.toMatchObject({ status: 'disconnected', providerRevocation: 'revoked' });
    });
  });

  describe('conta ja conectada nao reconecta', () => {
    it('connect-url recusa (409) enquanto ha conexao ativa e volta a permitir apos desconectar', async () => {
      const f = fixture();
      network({});
      await f.service.callback({ state: stateFrom((await f.service.connectUrl('user-a')).url), code: 'c' });
      const attemptsBefore = f.attempts.size;
      await expect(f.service.connectUrl('user-a')).rejects.toBeInstanceOf(ConflictException);
      expect(f.attempts.size).toBe(attemptsBefore); // nenhuma tentativa nova
      network({});
      await f.service.disconnect('user-a');
      await expect(f.service.connectUrl('user-a')).resolves.toHaveProperty('url');
    });

    it('corrida: conexao criada em outra aba durante o fluxo => callback recusa (409), nao sobrescreve e nao revoga', async () => {
      const f = fixture();
      network({});
      const stateSlow = stateFrom((await f.service.connectUrl('user-a')).url); // fluxo aberto antes
      const stateFast = stateFrom((await f.service.connectUrl('user-a')).url);
      await f.service.callback({ state: stateFast, code: 'c1' }); // outra aba conclui primeiro
      const winner = decryptSecret(f.connections.get('user-a')!.accessTokenEncrypted, Buffer.from(KEY, 'hex'));
      const calls = network({ token: () => json(200, tokenBody(2)) });
      await expect(f.service.callback({ state: stateSlow, code: 'c2' })).rejects.toBeInstanceOf(ConflictException);
      expect(decryptSecret(f.connections.get('user-a')!.accessTokenEncrypted, Buffer.from(KEY, 'hex'))).toBe(winner);
      expect(calls.filter((c) => c.url.endsWith('/v1/permissions'))).toHaveLength(0);
    });
  });

  describe('inicializacao sem variaveis Wahoo', () => {
    it('o modulo sobe (DI resolve) sem nenhuma variavel Wahoo; so as operacoes recusam, nunca com excecao nao tratada', async () => {
      const prismaStub = { user: { findUnique: async () => ({ id: 'u' }) }, wahooConnection: { findUnique: async () => null }, providerConnectionEvent: { create: async () => undefined } };
      const moduleRef = await Test.createTestingModule({
        controllers: [WahooController],
        providers: [
          WahooService,
          { provide: PrismaService, useValue: prismaStub },
          { provide: ConfigService, useValue: { get: () => undefined } },
          { provide: ProviderDataDeletionService, useValue: { recordDisconnection: async () => undefined } },
        ],
      }).compile();
      const service = moduleRef.get(WahooService);
      await expect(service.connectUrl('u')).rejects.toBeInstanceOf(ForbiddenException); // sem lista: ninguem
      const withList = new WahooService(prismaStub as never, { get: (n: string) => (n === 'WAHOO_ENABLED_USER_IDS' ? 'u' : undefined) } as never);
      await expect(withList.connectUrl('u')).rejects.toBeInstanceOf(ServiceUnavailableException); // lista, mas sem credenciais
      expect(await service.status('u')).toEqual({ connected: false, connectedAt: null, disconnectedAt: null });
      await expect(service.disconnect('u')).resolves.toEqual({ status: 'not_connected', providerRevocation: 'skipped' });
    });
  });

  describe('isolamento de integracoes', () => {
    it('conectar, renovar e desconectar a Wahoo so tocam as tabelas Wahoo, o usuario e a auditoria (nunca Polar/Strava/atividades)', async () => {
      const touched = new Set<string>();
      const f = fixture();
      const guarded = new Proxy(f.prisma as Record<string, unknown>, {
        get: (target, key: string) => { touched.add(key); return target[key]; },
      });
      const service = new WahooService(guarded as never, { get: (n: string) => ({ ...baseSettings })[n] } as never, f.providerData as never);
      network({});
      await service.callback({ state: stateFrom((await service.connectUrl('user-a')).url), code: 'c' });
      f.connections.get('user-a')!.accessTokenExpiresAt = new Date(Date.now() - 1000);
      network({ token: () => json(200, tokenBody(2)) });
      await service.getAccessToken('user-a');
      network({});
      await service.disconnect('user-a');
      expect([...touched].sort()).toEqual(['providerConnectionEvent', 'user', 'wahooConnection', 'wahooOAuthAttempt']);
    });
  });

  describe('callback', () => {
    it('consome o state uma vez, troca o code uma vez (corpo JSON, com verifier) e guarda tokens cifrados do proprio aluno', async () => {
      const { service, connections, events } = fixture();
      const calls = network({});
      const state = stateFrom((await service.connectUrl('user-a')).url);
      await expect(service.callback({ state, code: 'code-1' })).resolves.toBe('connected');

      const exchange = calls.find((c) => c.url.endsWith('/oauth/token'))!;
      expect(exchange.method).toBe('POST');
      expect(exchange.url).toBe('https://api.wahooligan.com/oauth/token'); // segredo nunca na URL
      expect(exchange.body).toMatchObject({ grant_type: 'authorization_code', code: 'code-1', redirect_uri: redirectUri, client_id: 'wahoo-client-id' });
      expect(exchange.body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const row = connections.get('user-a')!;
      expect(row.wahooUserId).toBe('4242');
      expect(row.accessTokenEncrypted).toMatch(/^v1:/);
      expect(row.refreshTokenEncrypted).toMatch(/^v1:/);
      expect(JSON.stringify(row)).not.toContain('access-1');
      expect(JSON.stringify(row)).not.toContain('refresh-1');
      expect(decryptSecret(row.accessTokenEncrypted, Buffer.from(KEY, 'hex'))).toBe('access-1');
      expect(row.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 100 * 60 * 1000);
      expect(row.grantedScopes).toBe('user_read');
      expect(events).toEqual([expect.objectContaining({ userId: 'user-a', provider: 'wahoo', type: 'connected' })]);

      // Reuso do mesmo state: recusado sem nova chamada de rede.
      const before = calls.length;
      await expect(service.callback({ state, code: 'code-2' })).rejects.toBeInstanceOf(BadRequestException);
      expect(calls.length).toBe(before);
    });

    it('rejeita state ausente, malformado, desconhecido ou expirado, sem tocar a rede', async () => {
      const { service, attempts } = fixture();
      const calls = network({});
      await expect(service.callback({ code: 'x' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.callback({ state: 'curto', code: 'x' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.callback({ state: 'a'.repeat(43), code: 'x' })).rejects.toBeInstanceOf(BadRequestException);
      const state = stateFrom((await service.connectUrl('user-a')).url);
      attempts.get(createHash('sha256').update(state).digest('hex'))!.expiresAt = new Date(Date.now() - 1000);
      await expect(service.callback({ state, code: 'x' })).rejects.toBeInstanceOf(BadRequestException);
      expect(calls).toHaveLength(0);
    });

    it('cancelamento (access_denied) consome o state, nao cria conexao e nao chama a Wahoo', async () => {
      const { service, connections } = fixture();
      const calls = network({});
      const state = stateFrom((await service.connectUrl('user-a')).url);
      await expect(service.callback({ state, error: 'access_denied' })).resolves.toBe('cancelled');
      expect(connections.size).toBe(0);
      expect(calls).toHaveLength(0);
      await expect(service.callback({ state, error: 'access_denied' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('isolamento: o code de um callback so cria conexao para o aluno dono do state', async () => {
      const { service, connections } = fixture();
      network({});
      const stateA = stateFrom((await service.connectUrl('user-a')).url);
      await service.callback({ state: stateA, code: 'c' });
      expect([...connections.keys()]).toEqual(['user-a']);
    });

    it('a mesma conta Wahoo nao pode ficar vinculada a dois alunos: 409, sem gravar e SEM revogar (nao derruba a conexao do outro aluno)', async () => {
      const { service, connections } = fixture();
      const calls = network({});
      await service.callback({ state: stateFrom((await service.connectUrl('user-a')).url), code: 'c1' });
      const stateB = stateFrom((await service.connectUrl('user-b')).url);
      await expect(service.callback({ state: stateB, code: 'c2' })).rejects.toBeInstanceOf(ConflictException);
      expect(connections.has('user-b')).toBe(false);
      expect(connections.get('user-a')!.disconnectedAt).toBeNull(); // a conexao do aluno A segue intacta
      expect(calls.filter((c) => c.url.endsWith('/v1/permissions'))).toHaveLength(0);
    });

    it('corrida na unicidade (P2002 no upsert): 409 sem conexao parcial e sem revogar', async () => {
      const f = fixture();
      const calls = network({});
      (f.prisma.wahooConnection.upsert as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
      const state = stateFrom((await f.service.connectUrl('user-a')).url);
      await expect(f.service.callback({ state, code: 'c' })).rejects.toBeInstanceOf(ConflictException);
      expect(f.connections.size).toBe(0);
      expect(calls.some((c) => c.url.endsWith('/v1/permissions'))).toBe(false);
    });

    it('falha na troca do code: nada e gravado e o erro nao carrega code/token/segredo', async () => {
      const { service, connections } = fixture();
      network({ token: () => json(400, { error: 'invalid_grant', detail: 'wahoo-client-secret-VALUE' }) });
      const state = stateFrom((await service.connectUrl('user-a')).url);
      const failure = await service.callback({ state, code: 'code-secreto' }).catch((e) => e);
      expect(failure).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(failure.getResponse())).not.toMatch(/code-secreto|wahoo-client-secret-VALUE/);
      expect(connections.size).toBe(0);
    });

    it('falha ao identificar a conta (/v1/user): nao grava conexao e nao revoga (identidade desconhecida)', async () => {
      const { service, connections } = fixture();
      const calls = network({ user: () => json(403, {}) });
      const state = stateFrom((await service.connectUrl('user-a')).url);
      await expect(service.callback({ state, code: 'c' })).rejects.toThrow();
      expect(connections.size).toBe(0);
      expect(calls.some((c) => c.url.endsWith('/v1/permissions'))).toBe(false);
    });

    it('resposta de token sem refresh_token ou com expires_in invalido e recusada', async () => {
      for (const bad of [{ access_token: 'a', expires_in: 7200 }, { access_token: 'a', refresh_token: 'r', expires_in: -1 }, { refresh_token: 'r', expires_in: 7200 }]) {
        const { service, connections } = fixture();
        network({ token: () => json(200, bad) });
        const state = stateFrom((await service.connectUrl('user-a')).url);
        await expect(service.callback({ state, code: 'c' })).rejects.toThrow();
        expect(connections.size).toBe(0);
      }
    });
  });

  describe('status', () => {
    it('nunca consulta a Wahoo nem devolve credenciais', async () => {
      const { service } = fixture();
      const calls = network({});
      expect(await service.status('user-a')).toEqual({ connected: false, connectedAt: null, disconnectedAt: null });
      await service.callback({ state: stateFrom((await service.connectUrl('user-a')).url), code: 'c' });
      const callsBefore = calls.length;
      const status = await service.status('user-a');
      expect(status).toMatchObject({ connected: true, disconnectedAt: null });
      expect(JSON.stringify(status)).not.toMatch(/token|v1:|access|refresh/i);
      expect(calls.length).toBe(callsBefore);
      expect(await service.status('user-b')).toEqual({ connected: false, connectedAt: null, disconnectedAt: null });
    });
  });

  describe('renovacao de tokens', () => {
    async function connected(f = fixture()) {
      network({});
      await f.service.callback({ state: stateFrom((await f.service.connectUrl('user-a')).url), code: 'c' });
      return f;
    }

    it('token ainda valido: devolve sem chamar a Wahoo', async () => {
      const f = await connected();
      const calls = network({});
      await expect(f.service.getAccessToken('user-a')).resolves.toBe('access-1');
      expect(calls).toHaveLength(0);
    });

    it('token perto de vencer: renova, grava o par NOVO (rotacao) cifrado e libera a trava', async () => {
      const f = await connected();
      f.connections.get('user-a')!.accessTokenExpiresAt = new Date(Date.now() + 60 * 1000);
      const calls = network({ token: () => json(200, tokenBody(2)) });
      await expect(f.service.getAccessToken('user-a')).resolves.toBe('access-2');
      const refresh = calls.find((c) => c.url.endsWith('/oauth/token'))!;
      expect(refresh.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: 'wahoo-client-id' });
      const row = f.connections.get('user-a')!;
      expect(decryptSecret(row.accessTokenEncrypted, Buffer.from(KEY, 'hex'))).toBe('access-2');
      expect(decryptSecret(row.refreshTokenEncrypted, Buffer.from(KEY, 'hex'))).toBe('refresh-2');
      expect(row.refreshLockUntil).toBeNull();
      expect(row.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 100 * 60 * 1000);
    });

    it('duas leituras simultaneas com token vencido geram UMA renovacao (trava); a outra usa o par novo', async () => {
      const f = await connected();
      f.connections.get('user-a')!.accessTokenExpiresAt = new Date(Date.now() - 1000);
      let refreshes = 0;
      network({ token: () => { refreshes++; return json(200, tokenBody(2)); } });
      const [a, b] = await Promise.all([f.service.getAccessToken('user-a'), f.service.getAccessToken('user-a')]);
      expect(refreshes).toBe(1);
      expect([a, b]).toEqual(['access-2', 'access-2']);
    });

    it('trava presa por outra renovacao: espera e, se nao liberar, falha sem renovar', async () => {
      const f = await connected();
      const row = f.connections.get('user-a')!;
      row.accessTokenExpiresAt = new Date(Date.now() - 1000);
      row.refreshLockUntil = new Date(Date.now() + 60 * 1000);
      const calls = network({});
      await expect(f.service.getAccessToken('user-a')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(calls).toHaveLength(0);
    });

    it('trava vencida (processo morreu): assume e renova', async () => {
      const f = await connected();
      const row = f.connections.get('user-a')!;
      row.accessTokenExpiresAt = new Date(Date.now() - 1000);
      row.refreshLockUntil = new Date(Date.now() - 1000);
      network({ token: () => json(200, tokenBody(2)) });
      await expect(f.service.getAccessToken('user-a')).resolves.toBe('access-2');
    });

    it('refresh recusado pela Wahoo (4xx): conexao e encerrada, tokens apagados, auditoria sem segredo', async () => {
      const f = await connected();
      f.connections.get('user-a')!.accessTokenExpiresAt = new Date(Date.now() - 1000);
      network({ token: () => json(401, { error: 'invalid_grant' }) });
      await expect(f.service.getAccessToken('user-a')).rejects.toBeInstanceOf(ConflictException);
      const row = f.connections.get('user-a')!;
      expect(row.disconnectedAt).toBeInstanceOf(Date);
      expect(row.accessTokenEncrypted).toBeNull();
      expect(row.refreshTokenEncrypted).toBeNull();
      expect(f.events.at(-1)).toMatchObject({ provider: 'wahoo', type: 'token_refresh_rejected' });
      expect(JSON.stringify(f.events)).not.toMatch(/refresh-1|access-1/);
      expect((await f.service.status('user-a')).connected).toBe(false);
    });

    it('Wahoo fora do ar (5xx) na renovacao: MANTEM a conexao e o refresh token, e libera a trava', async () => {
      const f = await connected();
      f.connections.get('user-a')!.accessTokenExpiresAt = new Date(Date.now() - 1000);
      network({ token: () => json(503, {}) });
      await expect(f.service.getAccessToken('user-a')).rejects.toThrow();
      const row = f.connections.get('user-a')!;
      expect(row.disconnectedAt).toBeNull();
      expect(decryptSecret(row.refreshTokenEncrypted, Buffer.from(KEY, 'hex'))).toBe('refresh-1');
      expect(row.refreshLockUntil).toBeNull();
    });

    it('desconexao concorrente vence a renovacao: nada e regravado e o token novo e revogado', async () => {
      const f = await connected();
      f.connections.get('user-a')!.accessTokenExpiresAt = new Date(Date.now() - 1000);
      const calls = network({
        token: () => {
          // Enquanto a Wahoo "responde", o aluno desconecta localmente.
          Object.assign(f.connections.get('user-a')!, { disconnectedAt: new Date(), accessTokenEncrypted: null, refreshTokenEncrypted: null });
          return json(200, tokenBody(2));
        },
      });
      await expect(f.service.getAccessToken('user-a')).rejects.toBeInstanceOf(ConflictException);
      const row = f.connections.get('user-a')!;
      expect(row.accessTokenEncrypted).toBeNull();
      expect(row.refreshTokenEncrypted).toBeNull();
      expect(calls.some((c) => c.url.endsWith('/v1/permissions') && c.method === 'DELETE')).toBe(true);
    });

    it('conexao desconectada ou inexistente: nenhum token e entregue', async () => {
      const f = fixture();
      await expect(f.service.getAccessToken('ninguem')).rejects.toBeInstanceOf(ConflictException);
    });

    it('isolamento: renovar o token de um aluno nao toca o de outro', async () => {
      const f = fixture();
      network({});
      await f.service.callback({ state: stateFrom((await f.service.connectUrl('user-a')).url), code: 'c' });
      network({ user: () => json(200, { id: 9999 }), token: () => json(200, tokenBody(7)) });
      await f.service.callback({ state: stateFrom((await f.service.connectUrl('user-b')).url), code: 'c' });
      f.connections.get('user-a')!.accessTokenExpiresAt = new Date(Date.now() - 1000);
      network({ token: () => json(200, tokenBody(2)) });
      await f.service.getAccessToken('user-a');
      expect(decryptSecret(f.connections.get('user-b')!.accessTokenEncrypted, Buffer.from(KEY, 'hex'))).toBe('access-7');
    });
  });

  describe('desconexao', () => {
    async function connected() {
      const f = fixture();
      network({});
      await f.service.callback({ state: stateFrom((await f.service.connectUrl('user-a')).url), code: 'c' });
      return f;
    }

    it('encerra localmente na hora, apaga tokens e revoga na Wahoo (DELETE /v1/permissions com o Bearer do aluno)', async () => {
      const f = await connected();
      const calls = network({});
      await expect(f.service.disconnect('user-a')).resolves.toEqual({ status: 'disconnected', providerRevocation: 'revoked' });
      const row = f.connections.get('user-a')!;
      expect(row.disconnectedAt).toBeInstanceOf(Date);
      expect(row.accessTokenEncrypted).toBeNull();
      expect(row.refreshTokenEncrypted).toBeNull();
      const revoke = calls.find((c) => c.url.endsWith('/v1/permissions'))!;
      expect(revoke.method).toBe('DELETE');
      expect(revoke.headers.Authorization).toBe('Bearer access-1');
      expect(f.providerData.recordDisconnection).toHaveBeenCalledWith('user-a', 'wahoo', { providerRevocation: 'revoked' });
      expect((await f.service.status('user-a')).connected).toBe(false);
    });

    it('Wahoo fora do ar: a desconexao local vale mesmo assim (providerRevocation=failed)', async () => {
      const f = await connected();
      global.fetch = jest.fn(async () => { throw new Error('offline'); }) as never;
      await expect(f.service.disconnect('user-a')).resolves.toEqual({ status: 'disconnected', providerRevocation: 'failed' });
      expect(f.connections.get('user-a')!.disconnectedAt).toBeInstanceOf(Date);
    });

    it('token de acesso vencido: renova so para revogar, sem regravar nada', async () => {
      const f = await connected();
      f.connections.get('user-a')!.accessTokenExpiresAt = new Date(Date.now() - 1000);
      const calls = network({ token: () => json(200, tokenBody(5)) });
      await expect(f.service.disconnect('user-a')).resolves.toMatchObject({ status: 'disconnected', providerRevocation: 'revoked' });
      expect(calls.find((c) => c.url.endsWith('/v1/permissions'))!.headers.Authorization).toBe('Bearer access-5');
      expect(f.connections.get('user-a')!.accessTokenEncrypted).toBeNull();
    });

    it('idempotente e isolada: repetir nao chama a rede; outro aluno nao e afetado', async () => {
      const f = await connected();
      network({});
      await f.service.disconnect('user-a');
      const calls = network({});
      await expect(f.service.disconnect('user-a')).resolves.toEqual({ status: 'already_disconnected', providerRevocation: 'skipped' });
      await expect(f.service.disconnect('user-b')).resolves.toEqual({ status: 'not_connected', providerRevocation: 'skipped' });
      expect(calls).toHaveLength(0);
    });

    it('reconectar depois de desconectar volta a ficar conectado com tokens novos', async () => {
      const f = await connected();
      network({});
      await f.service.disconnect('user-a');
      network({ token: () => json(200, tokenBody(9)) });
      await f.service.callback({ state: stateFrom((await f.service.connectUrl('user-a')).url), code: 'c' });
      const row = f.connections.get('user-a')!;
      expect(row.disconnectedAt).toBeNull();
      expect(decryptSecret(row.accessTokenEncrypted, Buffer.from(KEY, 'hex'))).toBe('access-9');
    });
  });

  describe('controller', () => {
    it('rotas de aluno exigem JWT; o callback e publico; nenhuma rota recebe userId do cliente', () => {
      const guards = (name: string) => Reflect.getMetadata('__guards__', (WahooController.prototype as any)[name]) as unknown[] | undefined;
      expect(guards('connectUrl')?.length).toBeGreaterThan(0);
      expect(guards('status')?.length).toBeGreaterThan(0);
      expect(guards('disconnect')?.length).toBeGreaterThan(0);
      expect(guards('callback')).toBeUndefined();
      expect(Reflect.getMetadata('path', WahooController)).toBe('wahoo');
    });

    it('o HTML do callback nunca contem state, code, token ou segredo e envia cabecalhos de seguranca', async () => {
      const f = fixture({ STUDENT_APP_URL: 'https://panzerirun.eltonpanzeripersonal.com.br' });
      network({ token: () => json(200, tokenBody(1)) });
      const controller = new WahooController(f.service);
      const state = stateFrom((await f.service.connectUrl('user-a')).url);
      const sent: { status?: number; html?: string; headers: Record<string, string> } = { headers: {} };
      const res: any = {
        setHeader: (k: string, v: string) => { sent.headers[k] = v; },
        status: (code: number) => { sent.status = code; return res; },
        type: () => res,
        send: (html: string) => { sent.html = html; },
      };
      await controller.callback({ state, code: 'code-secreto-xyz' }, res);
      expect(sent.status).toBe(200);
      expect(sent.html).not.toMatch(new RegExp(`${state}|code-secreto-xyz|access-1|refresh-1|wahoo-client-secret-VALUE`));
      expect(sent.html).toContain('https://panzerirun.eltonpanzeripersonal.com.br');
      expect(sent.headers['Cache-Control']).toBe('no-store');
      expect(sent.headers['Content-Security-Policy']).toContain("default-src 'none'");
      // state reutilizado => 400 com mensagem generica
      await controller.callback({ state, code: 'outro' }, res);
      expect(sent.status).toBe(400);
      expect(sent.html).not.toContain(state);
    });
  });
});
