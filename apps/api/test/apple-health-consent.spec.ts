import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AppleHealthConsentService } from '../src/apple-health/apple-health-consent.service';
import { APPLE_HEALTH_CATEGORIES, APPLE_HEALTH_CONSENT } from '../src/apple-health/apple-health-consent';
import { consentTextHash } from '../src/provider-hub/provider-consent.service';
import { PROVIDER_DATA_CATEGORIES } from '../src/provider-hub/provider-connector';

// Apple Saude: autorizacao por categoria no servidor (28/10/2026), no modelo do Health Connect. Dados SINTETICOS. Prova: sem registro vale o modo legacy (aplicativo publicado), com registro vale
// so' o autorizado, retirar bloqueia na hora e apaga localizacao/sensores ja' guardados, e o texto nao promete dados diarios que nao existem.

const doc = APPLE_HEALTH_CONSENT;
const hash = consentTextHash(doc);
const ack = { acknowledged: true, version: doc.version, textHash: hash };

function fakeDb() {
  const rows = new Map<string, any>();
  const events: any[] = [];
  const activityLogs: any[] = []; const rawActivities: any[] = [];
  const calls: string[] = [];
  const prisma: any = {
    providerConnection: {
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.provider_userId.userId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => { const k = where.provider_userId.userId; rows.set(k, { ...(rows.get(k) ?? {}), ...(rows.has(k) ? update : create) }); return rows.get(k); }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = rows.get(where.userId);
        if (!row || (where.disconnectedAt === null && row.disconnectedAt)) return { count: 0 };
        if (where.grantedCategories?.equals !== undefined && JSON.stringify(row.grantedCategories) !== JSON.stringify(where.grantedCategories.equals)) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      }),
    },
    activityLog: {
      updateMany: jest.fn(async ({ where, data }: any) => { calls.push(`log.updateMany:${Object.keys(data).join(',')}`); for (const log of activityLogs) if (log.userId === where.userId && log.provider === where.provider) Object.assign(log, data); return { count: 1 }; }),
      findMany: jest.fn(async ({ where }: any) => activityLogs.filter((l) => l.userId === where.userId && l.provider === where.provider && l.providerMetrics)),
      update: jest.fn(async ({ where, data }: any) => { Object.assign(activityLogs.find((l) => l.id === where.id), data); return {}; }),
    },
    // Saude do dia a dia (29/10/2026): a retirada tambem limpa as tabelas Wearable* do provedor; estes testes nao semeiam esses dados (ver apple-health-records.spec.ts).
    wearableSleepSummary: { deleteMany: async () => ({ count: 0 }), updateMany: async () => ({ count: 0 }) },
    wearableHrvSummary: { deleteMany: async () => ({ count: 0 }), updateMany: async () => ({ count: 0 }) },
    wearableDailySummary: { deleteMany: async () => ({ count: 0 }), updateMany: async () => ({ count: 0 }) },
    wearableMetricRecord: { deleteMany: async () => ({ count: 0 }), updateMany: async () => ({ count: 0 }) },
    activityTimeSeriesPoint: { deleteMany: jest.fn(async () => { calls.push('points.deleteMany'); return { count: 0 }; }), updateMany: jest.fn(async () => ({ count: 0 })) },
    rawExternalActivity: {
      findMany: jest.fn(async ({ where }: any) => rawActivities.filter((r) => r.userId === where.userId && r.provider === where.provider)),
      update: jest.fn(async ({ where, data }: any) => { Object.assign(rawActivities.find((r) => r.id === where.id), data); return {}; }),
    },
    $queryRaw: jest.fn(async (_s: unknown, _provider: string, userId: string) => { const row = rows.get(userId); return row ? [row] : []; }),
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    providerConnectionEvent: { create: jest.fn(async ({ data }: any) => { events.push(data); return data; }), findMany: jest.fn(async () => []) },
  };
  return { prisma, rows, events, activityLogs, rawActivities, calls };
}
const fakeProviderData = () => ({ invalidateAiArtifacts: jest.fn(async () => ({})), deleteProviderData: jest.fn(async () => ({ deleted: true })) });

describe('documento de consentimento do Apple Saude', () => {
  it('categorias validas, dependencias reais e nada marcado; a v2.0 declara a saude do dia a dia que o app agora le', () => {
    for (const category of APPLE_HEALTH_CATEGORIES) expect(PROVIDER_DATA_CATEGORIES).toContain(category);
    expect([...APPLE_HEALTH_CATEGORIES].sort()).toEqual(['activity', 'activity_route', 'activity_sensors', 'body_composition', 'clinical_vitals', 'daily_activity', 'heart_rate', 'hrv', 'lifestyle_load', 'menstrual_cycle', 'mobility', 'nutrition', 'pulse_ox', 'respiratory_rate', 'resting_heart_rate', 'skin_temperature', 'sleep', 'vo2_max']);
    const ids = new Set(doc.groups.map((g) => g.id));
    for (const group of doc.groups) { expect(group.required).toBe(false); for (const r of group.requires ?? []) expect(ids.has(r)).toBe(true); }
    const text = JSON.stringify(doc);
    expect(text).toContain('últimos 3 anos');
    expect(text).toContain('não são enviados à inteligência artificial');
    expect(text).not.toContain('não importa sono');
    expect(doc.version).toBe('2.1');
    expect(text).toContain('Anthropic');
    expect(text).toContain('transferência internacional');
    expect(text).toContain('não serão vendidos nem divulgados publicamente');
    expect(doc.optionalPurposes).toHaveLength(0);
  });
});

describe('AppleHealthConsentService', () => {
  it('sem registro: modo legacy (aplicativo publicado); conceder exige aceite, versao e hash; cria o registro sem credenciais', async () => {
    const { prisma, rows, events } = fakeDb();
    const service = new AppleHealthConsentService(prisma);
    expect(await service.access('u1')).toEqual({ mode: 'legacy', allowed: new Set() });
    await expect(service.updateGroups('u1', { grant: ['workouts'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateGroups('u1', { grant: ['workouts'], acknowledged: true, version: '0.1', textHash: hash })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateGroups('u1', { grant: ['route'], ...ack })).rejects.toBeInstanceOf(BadRequestException); // percurso depende de treinos
    await service.updateGroups('u1', { grant: ['workouts', 'route'], ...ack });
    const row = rows.get('u1');
    expect(row).toMatchObject({ externalAccountId: 'u1', accessTokenEncrypted: null, refreshTokenEncrypted: null, consentVersion: doc.version, consentTextHash: hash });
    expect(row.grantedCategories).toEqual(['activity', 'activity_route']);
    expect(events.at(-1)).toMatchObject({ provider: 'apple_health', type: 'connected', details: { decision: 'granted' } });
    const access = await service.access('u1');
    expect(access.mode).toBe('recorded');
    expect([...access.allowed].sort()).toEqual(['activity', 'activity_route']);
  });

  it('retirar o grupo de percurso apaga a localizacao ANTES de gravar a retirada; retirar sensores apaga as medidas; retirar treinos leva os dependentes junto', async () => {
    const { prisma, rows, activityLogs, rawActivities, calls } = fakeDb();
    const providerData = fakeProviderData();
    const service = new AppleHealthConsentService(prisma, providerData as never);
    await service.updateGroups('u1', { grant: ['workouts', 'sensors', 'route'], ...ack });
    activityLogs.push({ id: 'a1', userId: 'u1', provider: 'apple_health', avgHeartRateBpm: 150, hasRoute: true, providerMetrics: { stepCount: 5000, distanceStatus: 'measured' } });
    rawActivities.push({ id: 'r1', userId: 'u1', provider: 'apple_health', payload: { uuid: 'x', avgHeartRateBpm: 150, distanceMeters: 5000 } });
    await service.updateGroups('u1', { revoke: ['route'] });
    expect(calls.indexOf('points.deleteMany')).toBeGreaterThanOrEqual(0);
    expect(activityLogs[0].hasRoute).toBe(false);
    expect(rows.get('u1').grantedCategories).toEqual(['activity', 'activity_sensors']);
    await service.updateGroups('u1', { revoke: ['sensors'] });
    expect(activityLogs[0]).toMatchObject({ avgHeartRateBpm: null, providerMetrics: { stepCount: null, distanceStatus: 'measured' } });
    expect(rawActivities[0].payload).toMatchObject({ avgHeartRateBpm: null, distanceMeters: 5000 }); // so' sensores saem; o resto do bruto fica
    await service.updateGroups('u1', { revoke: ['workouts'] });
    expect(rows.get('u1').grantedCategories).toEqual([]);
    expect(providerData.invalidateAiArtifacts).toHaveBeenCalled();
  });

  it('retirar tudo bloqueia a importacao na hora (modo blocked), apaga localizacao/sensores e so deixa excluir os dados depois', async () => {
    const { prisma, rows, activityLogs } = fakeDb();
    const providerData = fakeProviderData();
    const service = new AppleHealthConsentService(prisma, providerData as never);
    await service.updateGroups('u1', { grant: ['workouts', 'sensors'], ...ack });
    activityLogs.push({ id: 'a1', userId: 'u1', provider: 'apple_health', avgHeartRateBpm: 150, hasRoute: true, providerMetrics: { stepCount: 5000 } });
    await expect(service.deleteImportedData('u1')).rejects.toBeInstanceOf(ConflictException); // ainda autorizado
    expect(await service.withdrawAll('u1')).toEqual({ withdrawn: true });
    expect(rows.get('u1').disconnectedAt).toBeInstanceOf(Date);
    expect((await service.access('u1')).mode).toBe('blocked');
    expect(activityLogs[0]).toMatchObject({ avgHeartRateBpm: null, hasRoute: false });
    await service.deleteImportedData('u1');
    expect(providerData.deleteProviderData).toHaveBeenCalledWith('u1', 'apple_health');
  });

  it('texto desatualizado deixa de valer (blocked) ate reconfirmar; gravar sob lock relê as categorias', async () => {
    const { prisma, rows } = fakeDb();
    const service = new AppleHealthConsentService(prisma);
    await service.updateGroups('u1', { grant: ['workouts'], ...ack });
    rows.get('u1').consentVersion = '0.9';
    expect((await service.access('u1')).mode).toBe('blocked');
    await service.reconfirm('u1', ack);
    expect((await service.access('u1')).mode).toBe('recorded');
    const seen = await service.writeWhileAuthorized('u1', async (_tx, access) => access.mode);
    expect(seen).toBe('recorded');
    rows.get('u1').disconnectedAt = new Date();
    expect(await service.writeWhileAuthorized('u1', async (_tx, access) => access.mode)).toBe('blocked');
  });

  it('permissoes: legacyImport indica importacao anterior sem registro; grupos e historico refletem o estado', async () => {
    const { prisma } = fakeDb();
    const service = new AppleHealthConsentService(prisma);
    expect(await service.permissions('u1')).toMatchObject({ connected: false, legacyImport: true });
    await service.updateGroups('u1', { grant: ['workouts', 'sensors'], ...ack });
    const permissions = await service.permissions('u1');
    expect(permissions).toMatchObject({ connected: true, legacyImport: false });
    expect(permissions.groups.filter((g) => g.granted).map((g) => g.id)).toEqual(['workouts', 'sensors']);
  });
});
