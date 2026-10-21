import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';
import { ProviderConnector, ProviderTokens, OAuthCapability } from '../src/provider-hub/provider-connector';
import { consentTextHash, ProviderConsentService, purposeTextHash } from '../src/provider-hub/provider-consent.service';
import { ProviderConnectionService } from '../src/provider-hub/provider-connection.service';
import { hashState } from '../src/provider-hub/provider-crypto';
import { ZEPP_CONSENT } from '../src/zepp/zepp-consent';
import { ProviderDataDeletionService } from '../src/activity-execution/provider-data-deletion.service';

// Fluxo REAL de consentimento Zepp 2.0 (texto, hashes, telas por finalidade, grupos, revogacao, historico e invalidacao de artefatos) sobre o servico generico, banco em memoria.
type Row = Record<string, any>;
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c));
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('gt' in cond) return value != null && value > cond.gt;
      if ('lt' in cond) return value != null && value < cond.lt;
      if ('in' in cond) return (cond.in as unknown[]).includes(value);
      return false;
    }
    return value === cond;
  });
}
function makePrisma() {
  const attempts: Row[] = [];
  const connections: Row[] = [];
  const audit: Row[] = [];
  let seq = 0;
  const prisma: any = {
    attempts, connections, audit,
    user: { findUnique: async ({ where }: Row) => (where.id === 'u1' ? { id: 'u1' } : null) },
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
        if (existing) Object.assign(existing, update); else connections.push({ id: `c${++seq}`, createdAt: new Date(), lastSyncCompletedAt: null, ...create });
      },
      updateMany: async ({ where, data }: Row) => { const hit = connections.filter((c) => matches(c, where)); hit.forEach((c) => Object.assign(c, data)); return { count: hit.length }; },
    },
    providerConnectionEvent: {
      create: async ({ data }: Row) => { audit.push({ ...data, createdAt: new Date(Date.now() + audit.length) }); },
      findMany: async ({ where, take }: Row) => audit
        .filter((a) => a.userId === where.userId && a.provider === where.provider && (!where.type || where.type.in.includes(a.type)))
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, take ?? 100).map((a) => ({ type: a.type, details: a.details, createdAt: a.createdAt })),
    },
  };
  return prisma;
}

const proto: any = {
  isEnabledFor: () => true,
  encryptionKey: () => Buffer.alloc(32, 7),
  buildAuthorizationUrl: ({ state }: { state: string }) => `https://zepp.example/auth?state=${state}`,
  exchangeCode: async (): Promise<ProviderTokens & { externalAccountId: string }> => ({ accessToken: 'AT1', refreshToken: 'RT1', expiresInSec: 3600, externalAccountId: 'ext-1' }),
  refreshTokens: async (): Promise<ProviderTokens> => ({ accessToken: 'AT2', refreshToken: 'RT2', expiresInSec: 3600 }),
} as OAuthCapability;

function setup() {
  const prisma = makePrisma();
  // copia profunda: os testes que "mudam o texto" nao podem afetar os demais
  const consent = JSON.parse(JSON.stringify(ZEPP_CONSENT));
  const connector: ProviderConnector = { id: 'zepp', displayName: 'Zepp', categories: ['activity', 'activity_route', 'activity_sensors', 'sleep', 'profile'], consent, oauth: proto, revocation: { revoke: async () => 'revoked' } };
  const registry = new ConnectorRegistry();
  registry.register(connector);
  const events = { discardPendingForUser: jest.fn(async () => 0) } as any;
  const providerData = { invalidateAiArtifacts: jest.fn(async () => ({ provider: 'zepp' })), deleteProviderData: jest.fn(async () => ({})) } as any;
  const eligibility = { unlocked: false, isExternalAiUnlocked() { return this.unlocked; } };
  const consentService = new ProviderConsentService(prisma, registry);
  const service = new ProviderConnectionService(prisma, registry, events, consentService, providerData, eligibility as never);
  const doc = () => ({ version: consent.version as string, hash: consentTextHash(consent) });
  const screen = (id: string) => { const option = consent.optionalPurposes.find((p: any) => p.id === id); return { version: option.screen.version as string, hash: purposeTextHash(option) }; };
  return { prisma, registry, consent, service, consentService, providerData, eligibility, doc, screen };
}
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
async function connect(s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) {
  const request = { groups: ['account', 'activity'], purposes: [] as string[], acknowledged: true, version: s.doc().version, textHash: s.doc().hash, ...over };
  const { url } = await s.service.begin('zepp', 'u1', request);
  return s.service.complete('zepp', { state: stateOf(url), code: 'CODE' });
}
const grantScreen = (s: ReturnType<typeof setup>, id: string, over: Record<string, unknown> = {}) => s.service.updatePurposes('zepp', 'u1', { grant: [id], acknowledged: true, version: s.screen(id).version, textHash: s.screen(id).hash, ...over });

describe('conexao Zepp 2.0: nada marcado, nada presumido', () => {
  it('sem aceite expresso nao conecta; texto desatualizado (versao/hash errados) e recusado com 409', async () => {
    const s = setup();
    await expect(s.service.begin('zepp', 'u1', { groups: ['account', 'activity'], purposes: [], acknowledged: false, version: s.doc().version, textHash: s.doc().hash })).rejects.toThrow(BadRequestException);
    await expect(s.service.begin('zepp', 'u1', { groups: ['account', 'activity'], purposes: [], acknowledged: true, version: '1.2', textHash: s.doc().hash })).rejects.toThrow(ConflictException);
    await expect(s.service.begin('zepp', 'u1', { groups: ['account', 'activity'], purposes: [], acknowledged: true, version: s.doc().version, textHash: 'x' })).rejects.toThrow(ConflictException);
    expect(s.prisma.attempts).toHaveLength(0);
  });

  it('o grupo da conta e obrigatorio; o aluno escolhe o resto (atividades, sensores, GPS); sensores/GPS exigem atividades', async () => {
    const s = setup();
    await expect(s.service.begin('zepp', 'u1', { groups: ['activity'], purposes: [], acknowledged: true, version: s.doc().version, textHash: s.doc().hash })).rejects.toThrow(/obrigatorio/);
    await expect(s.service.begin('zepp', 'u1', { groups: ['account', 'route'], purposes: [], acknowledged: true, version: s.doc().version, textHash: s.doc().hash })).rejects.toThrow(/depende/);
    expect(await connect(s, { groups: ['account'] })).toBe('connected'); // pode conectar so' a conta (ex.: para enviar treinos); nada de atividade e' coletado
    expect(s.prisma.connections[0].grantedCategories).toEqual(['profile']);
  });

  it('envio de treinos e Atlas NAO podem ser marcados na conexao (tem tela propria); historico pode, e registra versao e janela de 30 dias', async () => {
    const s = setup();
    for (const purpose of ['watch_delivery', 'ai_external']) {
      await expect(s.service.begin('zepp', 'u1', { groups: ['account', 'activity'], purposes: [purpose], acknowledged: true, version: s.doc().version, textHash: s.doc().hash })).rejects.toThrow(/tela propria/);
    }
    await connect(s, { purposes: ['history_backfill'] });
    const c = s.prisma.connections[0];
    expect(c.grantedPurposes).toEqual(expect.arrayContaining(['history', 'history_backfill']));
    expect(c.grantedPurposes).not.toContain('watch_delivery');
    expect(c.grantedPurposes).not.toContain('ai_external');
    expect(c.purposeConsents.history_backfill).toMatchObject({ version: s.doc().version, textHash: s.doc().hash });
    expect(Date.now() - c.collectFrom.getTime()).toBeGreaterThan(29 * 86_400_000);
    // sem marcar o historico: a coleta comeca agora
    const t = setup();
    await connect(t);
    expect(Date.now() - t.prisma.connections[0].collectFrom.getTime()).toBeLessThan(60_000);
    expect(t.prisma.connections[0].grantedPurposes).not.toContain('history_backfill');
  });

  it('a conexao registra o consentimento auditavel: aluno, versao, hash, data e decisao', async () => {
    const s = setup();
    await connect(s, { purposes: ['history_backfill'] });
    expect(s.prisma.audit[0]).toMatchObject({ userId: 'u1', provider: 'zepp', type: 'connected', details: expect.objectContaining({ decision: 'granted', consentVersion: '2.0', consentTextHash: s.doc().hash }) });
    expect(s.prisma.connections[0].consentedAt).toBeInstanceOf(Date);
  });
});

describe('envio de treinos ao relogio: autorizacao propria, versionada e revogavel', () => {
  it('nao e presumida: depois de conectar, watch_delivery nao vale ate o aluno autorizar na tela dela', async () => {
    const s = setup();
    await connect(s);
    expect(await s.consentService.isAllowed('zepp', 'u1', 'profile', 'watch_delivery')).toBe(false);
    const permissions = await s.service.permissions('zepp', 'u1');
    expect(permissions.purposes.find((p) => p.id === 'watch_delivery')).toMatchObject({ granted: false, needsNewAuthorization: false, available: true, hasOwnScreen: true });
  });

  it('exige aceite expresso e a versao/hash DA TELA dela (o hash do documento da conexao nao serve); registra versao e data', async () => {
    const s = setup();
    await connect(s);
    await expect(grantScreen(s, 'watch_delivery', { acknowledged: false })).rejects.toThrow(BadRequestException);
    await expect(grantScreen(s, 'watch_delivery', { version: s.doc().version, textHash: s.doc().hash })).rejects.toThrow(ConflictException);
    await expect(grantScreen(s, 'watch_delivery', { textHash: 'x' })).rejects.toThrow(ConflictException);
    expect(await s.consentService.isAllowed('zepp', 'u1', 'profile', 'watch_delivery')).toBe(false);
    await grantScreen(s, 'watch_delivery');
    expect(await s.consentService.isAllowed('zepp', 'u1', 'profile', 'watch_delivery')).toBe(true);
    expect(s.prisma.connections[0].purposeConsents.watch_delivery).toMatchObject({ version: '1.0', textHash: s.screen('watch_delivery').hash, grantedAt: expect.any(String) });
    expect(s.prisma.audit.at(-1)).toMatchObject({ type: 'purposes_granted', details: expect.objectContaining({ purposes: ['watch_delivery'], decision: 'granted', consentVersion: '1.0' }) });
  });

  it('revogar vale na hora, sem aceite, e fica auditado; nao invalida artefatos de IA (nao e envio de dados a IA)', async () => {
    const s = setup();
    await connect(s);
    await grantScreen(s, 'watch_delivery');
    await s.service.updatePurposes('zepp', 'u1', { revoke: ['watch_delivery'] });
    expect(await s.consentService.isAllowed('zepp', 'u1', 'profile', 'watch_delivery')).toBe(false);
    expect(s.prisma.connections[0].purposeConsents.watch_delivery).toBeUndefined();
    expect(s.prisma.audit.at(-1)).toMatchObject({ type: 'purposes_revoked', details: expect.objectContaining({ purposes: ['watch_delivery'], decision: 'revoked' }) });
    expect(s.providerData.invalidateAiArtifacts).not.toHaveBeenCalled();
  });

  it('mudanca MATERIAL do texto: a autorizacao anterior deixa de valer ate nova autorizacao (e o painel avisa)', async () => {
    const s = setup();
    await connect(s);
    await grantScreen(s, 'watch_delivery');
    const oldScreen = s.screen('watch_delivery'); // o que o cliente em cache ainda mostra
    const option = s.consent.optionalPurposes.find((p: any) => p.id === 'watch_delivery');
    option.screen.version = '1.1';
    option.screen.paragraphs.push('Novo compartilhamento.');
    expect(await s.consentService.isAllowed('zepp', 'u1', 'profile', 'watch_delivery')).toBe(false);
    expect((await s.consentService.snapshot('zepp', 'u1'))!.purposes).not.toContain('watch_delivery');
    const state = (await s.service.permissions('zepp', 'u1')).purposes.find((p) => p.id === 'watch_delivery')!;
    expect(state).toMatchObject({ granted: false, needsNewAuthorization: true, grantedVersion: '1.0', currentVersion: '1.1' });
    await expect(grantScreen(s, 'watch_delivery', { version: oldScreen.version, textHash: oldScreen.hash })).rejects.toThrow(ConflictException); // texto antigo em cache e' recusado
    await grantScreen(s, 'watch_delivery', { version: '1.1', textHash: s.screen('watch_delivery').hash });
    expect(await s.consentService.isAllowed('zepp', 'u1', 'profile', 'watch_delivery')).toBe(true);
  });
});

describe('Atlas / Anthropic: autorizacao propria, bloqueada ate a liberacao, e revogacao com invalidacao dos artefatos', () => {
  it('enquanto o envio externo estiver TRAVADO a autorizacao nao pode ser concedida (nem com o hash certo) e o painel mostra indisponivel', async () => {
    const s = setup();
    await connect(s);
    await expect(grantScreen(s, 'ai_external')).rejects.toThrow(/nao esta disponivel/);
    expect(s.prisma.connections[0].grantedPurposes).not.toContain('ai_external');
    expect((await s.service.permissions('zepp', 'u1')).purposes.find((p) => p.id === 'ai_external')).toMatchObject({ granted: false, available: false, external: true });
  });

  it('liberado (so no teste): exige aceite e o texto da propria tela; concede uma por vez; registra versao e data', async () => {
    const s = setup();
    s.eligibility.unlocked = true;
    await connect(s);
    await expect(grantScreen(s, 'ai_external', { acknowledged: undefined })).rejects.toThrow(BadRequestException);
    await expect(s.service.updatePurposes('zepp', 'u1', { grant: ['ai_external', 'watch_delivery'], acknowledged: true, version: s.screen('ai_external').version, textHash: s.screen('ai_external').hash })).rejects.toThrow(/uma finalidade por vez/);
    await grantScreen(s, 'ai_external');
    expect(s.prisma.connections[0].purposeConsents.ai_external).toMatchObject({ version: '1.0', textHash: s.screen('ai_external').hash });
    expect((await s.service.permissions('zepp', 'u1')).purposes.find((p) => p.id === 'ai_external')).toMatchObject({ granted: true, available: true });
  });

  it('REVOGAR a autorizacao do Atlas invalida os artefatos de IA derivados do provedor; desconectar e revogacao pelo provedor tambem', async () => {
    const s = setup();
    s.eligibility.unlocked = true;
    await connect(s);
    await grantScreen(s, 'ai_external');
    await s.service.updatePurposes('zepp', 'u1', { revoke: ['ai_external'] });
    expect(s.providerData.invalidateAiArtifacts).toHaveBeenCalledWith('u1', 'zepp');
    expect(await s.consentService.isAllowed('zepp', 'u1', 'profile', 'ai_external')).toBe(false);

    const d = setup();
    await connect(d);
    await d.service.disconnect('zepp', 'u1');
    expect(d.providerData.invalidateAiArtifacts).toHaveBeenCalledWith('u1', 'zepp');

    const r = setup();
    await connect(r);
    expect(await r.service.handleRemoteRevocation('zepp', 'ext-1')).toBe('closed');
    expect(r.providerData.invalidateAiArtifacts).toHaveBeenCalledWith('u1', 'zepp');
    expect(r.prisma.audit.some((row: Row) => row.type === 'revoked_by_provider')).toBe(true);
  });

  it('falha ao invalidar nao desfaz a revogacao: fica auditada para reexecucao', async () => {
    const s = setup();
    s.eligibility.unlocked = true;
    await connect(s);
    await grantScreen(s, 'ai_external');
    s.providerData.invalidateAiArtifacts.mockRejectedValueOnce(new Error('falha'));
    await s.service.updatePurposes('zepp', 'u1', { revoke: ['ai_external'] });
    expect(await s.consentService.isAllowed('zepp', 'u1', 'profile', 'ai_external')).toBe(false);
    expect(s.prisma.audit.some((row: Row) => row.type === 'ai_artifacts_invalidation_failed')).toBe(true);
  });
});

describe('historico depois de conectar e grupos de dados', () => {
  it('historico concedido DEPOIS de conectar amplia a janela de coleta para ate 30 dias (nunca mais) e e revogavel', async () => {
    const s = setup();
    await connect(s);
    await expect(s.service.updatePurposes('zepp', 'u1', { grant: ['history_backfill'], acknowledged: true, version: s.doc().version, textHash: 'x' })).rejects.toThrow(ConflictException);
    await s.service.updatePurposes('zepp', 'u1', { grant: ['history_backfill'], acknowledged: true, version: s.doc().version, textHash: s.doc().hash });
    const c = s.prisma.connections[0];
    expect(Date.now() - c.collectFrom.getTime()).toBeGreaterThan(29 * 86_400_000);
    expect(Date.now() - c.collectFrom.getTime()).toBeLessThan(31 * 86_400_000);
    await s.service.updatePurposes('zepp', 'u1', { revoke: ['history_backfill'] });
    expect(c.grantedPurposes).not.toContain('history_backfill');
  });

  it('grupos: conceder exige aceite e texto vigente; sensores/GPS exigem atividades; retirar atividades retira os dependentes e invalida artefatos de IA; conta nao se retira', async () => {
    const s = setup();
    await connect(s, { groups: ['account'] });
    await expect(s.service.updateGroups('zepp', 'u1', { grant: ['route'], acknowledged: true, version: s.doc().version, textHash: s.doc().hash })).rejects.toThrow(BadRequestException);
    await expect(s.service.updateGroups('zepp', 'u1', { grant: ['activity'], acknowledged: false, version: s.doc().version, textHash: s.doc().hash })).rejects.toThrow(BadRequestException);
    await expect(s.service.updateGroups('zepp', 'u1', { grant: ['activity'], acknowledged: true, version: '1.2', textHash: s.doc().hash })).rejects.toThrow(ConflictException);
    const granted = await s.service.updateGroups('zepp', 'u1', { grant: ['activity', 'sensors', 'route'], acknowledged: true, version: s.doc().version, textHash: s.doc().hash });
    expect(granted.categories).toEqual(['profile', 'activity', 'activity_sensors', 'activity_route']);
    await expect(s.service.updateGroups('zepp', 'u1', { revoke: ['account'] })).rejects.toThrow(/desconecte/i);
    const revoked = await s.service.updateGroups('zepp', 'u1', { revoke: ['activity'] });
    expect(revoked.categories).toEqual(['profile']);
    expect(s.providerData.invalidateAiArtifacts).toHaveBeenCalledWith('u1', 'zepp');
    expect(await s.consentService.isAllowed('zepp', 'u1', 'activity_sensors')).toBe(false);
    expect(s.prisma.audit.filter((row: Row) => row.type === 'groups_updated').map((row: Row) => [row.details.decision, row.details.groups])).toEqual([['granted', ['activity', 'sensors', 'route']], ['revoked', ['activity', 'sensors', 'route']]]);
  });

  it('retirar so o GPS ou so os sensores nao invalida artefatos de IA nem mexe nas demais permissoes', async () => {
    const s = setup();
    await connect(s, { groups: ['account', 'activity', 'sensors', 'route'] });
    const result = await s.service.updateGroups('zepp', 'u1', { revoke: ['route'] });
    expect(result.categories).toEqual(['profile', 'activity', 'activity_sensors']);
    expect(s.providerData.invalidateAiArtifacts).not.toHaveBeenCalled();
  });
});

describe('mudanca material do texto da CONEXAO exige reconfirmacao', () => {
  it('versao do documento mudou depois da autorizacao: categorias de dados deixam de valer (so a conta segue), o painel avisa e a reconfirmacao renova sem adicionar nada', async () => {
    const s = setup();
    await connect(s, { groups: ['account', 'activity', 'sensors'] });
    expect(await s.consentService.isAllowed('zepp', 'u1', 'activity')).toBe(true);
    s.consent.version = '2.1';
    s.consent.sections.push({ heading: 'Novo compartilhamento', paragraphs: ['Mudanca material.'] });
    expect(await s.consentService.isAllowed('zepp', 'u1', 'activity')).toBe(false);
    expect(await s.consentService.isAllowed('zepp', 'u1', 'activity_sensors')).toBe(false);
    expect(await s.consentService.isAllowed('zepp', 'u1', 'profile')).toBe(true); // revogar/desconectar/enviar treinos continuam possiveis
    expect((await s.consentService.snapshot('zepp', 'u1'))!.categories).toEqual(['profile']);
    const view = await s.service.permissions('zepp', 'u1');
    expect(view.consent).toMatchObject({ needsReview: true, grantedVersion: '2.0', version: '2.1' });
    expect(view.groups.find((g) => g.id === 'activity')!.granted).toBe(false);
    await expect(s.service.reconfirm('zepp', 'u1', { acknowledged: true, version: '2.0', textHash: s.doc().hash })).rejects.toThrow(ConflictException);
    await expect(s.service.reconfirm('zepp', 'u1', { acknowledged: false, version: s.doc().version, textHash: s.doc().hash })).rejects.toThrow(BadRequestException);
    await s.service.reconfirm('zepp', 'u1', { acknowledged: true, version: s.doc().version, textHash: s.doc().hash });
    expect(await s.consentService.isAllowed('zepp', 'u1', 'activity')).toBe(true);
    expect(s.prisma.connections[0].grantedCategories).toEqual(['profile', 'activity', 'activity_sensors']); // nada novo foi autorizado
    expect((await s.service.permissions('zepp', 'u1')).consent.needsReview).toBe(false);
    expect(s.prisma.audit.at(-1)).toMatchObject({ type: 'connected', details: expect.objectContaining({ reconfirmed: true, consentVersion: '2.1' }) });
  });
});

describe('painel de permissoes e historico de decisoes', () => {
  it('mostra as quatro autorizacoes separadas, cada uma com o proprio estado, e o historico auditavel (item, decisao, versao, data)', async () => {
    const s = setup();
    await connect(s, { purposes: ['history_backfill'] });
    await grantScreen(s, 'watch_delivery');
    await s.service.updatePurposes('zepp', 'u1', { revoke: ['history_backfill'] });
    const view = await s.service.permissions('zepp', 'u1');
    expect(view.connected).toBe(true);
    expect(view.groups.map((g) => [g.id, g.granted])).toEqual([['account', true], ['activity', true], ['sensors', false], ['route', false]]);
    const byId = Object.fromEntries(view.purposes.map((p) => [p.id, p]));
    expect(byId.history_backfill.granted).toBe(false);
    expect(byId.watch_delivery.granted).toBe(true);
    expect(byId.ai_external).toMatchObject({ granted: false, available: false });
    const decisions = view.log.map((entry) => [entry.kind, entry.id, entry.decision]);
    expect(decisions).toEqual(expect.arrayContaining([['connection', null, 'granted'], ['purpose', 'watch_delivery', 'granted'], ['purpose', 'history_backfill', 'revoked']]));
    expect(view.log.every((entry) => entry.at instanceof Date)).toBe(true);
    expect(view.log.find((entry) => entry.id === 'watch_delivery')!.version).toBe('1.0');
  });

  it('desconectado: nada aparece como autorizado', async () => {
    const s = setup();
    await connect(s);
    await grantScreen(s, 'watch_delivery');
    await s.service.disconnect('zepp', 'u1');
    const view = await s.service.permissions('zepp', 'u1');
    expect(view.connected).toBe(false);
    expect(view.groups.every((g) => !g.granted)).toBe(true);
    expect(view.purposes.every((p) => !p.granted)).toBe(true);
  });
});

describe('invalidacao dos artefatos de IA (ProviderDataDeletionService.invalidateAiArtifacts)', () => {
  function make() {
    const state: Row = {
      weekly: [
        { id: 'w1', status: 'active', sources: { providers: ['zepp'] }, invalidatedProviders: null },
        { id: 'w2', status: 'active', sources: { providers: ['polar'] }, invalidatedProviders: null },
      ],
      analyses: [
        { id: 'a1', scope: 'week', deliveredWithPlanId: 'p1', sources: { providers: ['zepp'] }, invalidatedProviders: null },
        { id: 'a2', scope: 'session', deliveredWithPlanId: null, sources: { providers: ['zepp'] }, invalidatedProviders: null },
        { id: 'a3', scope: 'week', deliveredWithPlanId: 'p1', sources: { providers: ['polar'] }, invalidatedProviders: null },
      ],
      packages: [{ id: 'k1', schemaVersion: 2, evidence: [{ ref: 'variable:activity.cadenceAvg', kind: 'variable', source: 'ActivityLog', sourceId: null, provider: null, providers: ['zepp'], asOf: '2026-10-18', label: 'cadencia 170 spm', delivery: 'delivered', storage: 'complete', excerpt: '170 spm' }], agentInput: null, sourceProviders: ['zepp'], agentInputRedactions: null }, { id: 'k2', schemaVersion: 2, evidence: [], agentInput: null, sourceProviders: ['polar'], agentInputRedactions: null }],
      decisions: [],
      events: [{ id: 'e1', sourceProviders: ['zepp'], summarizedAt: new Date() }, { id: 'e2', sourceProviders: null, summarizedAt: new Date() }],
      evolution: [{ id: 'r1', invalidatedAt: null, createdAt: new Date('2026-10-19T00:00:00Z') }, { id: 'r0', invalidatedAt: null, createdAt: new Date('2026-09-01T00:00:00Z') }],
      profile: { userId: 'u1', summary: 'resumo com dado Zepp' },
      audit: [] as Row[],
    };
    const tx: any = {
      weeklyExecutionReport: { findMany: async () => state.weekly.filter((r: Row) => r.status === 'active'), update: async ({ where, data }: Row) => Object.assign(state.weekly.find((r: Row) => r.id === where.id), data) },
      trainingAnalysis: { findMany: async () => state.analyses.filter((r: Row) => (r.status ?? 'active') === 'active'), update: async ({ where, data }: Row) => Object.assign(state.analyses.find((r: Row) => r.id === where.id), data), delete: jest.fn() },
      prescriptionEvidencePackage: { findMany: async () => state.packages, update: async ({ where, data }: Row) => Object.assign(state.packages.find((r: Row) => r.id === where.id), data) },
      prescriptionDecision: { findMany: async () => state.decisions, update: jest.fn() },
      activityLog: { findFirst: async () => ({ createdAt: new Date('2026-10-18T12:00:00Z') }) },
      evolutionReport: { updateMany: async ({ where, data }: Row) => { const hit = state.evolution.filter((r: Row) => r.invalidatedAt === null && r.createdAt >= where.createdAt.gte); hit.forEach((r: Row) => Object.assign(r, data)); return { count: hit.length }; } },
      studentProfileEvent: { findMany: async () => state.events.filter((e: Row) => e.summarizedAt && e.sourceProviders), updateMany: async ({ data }: Row) => state.events.forEach((e: Row) => Object.assign(e, data)) },
      studentProfile: { updateMany: async ({ data }: Row) => Object.assign(state.profile, data) },
      providerConnectionEvent: { create: async ({ data }: Row) => { state.audit.push(data); } },
    };
    const prisma: any = { $transaction: async (cb: (t: any) => Promise<unknown>) => cb(tx) };
    return { state, service: new ProviderDataDeletionService(prisma) };
  }

  it('invalida so o que tem proveniencia do provedor: relatorio semanal e retratos entregues, evidencias, resumo do prontuario e relatorios de evolucao posteriores', async () => {
    const t = make();
    const result = await t.service.invalidateAiArtifacts('u1', 'zepp');
    expect(result).toMatchObject({ provider: 'zepp', weeklyReportsInvalidated: 1, analystSnapshotsInvalidated: 1, evolutionReportsInvalidated: 1, profileSummaryReset: true });
    expect(t.state.weekly.map((r: Row) => [r.id, r.status])).toEqual([['w1', 'invalidated'], ['w2', 'active']]);
    expect(t.state.analyses.map((r: Row) => [r.id, r.status ?? 'active'])).toEqual([['a1', 'invalidated'], ['a2', 'active'], ['a3', 'active']]); // analise viva de sessao e outro provedor ficam
    expect(t.state.packages[0].agentInputRedactions[0]).toMatchObject({ provider: 'zepp', reason: 'ai_authorization_revoked' });
    expect(JSON.stringify(t.state.packages[0].evidence)).not.toContain('170');
    expect(t.state.packages[1].agentInputRedactions).toBeNull();
    expect(t.state.evolution.map((r: Row) => [r.id, r.invalidatedAt !== null])).toEqual([['r1', true], ['r0', false]]);
    expect(t.state.profile.summary).toBe('');
    expect(t.state.events.every((e: Row) => e.summarizedAt === null)).toBe(true);
    expect(t.state.audit[0]).toMatchObject({ type: 'ai_artifacts_invalidated', provider: 'zepp' });
    expect(JSON.stringify(t.state.audit[0].details)).not.toMatch(/resumo com dado|170/); // auditoria so' com contagens
  });

  it('idempotente: segunda chamada nao altera mais nada', async () => {
    const t = make();
    await t.service.invalidateAiArtifacts('u1', 'zepp');
    const second = await t.service.invalidateAiArtifacts('u1', 'zepp');
    expect(second).toMatchObject({ weeklyReportsInvalidated: 0, analystSnapshotsInvalidated: 0, evolutionReportsInvalidated: 0 });
  });
});
