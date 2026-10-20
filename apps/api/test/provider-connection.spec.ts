import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';
import { ConsentCapability, OAuthCapability, ProviderConnector, ProviderTokens } from '../src/provider-hub/provider-connector';
import { consentTextHash, ProviderConsentService } from '../src/provider-hub/provider-consent.service';
import { decryptSecret, hashState } from '../src/provider-hub/provider-crypto';
import { FALLBACK_TOKEN_TTL_SEC, ProviderConnectionService, REFRESH_LEASE_MS, resolveConsent } from '../src/provider-hub/provider-connection.service';

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
    providerConnectionEvent: {
      create: async ({ data }: Row) => { audit.push(data); },
      findMany: async ({ where, take }: Row) => audit.filter((a) => a.userId === where.userId && a.provider === where.provider).slice(-take).reverse().map((a) => ({ type: a.type, details: a.details, createdAt: new Date() })),
    },
  };
  return prisma;
}

const KEY = Buffer.alloc(32, 7);
const CONSENT: ConsentCapability = {
  version: '1.0', dateLabel: '19/10/2026', title: 'Titulo', intro: 'Intro', sections: [{ heading: 'Secao', paragraphs: ['Texto'] }],
  groups: [
    { id: 'account', label: 'Conta', description: 'd', required: true, categories: ['profile'] },
    { id: 'activity', label: 'Atividades', description: 'd', required: false, categories: ['activity'] },
    { id: 'route', label: 'GPS', description: 'd', required: false, categories: ['activity_route'], requires: ['activity'] },
    { id: 'sleep', label: 'Sono', description: 'd', required: false, categories: ['sleep', 'resting_heart_rate'] },
  ],
  purposes: ['history', 'tracking'],
  optionalPurposes: [
    { id: 'history_backfill', label: 'Historico', description: 'd', external: false, changeableAfterConnect: false },
    { id: 'ai_external', label: 'IA externa', description: 'd', external: true, changeableAfterConnect: true },
  ],
  acknowledgementText: 'Li e autorizo', confirmButtonLabel: 'Conectar',
};
const HASH = consentTextHash(CONSENT);
const request = (over: Record<string, unknown> = {}) => ({ groups: ['account', 'activity'], purposes: [] as string[], acknowledged: true, version: '1.0', textHash: HASH, ...over });
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
  const connector: ProviderConnector = { id: 'novo', displayName: 'Novo', categories: ['profile', 'activity', 'activity_route', 'sleep', 'resting_heart_rate'], consent: CONSENT, oauth: proto, revocation: { revoke } };
  const registry = new ConnectorRegistry();
  registry.register(connector);
  const events = { discardPendingForUser: jest.fn(async () => 0) } as any;
  const providerData = { deleteProviderData: jest.fn(async () => ({ provider: 'novo', activities: 2 })) } as any;
  class TestService extends ProviderConnectionService { protected sleep() { return new Promise<void>((r) => setTimeout(r, 20)); } }
  const consentService = new ProviderConsentService(prisma);
  // Estado da trava de envio externo controlavel pelo teste (padrao: TRAVADO, como em producao).
  const eligibility = { unlocked: false, isExternalAiUnlocked() { return this.unlocked; } };
  const service = new TestService(prisma, registry, events, consentService, providerData, eligibility as never);
  return { prisma, proto, revoke, events, providerData, service, eligibility };
}
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

async function connect(s: ReturnType<typeof setup>, userId = 'u1') {
  const { url } = await s.service.begin('novo', userId, request());
  return s.service.complete('novo', { state: stateOf(url), code: 'CODE' });
}

describe('resolveConsent', () => {
  it('seleciona SO o que foi marcado (obrigatorio incluido), sem duplicar, e devolve finalidades e hash', () => {
    expect(resolveConsent(CONSENT, request({ groups: ['account', 'activity', 'activity'] }))).toEqual({ groups: ['account', 'activity'], categories: ['profile', 'activity'], purposes: ['history', 'tracking'], version: '1.0', textHash: HASH });
    expect(resolveConsent(CONSENT, request({ purposes: ['history_backfill'] })).purposes).toEqual(['history', 'tracking', 'history_backfill']);
    expect(resolveConsent(CONSENT, request({ groups: ['account', 'sleep'] })).categories).toEqual(['profile', 'sleep', 'resting_heart_rate']);
  });
  it('sem aceite expresso nada e presumido: acknowledged precisa ser exatamente true', () => {
    for (const acknowledged of [false, undefined, 'true', 1, null]) expect(() => resolveConsent(CONSENT, request({ acknowledged }))).toThrow(/confirmar expressamente/);
  });
  it('texto desatualizado ou adulterado (versao ou hash diferentes) => 409, o aluno precisa ver o texto vigente', () => {
    expect(() => resolveConsent(CONSENT, request({ version: '0.9' }))).toThrow(ConflictException);
    expect(() => resolveConsent(CONSENT, request({ textHash: 'x'.repeat(64) }))).toThrow(ConflictException);
    expect(() => resolveConsent(CONSENT, request({ textHash: undefined }))).toThrow(ConflictException);
    // mudar qualquer parte do texto muda o hash
    expect(consentTextHash({ ...CONSENT, intro: 'Outra' })).not.toBe(HASH);
    expect(consentTextHash({ ...CONSENT, purposes: [...CONSENT.purposes, 'ai'] })).not.toBe(HASH);
  });
  it('recusa grupo desconhecido, ausencia do obrigatorio, selecao incompativel (GPS sem atividades) e lista invalida', () => {
    expect(() => resolveConsent(CONSENT, request({ groups: ['account', 'inventado'] }))).toThrow(/desconhecido/);
    expect(() => resolveConsent(CONSENT, request({ groups: ['activity'] }))).toThrow(/obrigatorio/);
    expect(() => resolveConsent(CONSENT, request({ groups: ['account', 'route'] }))).toThrow(/incompativel/);
    expect(resolveConsent(CONSENT, request({ groups: ['account', 'activity', 'route'] })).categories).toContain('activity_route');
    expect(() => resolveConsent(CONSENT, request({ groups: 'account' }))).toThrow(BadRequestException);
    expect(() => resolveConsent(CONSENT, request({ groups: [1] }))).toThrow(BadRequestException);
  });
});

describe('ProviderConnectionService.begin', () => {
  it('provedor desconhecido ou sem OAuth: 404', async () => {
    const s = setup();
    await expect(s.service.begin('inexistente', 'u1', request())).rejects.toThrow(NotFoundException);
  });

  it('fail-closed: sem habilitacao nao grava tentativa nem revela configuracao', async () => {
    const s = setup();
    s.proto.enabled = false;
    await expect(s.service.begin('novo', 'u1', request())).rejects.toThrow(ForbiddenException);
    expect(s.prisma.attempts).toHaveLength(0);
  });

  it('guarda so o HASH do state; o state bruto vai so na URL', async () => {
    const s = setup();
    const { url } = await s.service.begin('novo', 'u1', request());
    const state = stateOf(url);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(s.prisma.attempts)).not.toContain(state);
    expect(s.prisma.attempts[0]).toMatchObject({ stateHash: hashState(state), provider: 'novo', userId: 'u1', consent: { groups: ['account', 'activity'], categories: ['profile', 'activity'], version: '1.0', textHash: HASH } });
  });

  it('ja conectado: 409; apos desconectar, pode conectar de novo', async () => {
    const s = setup();
    await connect(s);
    await expect(s.service.begin('novo', 'u1', request())).rejects.toThrow(ConflictException);
    await s.service.disconnect('novo', 'u1');
    await expect(s.service.begin('novo', 'u1', request())).resolves.toHaveProperty('url');
  });
});

describe('ProviderConnectionService.complete', () => {
  it('conecta: tokens CIFRADOS, consentimento registrado, coleta a partir da conexao, auditoria sem token', async () => {
    const s = setup();
    expect(await connect(s)).toBe('connected');
    const c = s.prisma.connections[0];
    expect(c).toMatchObject({ userId: 'u1', provider: 'novo', externalAccountId: 'ext-1', grantedCategories: ['profile', 'activity'], grantedPurposes: ['history', 'tracking'], consentVersion: '1.0', consentTextHash: HASH, disconnectedAt: null });
    expect(c.accessTokenEncrypted).not.toContain('AT1');
    expect(decryptSecret(c.accessTokenEncrypted, KEY)).toBe('AT1');
    expect(decryptSecret(c.refreshTokenEncrypted, KEY)).toBe('RT1');
    expect(c.collectFrom).toEqual(c.consentedAt);
    expect(s.prisma.audit[0]).toMatchObject({ userId: 'u1', provider: 'novo', type: 'connected', details: { groups: ['account', 'activity'], categories: ['profile', 'activity'], consentVersion: '1.0', consentTextHash: HASH } });
    expect(JSON.stringify(s.prisma.audit)).not.toMatch(/AT1|RT1|CODE/);
  });

  it('state de uso unico: reutilizar, expirar, formato invalido ou de outro provedor => 400 e nada conectado', async () => {
    const s = setup();
    const { url } = await s.service.begin('novo', 'u1', request());
    const state = stateOf(url);
    await s.service.complete('novo', { state, code: 'C' });
    await expect(s.service.complete('novo', { state, code: 'C' })).rejects.toThrow(BadRequestException);
    expect(s.proto.exchange).toHaveBeenCalledTimes(1);

    const s2 = setup();
    const { url: url2 } = await s2.service.begin('novo', 'u1', request());
    s2.prisma.attempts[0].expiresAt = new Date(Date.now() - 1000);
    await expect(s2.service.complete('novo', { state: stateOf(url2), code: 'C' })).rejects.toThrow(BadRequestException);
    await expect(s2.service.complete('novo', { state: 'curto', code: 'C' })).rejects.toThrow(BadRequestException);
    await expect(s2.service.complete('novo', { state: undefined, code: 'C' })).rejects.toThrow(BadRequestException);
    expect(s2.prisma.connections).toHaveLength(0);
    expect(s2.proto.exchange).not.toHaveBeenCalled();
  });

  it('o aluno cancelou no provedor: nada conectado e o state ja foi consumido', async () => {
    const s = setup();
    const { url } = await s.service.begin('novo', 'u1', request());
    expect(await s.service.complete('novo', { state: stateOf(url), error: 'access_denied' })).toBe('cancelled');
    expect(s.prisma.connections).toHaveLength(0);
    await expect(s.service.complete('novo', { state: stateOf(url), code: 'C' })).rejects.toThrow(BadRequestException);
  });

  it('erro diferente de cancelamento, ou erro junto com code => 400 sem trocar codigo', async () => {
    const s = setup();
    const { url } = await s.service.begin('novo', 'u1', request());
    await expect(s.service.complete('novo', { state: stateOf(url), error: 'server_error' })).rejects.toThrow(BadRequestException);
    const { url: url2 } = await s.service.begin('novo', 'u1', request());
    await expect(s.service.complete('novo', { state: stateOf(url2), error: 'access_denied', code: 'C' })).rejects.toThrow(BadRequestException);
    expect(s.proto.exchange).not.toHaveBeenCalled();
  });

  it('habilitacao retirada no meio do fluxo => 403 sem trocar codigo', async () => {
    const s = setup();
    const { url } = await s.service.begin('novo', 'u1', request());
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
    expect(await s.service.getAccessToken('novo', 'u1', 'activity')).toBe('AT1');
    expect(s.proto.refresh).not.toHaveBeenCalled();
  });

  it('vencido: renova UMA vez mesmo com chamadas simultaneas e grava o par novo cifrado', async () => {
    const s = setup();
    await connect(s);
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000);
    let release!: () => void;
    s.proto.refresh.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ accessToken: 'AT2', refreshToken: 'RT2', expiresInSec: 3600 }); }));
    const calls = Promise.all([1, 2, 3, 4].map(() => s.service.getAccessToken('novo', 'u1', 'activity')));
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
    await s.service.getAccessToken('novo', 'u1', 'activity');
    expect(decryptSecret(s.prisma.connections[0].refreshTokenEncrypted, KEY)).toBe('RT1');
  });

  it('refresh token recusado: encerra a conexao local, descarta eventos pendentes e pede reconexao', async () => {
    const s = setup();
    await connect(s);
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000);
    s.proto.refresh.mockRejectedValueOnce(new BadRequestException('recusou'));
    await expect(s.service.getAccessToken('novo', 'u1', 'activity')).rejects.toThrow(ConflictException);
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
    await expect(s.service.getAccessToken('novo', 'u1', 'activity')).rejects.toThrow(BadGatewayException);
    expect(s.prisma.connections[0].disconnectedAt).toBeNull();
    expect(s.prisma.connections[0].refreshTokenEncrypted).not.toBeNull();
    expect(s.prisma.connections[0].refreshLockUntil).toBeNull();
  });

  it('trava (lease) expirada de renovacao que travou nao bloqueia para sempre', async () => {
    const s = setup();
    await connect(s);
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000);
    s.prisma.connections[0].refreshLockUntil = new Date(Date.now() - 1);
    expect(await s.service.getAccessToken('novo', 'u1', 'activity')).toBe('AT2');
    expect(REFRESH_LEASE_MS).toBeGreaterThan(0);
  });

  it('sem refresh token e vencido: encerra e pede reconexao; desconectado: 409', async () => {
    const s = setup();
    s.proto.exchange.mockResolvedValueOnce({ accessToken: 'AT1', refreshToken: null, expiresInSec: 1, externalAccountId: 'ext-1' });
    await connect(s);
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000);
    await expect(s.service.getAccessToken('novo', 'u1', 'activity')).rejects.toThrow(/expirou/);
    await expect(s.service.getAccessToken('novo', 'u1', 'activity')).rejects.toThrow(ConflictException);
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
    expect(status).toMatchObject({ connected: true, account: { hint: '••••xt-1' }, consent: { categories: ['profile', 'activity'], version: '1.0', textHash: HASH } });
    expect(JSON.stringify(status)).not.toMatch(/AT1|RT1|ext-1|Encrypted/);
  });
});

describe('consentimento APLICADO (nao basta registrar)', () => {
  it('token so sai para categoria autorizada: outra categoria => 403 e o provedor nem e consultado', async () => {
    const s = setup();
    await connect(s); // autorizou conta + atividades
    s.prisma.connections[0].accessTokenExpiresAt = new Date(Date.now() + 1000); // venceria => renovaria
    await expect(s.service.getAccessToken('novo', 'u1', 'sleep')).rejects.toThrow(ForbiddenException);
    await expect(s.service.getAccessToken('novo', 'u1', 'activity_route')).rejects.toThrow(ForbiddenException);
    expect(s.proto.refresh).not.toHaveBeenCalled();
    expect(await s.service.getAccessToken('novo', 'u1', 'activity')).toBe('AT2');
  });

  it('desconectado: nenhuma categoria vale mais (consentimento revogado), nem token', async () => {
    const s = setup();
    await connect(s);
    await s.service.disconnect('novo', 'u1');
    await expect(s.service.getAccessToken('novo', 'u1', 'activity')).rejects.toThrow(ConflictException);
    expect(await new ProviderConsentService(s.prisma).isAllowed('novo', 'u1', 'activity')).toBe(false);
  });

  it('finalidades: so as do texto; IA e qualquer outra NAO estao autorizadas', async () => {
    const s = setup();
    await connect(s);
    const consent = new ProviderConsentService(s.prisma);
    expect(await consent.isAllowed('novo', 'u1', 'activity', 'history')).toBe(true);
    expect(await consent.isAllowed('novo', 'u1', 'activity', 'ai')).toBe(false);
    expect(await consent.isAllowed('novo', 'u1', 'activity', 'treinar_modelo')).toBe(false);
    await expect(consent.assertAllowed('novo', 'u1', 'activity', 'ai')).rejects.toThrow(ForbiddenException);
    expect(await consent.isAllowed('novo', 'u1', 'sleep')).toBe(false);
    expect(await consent.isAllowed('novo', 'u2', 'activity')).toBe(false); // outro usuario nunca herda
  });

  it('falhas e cancelamento ficam na auditoria com MOTIVO seguro (sem code, state nem token) e aparecem no status', async () => {
    const s = setup();
    s.proto.exchange.mockRejectedValueOnce(new BadRequestException('recusou segredo-do-provedor'));
    const { url } = await s.service.begin('novo', 'u1', request());
    await expect(s.service.complete('novo', { state: stateOf(url), code: 'CODIGO-SECRETO' })).rejects.toThrow(BadRequestException);
    const { url: url2 } = await s.service.begin('novo', 'u1', request());
    expect(await s.service.complete('novo', { state: stateOf(url2), error: 'access_denied' })).toBe('cancelled');
    expect(s.prisma.audit.map((a: Row) => [a.type, a.details.reason ?? null])).toEqual([['connect_failed', 'recusada_pelo_provedor_ou_invalida'], ['connect_cancelled', null]]);
    expect(JSON.stringify(s.prisma.audit)).not.toMatch(/CODIGO-SECRETO|segredo-do-provedor|AT1|RT1/);
    const status = await s.service.status('novo', 'u1');
    expect(status.recent.map((r: Row) => r.type)).toEqual(['connect_cancelled', 'connect_failed']);
    expect(JSON.stringify(status)).not.toMatch(/CODIGO|segredo/);
  });

  it('o documento de consentimento servido ao cliente traz o hash que o pedido precisa devolver', () => {
    const s = setup();
    const doc = s.service.consentDocument('novo');
    expect(doc.textHash).toBe(HASH);
    expect(doc.groups.find((g) => g.id === 'account')?.required).toBe(true);
    expect(() => s.service.consentDocument('inexistente')).toThrow(NotFoundException);
  });

  it('pedido de conexao sem aceite, com texto antigo ou selecao incompativel nao grava tentativa', async () => {
    const s = setup();
    await expect(s.service.begin('novo', 'u1', request({ acknowledged: false }))).rejects.toThrow(BadRequestException);
    await expect(s.service.begin('novo', 'u1', request({ textHash: 'antigo' }))).rejects.toThrow(ConflictException);
    await expect(s.service.begin('novo', 'u1', request({ groups: ['account', 'route'] }))).rejects.toThrow(BadRequestException);
    expect(s.prisma.attempts).toHaveLength(0);
  });

  it('exclusao de dados e desconexao ficam auditadas', async () => {
    const s = setup();
    await connect(s);
    await s.service.disconnect('novo', 'u1');
    await s.service.deleteData('novo', 'u1');
    expect(s.prisma.audit.map((a: Row) => a.type)).toEqual(['connected', 'disconnected', 'data_deleted']);
  });
});
