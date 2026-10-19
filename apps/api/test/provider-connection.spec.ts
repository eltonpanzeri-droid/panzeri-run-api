import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';
import { OAuthCapability, ProviderConnector, ProviderTokens } from '../src/provider-hub/provider-connector';
import { decryptSecret, hashState } from '../src/provider-hub/provider-crypto';
import { FALLBACK_TOKEN_TTL_SEC, ProviderConnectionService, REFRESH_LEASE_MS, validateConsent } from '../src/provider-hub/provider-connection.service';

// ── Banco em memoria (so' o que o servico usa) ──
type Row = Record<string, any>;
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c));
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('gt' in cond) return value != null && value > cond.gt;
      if ('lt' in cond) return value != null && value < cond.lt;
      return false;
    }
    return value === cond;
  });
}
function makePrisma() {
  const attempts: Row[] = [];
  const connections: Row[] = [];
  const audit: Row[] = [];
  const users = new Set(['u1', 'u2']);
  let seq = 0;
  const prisma: any = {
    attempts, connections, audit, users,
    user: { findUnique: async ({ where }: Row) => (users.has(where.id) ? { id: where.id } : null) },
    providerOAuthAttempt: {
      create: async ({ data }: Row) => { attempts.push({ consumedAt: null, createdAt: new Date(), ...data }); },
      updateMany: async ({ where, data }: Row) => { const hit = attempts.filter((a) => matches(a, where)); hit.forEach((a) => Object.assign(a, data)); return { count: hit.length }; },
      findUnique: async ({ where }: Row) => { const a = attempts.find((x) => x.stateHash === where.stateHash); return a ? { ...a } : null; },
    },
    providerConnection: {
      findUnique: async ({ where }: Row) => {
        const w = where.provider_userId ?? where.provider_externalAccountId;
        const c = connections.find((x) => Object.entries(w).every(([k, v]) => x[k] === v));
        return c ? { ...c } : null;
      },
      findMany: async ({ where }: Row) => connections.filter((c) => matches(c, where)).map((c) => ({ ...c })),
      upsert: async ({ where, create, update }: Row) => {
        const w = where.provider_userId;
        const existing = connections.find((x) => x.provider === w.provider && x.userId === w.userId);
        const target = { ...(existing ?? create), ...(existing ? update : {}) };
        if (connections.some((c) => c !== existing && c.provider === target.provider && c.externalAccountId === target.externalAccountId)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        if (existing) Object.assign(existing, update); else connections.push({ id: `c${++seq}`, createdAt: new Date(), lastSyncCompletedAt: null, ...create });
      },
      updateMany: async ({ where, data }: Row) => { const hit = connections.filter((c) => matches(c, where)); hit.forEach((c) => Object.assign(c, data)); return { count: hit.length }; },
    },
    providerConnectionEvent: { create: async ({ data }: Row) => { audit.push(data); } },
  };
  return prisma;
}

const KEY = Buffer.alloc(32, 7);
interface FakeProto extends OAuthCapability {
  enabled: boolean;
  exchange: jest.Mock;
  refresh: jest.Mock;
}
function makeProto(): FakeProto {
  const proto: any = {
    enabled: true,
    isEnabledFor: () => proto.enabled,
    encryptionKey: () => KEY,
    buildAuthorizationUrl: ({ state }: { state: string }) => `https://prov.example/auth?state=${state}`,
    exchange: jest.fn(async (): Promise<ProviderTokens & { externalAccountId: string }> => ({ accessToken: 'AT1', refreshToken: 'RT1', expiresInSec: 3600, externalAccountId: 'ext-1' })),
    refresh: jest.fn(async (): Promise<ProviderTokens> => ({ accessToken: 'AT2', refreshToken: 'RT2', expiresInSec: 3600 })),
  };
  proto.exchangeCode = (i: { code: string }) => proto.exchange(i);
  proto.refreshTokens = (i: { refreshToken: string }) => proto.refresh(i);
  return proto;
}
function setup() {
  const prisma = makePrisma();
  const proto = makeProto();
  const revoke = jest.fn(async (): Promise<'revoked' | 'not_registered' | 'failed'> => 'revoked');
  const connector: ProviderConnector = { id: 'novo', displayName: 'Novo', categories: ['activity', 'sleep'], oauth: proto, revocation: { revoke } };
  const registry = new ConnectorRegistry();
  registry.register(connector);
  const events = { discardPendingForUser: jest.fn(async () => 0) } as any;
  const providerData = { deleteProviderData: jest.fn(async () => ({ provider: 'novo', activities: 2 })) } as any;
  class TestService extends ProviderConnectionService { protected sleep() { return new Promise<void>((r) => setTimeout(r, 20)); } }
  const service = new TestService(prisma, registry, events, providerData);
  return { prisma, proto, revoke, events, providerData, service };
}
const consent = { categories: ['activity'], version: 'v1' };
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

async function connect(s: ReturnType<typeof setup>, userId = 'u1') {
  const { url } = await s.service.begin('novo', userId, consent);
  return s.service.complete('novo', { state: stateOf(url), code: 'CODE' });
}

describe('validateConsent', () => {
  const connector: ProviderConnector = { id: 'novo', displayName: 'N', categories: ['activity', 'sleep'] };
  it('aceita categorias oferecidas pelo conector, sem duplicar', () => {
    expect(validateConsent(connector, { categories: ['activity', 'activity', 'sleep'], version: 'v1.2' })).toEqual({ categories: ['activity', 'sleep'], version: 'v1.2' });
  });
  it('recusa lista vazia, categoria desconhecida, categoria que o conector nao oferece e versao invalida', () => {
    expect(() => validateConsent(connector, { categories: [], version: 'v1' })).toThrow(BadRequestException);
    expect(() => validateConsent(connector, { categories: 'activity', version: 'v1' })).toThrow(BadRequestException);
    expect(() => validateConsent(connector, { categories: ['inventada'], version: 'v1' })).toThrow(/desconhecida/);
    expect(() => validateConsent(connector, { categories: ['resting_heart_rate'], version: 'v1' })).toThrow(/nao oferece/);
    expect(() => validateConsent(connector, { categories: [1], version: 'v1' })).toThrow(BadRequestException);
    for (const version of ['', 'a b', 'x'.repeat(41), 5, null]) expect(() => validateConsent(connector, { categories: ['activity'], version })).toThrow(/Versao/);
  });
});

describe('ProviderConnectionService.begin', () => {
  it('provedor desconhecido ou sem OAuth: 404', async () => {
    const s = setup();
    await expect(s.service.begin('inexistente', 'u1', consent)).rejects.toThrow(NotFoundException);
  });

  it('fail-closed: sem habilitacao nao grava tentativa nem revela configuracao', async () => {
    const s = setup();
    s.proto.enabled = false;
    await expect(s.service.begin('novo', 'u1', consent)).rejects.toThrow(ForbiddenException);
    expect(s.prisma.attempts).toHaveLength(0);
  });

  it('guarda so o HASH do state; o state bruto vai so na URL', async () => {
    const s = setup();
    const { url } = await s.service.begin('novo', 'u1', consent);
    const state = stateOf(url);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(s.prisma.attempts)).not.toContain(state);
    expect(s.prisma.attempts[0]).toMatchObject({ stateHash: hashState(state), provider: 'novo', userId: 'u1', consent });
  });

  it('ja conectado: 409; apos desconectar, pode conectar de novo', async () => {
    const s = setup();
    await connect(s);
    await expect(s.service.begin('novo', 'u1', consent)).rejects.toThrow(ConflictException);
    await s.service.disconnect('novo', 'u1');
    await expect(s.service.begin('novo', 'u1', consent)).resolves.toHaveProperty('url');
  });
});

describe('ProviderConnectionService.complete', () => {
  it('conecta: tokens CIFRADOS, consentimento registrado, coleta a partir da conexao, auditoria sem token', async () => {
    const s = setup();
    expect(await connect(s)).toBe('connected');
    const c = s.prisma.connections[0];
    expect(c).toMatchObject({ userId: 'u1', provider: 'novo', externalAccountId: 'ext-1', grantedCategories: ['activity'], consentVersion: 'v1', disconnectedAt: null });
    expect(c.accessTokenEncrypted).not.toContain('AT1');
    expect(decryptSecret(c.accessTokenEncrypted, KEY)).toBe('AT1');
    expect(decryptSecret(c.refreshTokenEncrypted, KEY)).toBe('RT1');
    expect(c.collectFrom).toEqual(c.consentedAt);
    expect(s.prisma.audit[0]).toMatchObject({ userId: 'u1', provider: 'novo', type: 'connected', details: { categories: ['activity'], consentVersion: 'v1' } });
    expect(JSON.stringify(s.prisma.audit)).not.toMatch(/AT1|RT1|CODE/);
  });

  it('state de uso unico: reutilizar, expirar, formato invalido ou de outro provedor => 400 e nada conectado', async () => {
    const s = setup();
    const { url } = await s.service.begin('novo', 'u1', consent);
    const state = stateOf(url);
    await s.service.complete('novo', { state, code: 'C' });
    await expect(s.service.complete('novo', { state, code: 'C' })).rejects.toThrow(BadRequestException);
    expect(s.proto.exchange).toHaveBeenCalledTimes(1);

    const s2 = setup();
    const { url: url2 } = await s2.service.begin('novo', 'u1', consent);
    s2.prisma.attempts[0].expiresAt = new Date(Date.now() - 1000);
    await expect(s2.service.complete('novo', { state: stateOf(url2), code: 'C' })).rejects.toThrow(BadRequestException);
    await expect(s2.service.complete('novo', { state: 'curto', code: 'C' })).rejects.toThrow(BadRequestException);
    await expect(s2.service.complete('novo', { state: undefined, code: 'C' })).rejects.toThrow(BadRequestException);
    expect(s2.prisma.connections).toHaveLength(0);
    expect(s2.proto.exchange).not.toHaveBeenCalled();
  });

  it('o aluno cancelou no provedor: nada conectado e o state ja foi consumido', async () => {
    const s = setup();
    const { url } = await s.service.begin('novo', 'u1', consent);
    expect(await s.service.complete('novo', { state: stateOf(url), error: 'access_denied' })).toBe('cancelled');
    expect(s.prisma.connections).toHaveLength(0);
    await expect(s.service.complete('novo', { state: stateOf(url), code: 'C' })).rejects.toThrow(BadRequestException);
  });

  it('erro diferente de cancelamento, ou erro junto com code => 400 sem trocar codigo', async () => {
    const s = setup();
    const { url } = await s.service.begin('novo', 'u1', consent);
    await expect(s.service.complete('novo', { state: stateOf(url), error: 'server_error' })).rejects.toThrow(BadRequestException);
    const { url: url2 } = await s.service.begin('novo', 'u1', consent);
    await expect(s.service.complete('novo', { state: stateOf(url2), error: 'access_denied', code: 'C' })).rejects.toThrow(BadRequestException);
    expect(s.proto.exchange).not.toHaveBeenCalled();
  });

  it('habilitacao retirada no meio do fluxo => 403 sem trocar codigo', async () => {
    const s = setup();
    const { url } = await s.service.begin('novo', 'u1', consent);
    s.proto.enabled = false;
    await expect(s.service.complete('novo', { state: stateOf(url), code: 'C' })).rejects.toThrow(ForbiddenException);
    expect(s.proto.exchange).not.toHaveBeenCalled();
  });

  it('a mesma conta do provedor nao liga a dois alunos (409), e nada e gravado para o segundo', async () => {
    const s = setup();
    await connect(s, 'u1');
    await expect(connect(s, 'u2')).rejects.toThrow(ConflictException);
    expect(s.prisma.connections).toHaveLength(1);
    expect(s.prisma.connections[0].userId).toBe('u1');
  });

  it('corrida: unicidade violada na gravacao vira 409', async () => {
    const s = setup();
    await connect(s, 'u1');
    // outro aluno passa pela checagem previa (simulada) mas perde na unicidade do banco
    const original = s.prisma.providerConnection.findUnique;
    s.prisma.providerConnection.findUnique = async (args: Row) => (args.where.provider_externalAccountId ? null : original(args));
    await expect(connect(s, 'u2')).rejects.toThrow(ConflictException);
  });

  it('recusa definitiva do provedor na troca do codigo propaga e nao grava', async () => {
    const s = setup();
    s.proto.exchange.mockRejectedValueOnce(new BadRequestException('recusou'));
    await expect(connect(s)).rejects.toThrow(BadRequestException);
    expect(s.prisma.connections).toHaveLength(0);
  });

  it('sem validade informada o servico assume validade curta; sem refresh token guarda null', async () => {
    const s = setup();
    s.proto.exchange.mockResolvedValueOnce({ accessToken: 'AT1', refreshToken: null, expiresInSec: null, externalAccountId: 'ext-1' });
    await connect(s);
    const c = s.prisma.connections[0];
    expect(c.refreshTokenEncrypted).toBeNull();
    expect(c.accessTokenExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(FALLBACK_TOKEN_TTL_SEC * 1000);
  });
});

describe('ProviderConnectionService.getAccessToken', () => {
  it('token valido: devolve sem renovar', async () => {
    const s = setup();
    await connect(s);
    expect(await s.service.getAccessToken('novo', 'u1')).toBe('AT1');
    expect(s.proto.refresh).not.toHaveBeenCalled();
  });

  it('vencido: renova UMA vez mesmo com chamadas simultaneas e grava o par novo cifrado', async () => {
    const s = setup();
    await connect(s);
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000);
    let release!: () => void;
    s.proto.refresh.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ accessToken: 'AT2', refreshToken: 'RT2', expiresInSec: 3600 }); }));
    const calls = Promise.all([1, 2, 3, 4].map(() => s.service.getAccessToken('novo', 'u1')));
    await new Promise((r) => setTimeout(r, 40));
    release();
    expect(await calls).toEqual(['AT2', 'AT2', 'AT2', 'AT2']);
    expect(s.proto.refresh).toHaveBeenCalledTimes(1);
    expect(s.proto.refresh).toHaveBeenCalledWith({ refreshToken: 'RT1' });
    const c = s.prisma.connections[0];
    expect(decryptSecret(c.accessTokenEncrypted, KEY)).toBe('AT2');
    expect(decryptSecret(c.refreshTokenEncrypted, KEY)).toBe('RT2');
    expect(c.refreshLockUntil).toBeNull();
  });

  it('provedor nao devolve novo refresh token: mantem o atual', async () => {
    const s = setup();
    await connect(s);
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000);
    s.proto.refresh.mockResolvedValueOnce({ accessToken: 'AT2', refreshToken: null, expiresInSec: null });
    await s.service.getAccessToken('novo', 'u1');
    expect(decryptSecret(s.prisma.connections[0].refreshTokenEncrypted, KEY)).toBe('RT1');
  });

  it('refresh token recusado: encerra a conexao local, descarta eventos pendentes e pede reconexao', async () => {
    const s = setup();
    await connect(s);
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000);
    s.proto.refresh.mockRejectedValueOnce(new BadRequestException('recusou'));
    await expect(s.service.getAccessToken('novo', 'u1')).rejects.toThrow(ConflictException);
    expect(s.prisma.connections[0]).toMatchObject({ accessTokenEncrypted: null, refreshTokenEncrypted: null });
    expect(s.prisma.connections[0].disconnectedAt).toBeInstanceOf(Date);
    expect(s.events.discardPendingForUser).toHaveBeenCalledWith('novo', 'u1');
    expect(s.prisma.audit.map((a: Row) => a.type)).toContain('token_refresh_rejected');
  });

  it('falha transitoria do provedor: mantem a conexao e libera a trava', async () => {
    const s = setup();
    await connect(s);
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000);
    s.proto.refresh.mockRejectedValueOnce(new BadGatewayException('fora do ar'));
    await expect(s.service.getAccessToken('novo', 'u1')).rejects.toThrow(BadGatewayException);
    expect(s.prisma.connections[0].disconnectedAt).toBeNull();
    expect(s.prisma.connections[0].refreshTokenEncrypted).not.toBeNull();
    expect(s.prisma.connections[0].refreshLockUntil).toBeNull();
  });

  it('trava (lease) expirada de renovacao que travou nao bloqueia para sempre', async () => {
    const s = setup();
    await connect(s);
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000);
    s.prisma.connections[0].refreshLockUntil = new Date(Date.now() - 1);
    expect(await s.service.getAccessToken('novo', 'u1')).toBe('AT2');
    expect(REFRESH_LEASE_MS).toBeGreaterThan(0);
  });

  it('sem refresh token e vencido: encerra e pede reconexao; desconectado: 409', async () => {
    const s = setup();
    s.proto.exchange.mockResolvedValueOnce({ accessToken: 'AT1', refreshToken: null, expiresInSec: 1, externalAccountId: 'ext-1' });
    await connect(s);
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000);
    await expect(s.service.getAccessToken('novo', 'u1')).rejects.toThrow(/expirou/);
    await expect(s.service.getAccessToken('novo', 'u1')).rejects.toThrow(ConflictException);
  });
});

describe('ProviderConnectionService.disconnect / deleteData / status', () => {
  it('encerra LOCALMENTE primeiro (tokens ja apagados quando o provedor e avisado), descarta eventos e audita', async () => {
    const s = setup();
    await connect(s);
    let rowAtRevoke: Row | null = null;
    s.revoke.mockImplementationOnce(async () => { rowAtRevoke = { ...s.prisma.connections[0] }; return 'revoked'; });
    expect(await s.service.disconnect('novo', 'u1')).toEqual({ status: 'disconnected', providerRevocation: 'revoked' });
    expect(rowAtRevoke).toMatchObject({ accessTokenEncrypted: null, refreshTokenEncrypted: null });
    expect(rowAtRevoke!.disconnectedAt).toBeInstanceOf(Date);
    expect(s.revoke).toHaveBeenCalledWith({ accessToken: 'AT1' });
    expect(s.events.discardPendingForUser).toHaveBeenCalledWith('novo', 'u1');
    expect(s.prisma.audit.at(-1)).toMatchObject({ type: 'disconnected', details: { providerRevocation: 'revoked' } });
  });

  it('falha ao avisar o provedor nao desfaz a desconexao local; token vencido e renovado so para revogar', async () => {
    const s = setup();
    await connect(s);
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000);
    s.revoke.mockRejectedValueOnce(new Error('rede'));
    expect((await s.service.disconnect('novo', 'u1')).providerRevocation).toBe('failed');
    expect(s.prisma.connections[0].disconnectedAt).toBeInstanceOf(Date);
    expect(s.proto.refresh).toHaveBeenCalledTimes(1);
  });

  it('idempotente: segunda desconexao e usuario sem conexao nao fazem nada', async () => {
    const s = setup();
    expect((await s.service.disconnect('novo', 'u2')).status).toBe('not_connected');
    await connect(s);
    await s.service.disconnect('novo', 'u1');
    expect((await s.service.disconnect('novo', 'u1')).status).toBe('already_disconnected');
    expect(s.revoke).toHaveBeenCalledTimes(1);
  });

  it('exclusao dos dados importados exige estar desconectado e usa a exclusao padrao por provedor', async () => {
    const s = setup();
    await connect(s);
    await expect(s.service.deleteData('novo', 'u1')).rejects.toThrow(ConflictException);
    await s.service.disconnect('novo', 'u1');
    await s.service.deleteData('novo', 'u1');
    expect(s.providerData.deleteProviderData).toHaveBeenCalledWith('u1', 'novo');
  });

  it('disconnectAll encerra todas as conexoes ativas do usuario e tolera falha de uma', async () => {
    const s = setup();
    await connect(s);
    s.events.discardPendingForUser.mockRejectedValue(new Error('x')); // erro interno nao pode impedir o encerramento local
    await s.service.disconnectAll('u1');
    expect(s.prisma.connections[0].disconnectedAt).toBeInstanceOf(Date);
  });

  it('status nao expoe token nem identificador externo', async () => {
    const s = setup();
    expect(await s.service.status('novo', 'u1')).toMatchObject({ connected: false, consent: null });
    await connect(s);
    const status = await s.service.status('novo', 'u1');
    expect(status).toMatchObject({ connected: true, consent: { categories: ['activity'], version: 'v1' } });
    expect(JSON.stringify(status)).not.toMatch(/AT1|RT1|ext-1|Encrypted/);
  });
});
