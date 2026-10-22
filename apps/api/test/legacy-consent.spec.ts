import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LegacyConsentService } from '../src/legacy-consent/legacy-consent.service';
import { LEGACY_CONSENT_DOCUMENTS, LEGACY_CONSENT_PROVIDERS } from '../src/legacy-consent/legacy-consent';
import { purposeTextHash } from '../src/provider-hub/provider-consent.service';
import { AiDataEligibility } from '../src/ai-governance/ai-data-eligibility.service';
import { buildStudentIntegrations, IntegrationsRaw } from '../src/coach/student-integrations.service';
import { IntegrationsService } from '../src/integrations/integrations.service';

// Quem JA' estava conectada em Polar/Wahoo (22/10/2026): pergunta sobre o Atlas SEM perder nada. Sem resposta = comportamento anterior; resposta = vale a escolha. Dados SINTETICOS.

const atlasOf = (provider: 'polar' | 'wahoo') => LEGACY_CONSENT_DOCUMENTS[provider].optionalPurposes.find((p) => p.id === 'ai_external')!;
const grantInput = (provider: 'polar' | 'wahoo') => ({ grant: true, acknowledged: true, version: atlasOf(provider).screen!.version, textHash: purposeTextHash(atlasOf(provider)) });

function fakeDb(connected: Array<'polar' | 'wahoo'> = ['polar', 'wahoo']) {
  const rows = new Map<string, any>(); const events: any[] = [];
  const key = (w: any) => `${w.provider_userId.provider}|${w.provider_userId.userId}`;
  const prisma: any = {
    providerConnection: {
      findUnique: jest.fn(async ({ where }: any) => rows.get(key(where)) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => { const k = key(where); rows.set(k, { ...(rows.get(k) ?? {}), ...(rows.has(k) ? update : create) }); return rows.get(k); }),
    },
    providerConnectionEvent: {
      create: jest.fn(async ({ data }: any) => { events.push(data); return data; }),
      findFirst: jest.fn(async ({ where }: any) => [...events].reverse().find((e) => e.userId === where.userId && e.provider === where.provider && where.type.in.includes(e.type)) ?? null),
    },
    polarConnection: { findUnique: jest.fn(async () => (connected.includes('polar') ? { disconnectedAt: null } : null)) },
    wahooConnection: { findUnique: jest.fn(async () => (connected.includes('wahoo') ? { disconnectedAt: null } : null)) },
  };
  return { prisma, rows, events };
}
const providerData = () => ({ invalidateAiArtifacts: jest.fn(async () => ({})) });

describe('autorizacao do Atlas para Polar/Wahoo ja conectadas', () => {
  it('documento por provedor com texto, versao e hash proprios; provedor desconhecido = 404', () => {
    const service = new LegacyConsentService(fakeDb().prisma);
    const polar = service.document('polar');
    expect(polar.title).toContain('Polar Flow');
    expect(polar.purposeHashes.ai_external).toBe(purposeTextHash(atlasOf('polar')));
    expect(service.document('wahoo').purposeHashes.ai_external).not.toBe(polar.purposeHashes.ai_external);
    expect(() => service.document('strava')).toThrow(NotFoundException); // Strava: dados nunca vao a IA, sem pergunta
    expect(() => service.document('zepp')).toThrow(NotFoundException);
    expect([...LEGACY_CONSENT_PROVIDERS]).toEqual(['polar', 'wahoo']);
  });

  it('sem resposta: "nao decidiu" e NADA e gravado; so mostra a pergunta para quem esta conectada ao provedor', async () => {
    const { prisma, rows } = fakeDb(['polar']);
    const service = new LegacyConsentService(prisma);
    expect(await service.permissions('polar', 'u1')).toMatchObject({ connected: true, decided: false, atlas: { granted: false, declined: false } });
    expect(await service.permissions('wahoo', 'u1')).toMatchObject({ connected: false });
    expect(rows.size).toBe(0);
  });

  it('autorizar exige aceite e o texto VIGENTE (versao + hash); grava SEM credenciais e nao toca a importacao', async () => {
    const { prisma, rows, events } = fakeDb();
    const service = new LegacyConsentService(prisma, providerData() as never);
    await expect(service.setAtlas('polar', 'u1', { grant: true, acknowledged: false, version: '1.0', textHash: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setAtlas('polar', 'u1', { grant: true, acknowledged: true, version: '0.1', textHash: purposeTextHash(atlasOf('polar')) })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.setAtlas('polar', 'u1', { grant: true, acknowledged: true, version: '1.0', textHash: 'hash-do-wahoo' })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.setAtlas('polar', 'u1', { grant: 'sim' as never })).rejects.toBeInstanceOf(BadRequestException);
    const result = await service.setAtlas('polar', 'u1', grantInput('polar'));
    expect(result).toMatchObject({ decided: true, atlas: { granted: true, declined: false } });
    expect(rows.get('polar|u1')).toMatchObject({ externalAccountId: 'u1', accessTokenEncrypted: null, refreshTokenEncrypted: null, grantedCategories: ['activity'] });
    expect(rows.has('wahoo|u1')).toBe(false); // uma decisao por provedor
    expect(events.at(-1)).toMatchObject({ type: 'purposes_granted', details: { decision: 'granted' } });
  });

  it('"nao autorizo" tambem e uma decisao (vale a escolha, sem aceite) e invalida os resultados de IA derivados; retirar depois idem', async () => {
    const { prisma } = fakeDb(); const pd = providerData();
    const service = new LegacyConsentService(prisma, pd as never);
    expect(await service.setAtlas('wahoo', 'u1', { grant: false })).toMatchObject({ decided: true, atlas: { granted: false, declined: true } });
    expect(pd.invalidateAiArtifacts).toHaveBeenCalledWith('u1', 'wahoo');
    await service.setAtlas('wahoo', 'u1', grantInput('wahoo'));
    expect((await service.permissions('wahoo', 'u1')).atlas.granted).toBe(true);
    pd.invalidateAiArtifacts.mockClear();
    await service.setAtlas('wahoo', 'u1', { grant: false });
    expect((await service.permissions('wahoo', 'u1')).atlas).toMatchObject({ granted: false, declined: true });
    expect(pd.invalidateAiArtifacts).toHaveBeenCalledTimes(1);
  });

  it('achado 1: a RECUSA sobrevive a perda da linha (ProviderConnection nao entra no backup): a ultima decisao fica na auditoria e a IA continua bloqueada', async () => {
    const { prisma, rows } = fakeDb();
    const service = new LegacyConsentService(prisma);
    await service.setAtlas('polar', 'u1', { grant: false });
    rows.clear(); // restauracao de backup: a linha some, o evento de auditoria permanece
    const e = new AiDataEligibility(prisma, { list: () => [], get: () => undefined } as never, { get: () => undefined } as never);
    expect(await e.decide('u1', 'polar', { category: 'activity', destination: 'external_ai' })).toMatchObject({ allowed: false, reason: 'purpose_not_granted' });
    expect(await service.permissions('polar', 'u1')).toMatchObject({ decided: true, atlas: { granted: false, declined: true } });
    // quem nunca decidiu (ou so autorizou) segue como antes
    expect(await e.decide('outra', 'polar', { category: 'activity', destination: 'external_ai' })).toEqual({ allowed: true, reason: 'legacy_provider_unchanged' });
    await service.setAtlas('wahoo', 'u1', grantInput('wahoo'));
    rows.clear();
    expect(await e.decide('u1', 'wahoo', { category: 'activity', destination: 'external_ai' })).toEqual({ allowed: true, reason: 'legacy_provider_unchanged' });
  });

  it('autorizacao dada sobre texto antigo deixa de valer e pede nova', async () => {
    const { prisma, rows } = fakeDb();
    const service = new LegacyConsentService(prisma);
    await service.setAtlas('polar', 'u1', grantInput('polar'));
    rows.get('polar|u1').purposeConsents = { ai_external: { version: '0.9', textHash: 'antigo', grantedAt: '2026-10-01T00:00:00.000Z' } };
    expect((await service.permissions('polar', 'u1')).atlas).toMatchObject({ granted: false, needsNewAuthorization: true });
  });
});

describe('IA: regra de NAO-PERDA para Polar/Wahoo', () => {
  function eligibility(rows: Map<string, any>) {
    const prisma: any = { providerConnection: { findUnique: async ({ where }: any) => rows.get(`${where.provider_userId.provider}|${where.provider_userId.userId}`) ?? null }, activityLog: { findMany: async () => [{ provider: 'polar' }, { provider: 'wahoo' }] } };
    return new AiDataEligibility(prisma, { list: () => [], get: () => undefined } as never, { get: () => undefined } as never);
  }
  const external = { category: 'activity', destination: 'external_ai' as const };

  it('SEM resposta da aluna: segue como antes (permitido), sem exigir variavel de ambiente', async () => {
    const e = eligibility(new Map());
    expect(await e.decide('u1', 'polar', external)).toEqual({ allowed: true, reason: 'legacy_provider_unchanged' });
    expect(await e.decide('u1', 'wahoo', external)).toEqual({ allowed: true, reason: 'legacy_provider_unchanged' });
    expect((await e.scopeFor('u1')).blocked).toEqual(['health_connect']); // polar/wahoo nao bloqueados
  });

  it('com resposta: autorizou => permitido; nao autorizou/retirou => bloqueado so naquele provedor; texto antigo => bloqueado', async () => {
    const { prisma, rows } = fakeDb();
    const service = new LegacyConsentService(prisma);
    await service.setAtlas('polar', 'u1', grantInput('polar'));
    await service.setAtlas('wahoo', 'u1', { grant: false });
    const e = eligibility(rows);
    expect(await e.decide('u1', 'polar', external)).toEqual({ allowed: true, reason: 'allowed' });
    expect(await e.decide('u1', 'wahoo', external)).toMatchObject({ allowed: false, reason: 'purpose_not_granted' });
    expect((await e.scopeFor('u1')).blocked).toEqual(['health_connect', 'wahoo']);
    rows.get('polar|u1').purposeConsents = { ai_external: { version: '0.9', textHash: 'antigo', grantedAt: '2026-10-01T00:00:00.000Z' } };
    expect(await e.decide('u1', 'polar', external)).toMatchObject({ allowed: false, reason: 'purpose_not_granted' });
  });
});

describe('painel do treinador e lista da aluna', () => {
  const NOW = new Date('2026-10-22T20:00:00Z');
  const base = (over: Partial<IntegrationsRaw> = {}): IntegrationsRaw => ({
    polar: { createdAt: new Date('2026-09-01T00:00:00Z'), disconnectedAt: null, lastSyncCompletedAt: new Date('2026-10-22T10:00:00Z') }, wahoo: null, strava: null, zepp: null, activityByProvider: { polar: { lastAt: new Date('2026-10-22T10:00:00Z'), count: 25 } },
    zepp_activity_sensors: { lastAt: null, count: 0 }, zepp_activity_route: { lastAt: null, count: 0 }, zepp_sleep: { lastAt: null, count: 0 }, zepp_daily: { lastAt: null, count: 0 }, zepp_resting_hr: { lastAt: null, count: 0 }, zepp_hrv: { lastAt: null, count: 0 },
    zeppLastProcessedEventAt: null, zeppWorkoutLastAcceptedAt: null, inboundFailures: [], zeppWorkoutFailures: [], ...over,
  });
  const atlas = (raw: IntegrationsRaw) => buildStudentIntegrations('a1', raw, NOW, false).integrations.find((i) => i.provider === 'polar')!.atlas;

  it('sem resposta: o painel diz que ela ainda nao respondeu e que vale o comportamento anterior; com resposta: autorizou / nao autorizou', () => {
    expect(atlas(base())).toMatchObject({ authorized: null });
    expect(atlas(base()).note).toContain('ainda não respondeu');
    const doc = atlasOf('polar');
    const granted = { disconnectedAt: null, grantedPurposes: ['ai_external'], purposeConsents: { ai_external: { version: doc.screen!.version, textHash: purposeTextHash(doc), grantedAt: '2026-10-22T15:00:00.000Z' } } };
    expect(atlas(base({ legacyConsent: { polar: granted } }))).toMatchObject({ authorized: true, since: '2026-10-22T15:00:00.000Z' });
    expect(atlas(base({ legacyConsent: { polar: { disconnectedAt: null, grantedPurposes: [], purposeConsents: {} } } }))).toMatchObject({ authorized: false, needsNewAuthorization: false });
    expect(atlas(base({ legacyConsent: { polar: { disconnectedAt: null, grantedPurposes: ['ai_external'], purposeConsents: { ai_external: { version: '0.9', textHash: 'x', grantedAt: 'x' } } } } }))).toMatchObject({ authorized: false, needsNewAuthorization: true });
  });

  it('lista de integracoes da aluna: Polar/Wahoo conectadas SEM decisao ficam como "falta autorizar"; com decisao ou sem conexao, nao', async () => {
    const calls: any = {};
    const prisma: any = {
      polarConnection: { findUnique: async () => ({ disconnectedAt: null }) }, wahooConnection: { findUnique: async () => ({ disconnectedAt: null }) }, stravaConnection: { findUnique: async () => null },
      providerConnection: { findUnique: async ({ where }: any) => (where.provider_userId.provider === 'wahoo' ? { disconnectedAt: null } : null) },
    };
    void calls;
    const env: Record<string, string> = { POLAR_CLIENT_ID: 'x', WAHOO_CLIENT_ID: 'w', WAHOO_CLIENT_SECRET: 'w', WAHOO_REDIRECT_URI: 'w', WAHOO_TOKEN_ENCRYPTION_KEY: 'w', WAHOO_ENABLED_USER_IDS: '*' };
    const result = await new IntegrationsService(prisma, { get: (k: string) => env[k] } as never).catalog('aluno-A');
    const by = (id: string) => (result.providers as any[]).find((p) => p.id === id);
    expect(by('polar').pendingAuthorizations).toEqual(['análise com o Atlas']);
    expect(by('wahoo').pendingAuthorizations).toBeUndefined(); // wahoo ja decidiu
  });
});

describe('fiacao no app e no servidor', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

  it('o cartao aparece nas telas da Polar e da Wahoo, so para quem esta conectada, e nunca desconecta o provedor', () => {
    const app = read('mobile/App.tsx');
    expect(app).toContain('<LegacyAtlasConsentCard provider="polar"');
    expect(app).toContain('<LegacyAtlasConsentCard provider="wahoo"');
    const card = read('mobile/src/legacyConsent/LegacyAtlasConsentCard.tsx');
    expect(card).toContain('!perms.connected) return null');
    expect(card).toContain('Enquanto não responder, tudo continua como está');
    expect(card).not.toMatch(/disconnect|desconectar\(/i);
  });

  it('rotas do servidor: JWT, id sempre do token, provedor restrito a Polar/Wahoo; modulo registrado', () => {
    const controller = read('api/src/legacy-consent/legacy-consent.controller.ts');
    expect(controller).toContain("@UseGuards(AuthGuard('jwt'))");
    expect(controller).toContain('user.sub');
    expect(controller).not.toMatch(/@Param\('userId'\)|body\??\.userId/);
    expect(read('api/src/app.module.ts')).toContain('LegacyConsentModule');
    expect(read('api/src/legacy-consent/legacy-consent.service.ts')).toContain('isLegacyConsentProvider');
  });
});
