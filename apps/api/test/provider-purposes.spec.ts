import { BadRequestException, ConflictException } from '@nestjs/common';
import { AiDataEligibility, EXTERNAL_AI_APPROVED_PROVIDERS } from '../src/ai-governance/ai-data-eligibility.service';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';
import { ConsentCapability, OAuthCapability, ProviderConnector } from '../src/provider-hub/provider-connector';
import { consentTextHash, ProviderConsentService } from '../src/provider-hub/provider-consent.service';
import { ProviderConnectionService } from '../src/provider-hub/provider-connection.service';

// Finalidades OPCIONAIS (Central Universal, Lote 1): importar ate 30 dias de historico (so' ao conectar) e IA com fornecedores externos (concedida/revogada
// separadamente, sem reconectar, e bloqueada enquanto o provedor nao estiver regularizado).
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
  return {
    attempts, connections, audit,
    user: { findUnique: async ({ where }: Row) => ({ id: where.id }) },
    providerOAuthAttempt: {
      create: async ({ data }: Row) => { attempts.push({ consumedAt: null, ...data }); },
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
      upsert: async ({ create, update }: Row) => {
        const existing = connections.find((x) => x.provider === create.provider && x.userId === create.userId);
        if (existing) Object.assign(existing, update); else connections.push({ id: `c${connections.length + 1}`, lastSyncCompletedAt: null, ...create });
      },
      updateMany: async ({ where, data }: Row) => { const hit = connections.filter((c) => matches(c, where)); hit.forEach((c) => Object.assign(c, data)); return { count: hit.length }; },
    },
    providerConnectionEvent: { create: async ({ data }: Row) => { audit.push(data); }, findMany: async () => [] },
    activityLog: { findMany: async () => [] },
  } as any;
}

const CONSENT: ConsentCapability = {
  version: '1.0', dateLabel: 'x', title: 't', intro: 'i', sections: [],
  groups: [
    { id: 'account', label: 'Conta', description: 'd', required: true, categories: ['profile'] },
    { id: 'activity', label: 'Atividades', description: 'd', required: false, categories: ['activity'] },
  ],
  purposes: ['history', 'tracking'],
  optionalPurposes: [
    { id: 'history_backfill', label: 'Historico', description: 'd', external: false, changeableAfterConnect: false },
    { id: 'ai_external', label: 'IA externa', description: 'd', external: true, changeableAfterConnect: true },
  ],
  acknowledgementText: 'Li', confirmButtonLabel: 'Conectar',
};
const HASH = consentTextHash(CONSENT);
const request = (over: Row = {}) => ({ groups: ['account', 'activity'], purposes: [] as string[], acknowledged: true, version: '1.0', textHash: HASH, ...over });
const ack = (over: Row = {}) => ({ acknowledged: true, version: '1.0', textHash: HASH, ...over });
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

function setup() {
  const prisma = makePrisma();
  const oauth: OAuthCapability = {
    isEnabledFor: () => true, encryptionKey: () => Buffer.alloc(32, 3), buildAuthorizationUrl: ({ state }) => `https://prov.example/auth?state=${state}`,
    exchangeCode: async () => ({ accessToken: 'AT', refreshToken: 'RT', expiresInSec: 3600, externalAccountId: 'ext-1' }),
    refreshTokens: async () => ({ accessToken: 'AT2', refreshToken: 'RT', expiresInSec: 3600 }),
  };
  const connector: ProviderConnector = { id: 'novo', displayName: 'Novo', categories: ['profile', 'activity'], consent: CONSENT, oauth };
  const registry = new ConnectorRegistry();
  registry.register(connector);
  const eligibility = { unlocked: false, isExternalAiUnlocked() { return this.unlocked; } };
  const service = new ProviderConnectionService(prisma, registry, { discardPendingForUser: async () => 0 } as never, new ProviderConsentService(prisma), undefined, eligibility as never);
  const connect = async (over: Row = {}) => {
    const { url } = await service.begin('novo', 'u1', request(over));
    return service.complete('novo', { state: stateOf(url), code: 'C' });
  };
  return { prisma, registry, service, eligibility, connect };
}

describe('conexao: nada opcional e presumido', () => {
  it('sem marcar, so as finalidades obrigatorias ficam autorizadas e a coleta comeca na conexao', async () => {
    const s = setup();
    await s.connect();
    const c = s.prisma.connections[0];
    expect(c.grantedPurposes).toEqual(['history', 'tracking']);
    expect(c.collectFrom).toEqual(c.consentedAt);
  });

  it('historico de 30 dias e uma finalidade propria: marcada, a janela autorizada recua 30 dias e isso fica na auditoria', async () => {
    const s = setup();
    await s.connect({ purposes: ['history_backfill'] });
    const c = s.prisma.connections[0];
    expect(c.grantedPurposes).toEqual(['history', 'tracking', 'history_backfill']);
    expect(c.consentedAt.getTime() - c.collectFrom.getTime()).toBe(30 * 86_400_000);
    expect(s.prisma.audit[0].details.purposes).toContain('history_backfill');
  });

  it('IA externa nao pode ser marcada ao conectar enquanto o provedor estiver bloqueado; ids desconhecidos ou invalidos sao recusados sem gravar tentativa', async () => {
    const s = setup();
    await expect(s.service.begin('novo', 'u1', request({ purposes: ['ai_external'] }))).rejects.toThrow(ConflictException);
    await expect(s.service.begin('novo', 'u1', request({ purposes: ['inventada'] }))).rejects.toThrow(BadRequestException);
    await expect(s.service.begin('novo', 'u1', request({ purposes: 'ai_external' }))).rejects.toThrow(BadRequestException);
    expect(s.prisma.attempts).toHaveLength(0);
    s.eligibility.unlocked = true;
    await s.connect({ purposes: ['ai_external'] });
    expect(s.prisma.connections[0].grantedPurposes).toContain('ai_external');
  });

  it('o documento servido informa se a IA externa esta indisponivel', () => {
    const s = setup();
    expect(s.service.consentDocument('novo').locked).toEqual({ ai_external: true });
    s.eligibility.unlocked = true;
    expect(s.service.consentDocument('novo').locked).toEqual({ ai_external: false });
  });

  it('sem a elegibilidade injetada o servico trata o envio externo como TRAVADO (fail-closed)', async () => {
    const prisma = makePrisma();
    const registry = new ConnectorRegistry();
    registry.register({ id: 'novo', displayName: 'Novo', categories: ['profile', 'activity'], consent: CONSENT, oauth: setup().registry.get('novo')!.oauth });
    const service = new ProviderConnectionService(prisma, registry, { discardPendingForUser: async () => 0 } as never, new ProviderConsentService(prisma));
    await expect(service.begin('novo', 'u1', request({ purposes: ['ai_external'] }))).rejects.toThrow(ConflictException);
  });
});

describe('depois da conexao: conceder e revogar a IA externa sem reconectar', () => {
  it('conceder exige aceite expresso, texto vigente e provedor liberado; fica auditado com versao e hash', async () => {
    const s = setup();
    await s.connect();
    await expect(s.service.updatePurposes('novo', 'u1', { grant: ['ai_external'], ...ack({ acknowledged: false }) })).rejects.toThrow(BadRequestException);
    await expect(s.service.updatePurposes('novo', 'u1', { grant: ['ai_external'], ...ack({ textHash: 'antigo' }) })).rejects.toThrow(ConflictException);
    await expect(s.service.updatePurposes('novo', 'u1', { grant: ['ai_external'], ...ack() })).rejects.toThrow(/ainda nao esta disponivel/);
    expect(s.prisma.connections[0].grantedPurposes).not.toContain('ai_external');
    s.eligibility.unlocked = true;
    expect(await s.service.updatePurposes('novo', 'u1', { grant: ['ai_external'], ...ack() })).toEqual({ purposes: ['history', 'tracking', 'ai_external'] });
    expect(s.prisma.audit.at(-1)).toMatchObject({ type: 'purposes_granted', details: { purposes: ['ai_external'], consentVersion: '1.0', consentTextHash: HASH } });
  });

  it('revogar vale na hora, nunca exige aceite nem liberacao, nao toca em tokens nem categorias e e idempotente', async () => {
    const s = setup();
    s.eligibility.unlocked = true;
    await s.connect({ purposes: ['ai_external'] });
    s.eligibility.unlocked = false;
    const before = { ...s.prisma.connections[0] };
    expect(await s.service.updatePurposes('novo', 'u1', { revoke: ['ai_external'] })).toEqual({ purposes: ['history', 'tracking'] });
    const c = s.prisma.connections[0];
    expect(c.accessTokenEncrypted).toBe(before.accessTokenEncrypted);
    expect(c.disconnectedAt).toBeNull();
    expect(c.grantedCategories).toEqual(before.grantedCategories);
    expect(s.prisma.audit.at(-1)).toMatchObject({ type: 'purposes_revoked', details: { purposes: ['ai_external'] } });
    const audits = s.prisma.audit.length;
    await s.service.updatePurposes('novo', 'u1', { revoke: ['ai_external'] });
    expect(s.prisma.audit).toHaveLength(audits);
  });

  it('recusa finalidade nao alteravel depois da conexao, obrigatoria (so desconectando), formato invalido, conceder+revogar juntas e conexao encerrada', async () => {
    const s = setup();
    await s.connect();
    await expect(s.service.updatePurposes('novo', 'u1', { grant: ['history_backfill'], ...ack() })).rejects.toThrow(/nao alteravel/);
    await expect(s.service.updatePurposes('novo', 'u1', { revoke: ['history'] })).rejects.toThrow(BadRequestException);
    await expect(s.service.updatePurposes('novo', 'u1', { grant: 'ai_external' })).rejects.toThrow(BadRequestException);
    s.eligibility.unlocked = true;
    await expect(s.service.updatePurposes('novo', 'u1', { grant: ['ai_external'], revoke: ['ai_external'], ...ack() })).rejects.toThrow(BadRequestException);
    await s.service.disconnect('novo', 'u1');
    await expect(s.service.updatePurposes('novo', 'u1', { revoke: ['ai_external'] })).rejects.toThrow(ConflictException);
  });

  it('a revogacao muda a elegibilidade para IA imediatamente (mesmo estado do banco)', async () => {
    const s = setup();
    s.eligibility.unlocked = true;
    await s.connect({ purposes: ['ai_external'] });
    const approved = EXTERNAL_AI_APPROVED_PROVIDERS as string[];
    approved.push('novo');
    try {
      const elig = new AiDataEligibility(s.prisma, s.registry, { get: (k: string) => (k === 'NOVO_EXTERNAL_AI_ENABLED' ? 'true' : undefined) } as never);
      expect((await elig.decide('u1', 'novo', { category: 'activity', destination: 'external_ai' })).allowed).toBe(true);
      await s.service.updatePurposes('novo', 'u1', { revoke: ['ai_external'] });
      expect((await elig.decide('u1', 'novo', { category: 'activity', destination: 'external_ai' })).reason).toBe('purpose_not_granted');
    } finally {
      approved.splice(approved.indexOf('novo'), 1);
    }
  });
});
