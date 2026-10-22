import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { HealthConnectConsentService } from '../src/health-connect/health-connect-consent.service';
import { HealthConnectHealthService } from '../src/health-connect/health-connect-health.service';
import { HealthConnectIngestionService } from '../src/health-connect/health-connect-ingestion.service';
import { HEALTH_CONNECT_CATEGORIES, HEALTH_CONNECT_CONSENT } from '../src/health-connect/health-connect-consent';
import { HEALTH_RECORD_CATEGORY, normalizeHealthRecord } from '../src/health-connect/health-connect-health-records';
import { consentTextHash, purposeTextHash } from '../src/provider-hub/provider-consent.service';
import { PROVIDER_DATA_CATEGORIES } from '../src/provider-hub/provider-connector';
import { AiDataEligibility, DEVICE_CONSENT_PROVIDERS, EXTERNAL_AI_APPROVED_PROVIDERS } from '../src/ai-governance/ai-data-eligibility.service';

// Health Connect: autorizacao por categoria no servidor (22/10/2026). Dados SINTETICOS. Prova: nada e' guardado sem autorizacao, o Atlas e' separado e travado, retirar invalida, e a IA so' recebe o autorizado.

const doc = HEALTH_CONNECT_CONSENT;
const hash = consentTextHash(doc);
const ack = { acknowledged: true, version: doc.version, textHash: hash };

function fakeDb() {
  const rows = new Map<string, any>();
  const activityLogs: any[] = []; const rawActivities: any[] = []; const deleted: string[] = [];
  const events: any[] = [];
  const tables: Record<string, any[]> = { sleep: [], daily: [], hrv: [], metric: [] };
  const key = (w: any) => w.provider_userId.userId;
  const upsertTo = (name: string) => jest.fn(async ({ create }: any) => { tables[name].push(create); return create; });
  const prisma: any = {
    providerConnection: {
      findUnique: jest.fn(async ({ where }: any) => rows.get(key(where)) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => { const k = key(where); rows.set(k, { ...(rows.get(k) ?? {}), ...(rows.has(k) ? update : create) }); return rows.get(k); }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = rows.get(where.userId);
        if (!row || (where.disconnectedAt === null && row.disconnectedAt)) return { count: 0 };
        // Atualizacao condicional (M2): so' aplica se o valor lido ainda e' o gravado.
        if (where.grantedCategories?.equals !== undefined && JSON.stringify(row.grantedCategories) !== JSON.stringify(where.grantedCategories.equals)) return { count: 0 };
        if (where.grantedPurposes?.equals !== undefined && JSON.stringify(row.grantedPurposes) !== JSON.stringify(where.grantedPurposes.equals)) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      }),
    },
    activityLog: {
      updateMany: jest.fn(async ({ where, data }: any) => { for (const log of activityLogs) if (log.userId === where.userId && log.provider === where.provider) Object.assign(log, data); return { count: activityLogs.length }; }),
      findMany: jest.fn(async ({ where }: any) => activityLogs.filter((l) => l.userId === where.userId && l.provider === where.provider && l.providerMetrics)),
      update: jest.fn(async ({ where, data }: any) => { Object.assign(activityLogs.find((l) => l.id === where.id), data); return {}; }),
    },
    rawExternalActivity: {
      findMany: jest.fn(async ({ where }: any) => rawActivities.filter((r) => r.userId === where.userId && r.provider === where.provider)),
      update: jest.fn(async ({ where, data }: any) => { Object.assign(rawActivities.find((r) => r.id === where.id), data); return {}; }),
    },
    $queryRaw: jest.fn(async (_strings: unknown, _provider: string, userId: string) => { const row = rows.get(userId); return row && !row.disconnectedAt ? [row] : []; }),
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    providerConnectionEvent: { create: jest.fn(async ({ data }: any) => { events.push(data); return data; }), findMany: jest.fn(async () => []) },
    wearableSleepSummary: { upsert: upsertTo('sleep'), deleteMany: jest.fn(async () => { deleted.push('sleep'); return {}; }) }, wearableDailySummary: { upsert: upsertTo('daily'), deleteMany: jest.fn(async () => { deleted.push('daily'); return {}; }) },
    wearableHrvSummary: { upsert: upsertTo('hrv'), deleteMany: jest.fn(async () => { deleted.push('hrv'); return {}; }) }, wearableMetricRecord: { upsert: upsertTo('metric'), deleteMany: jest.fn(async () => { deleted.push('metric'); return {}; }) },
  };
  return { prisma: prisma as never, rows, events, tables, activityLogs, rawActivities, deleted, raw: prisma };
}
const config = (env: Record<string, string> = {}) => ({ get: (k: string) => env[k] }) as never;
const fakeProviderData = () => ({ invalidateAiArtifacts: jest.fn(async () => ({})), deleteProviderData: jest.fn(async () => ({ deleted: true })) });

describe('documento de consentimento do Health Connect', () => {
  it('todas as categorias existem no vocabulario, as dependencias apontam para grupos reais e nada vem marcado/obrigatorio', () => {
    for (const category of HEALTH_CONNECT_CATEGORIES) expect(PROVIDER_DATA_CATEGORIES).toContain(category);
    const ids = new Set(doc.groups.map((g) => g.id));
    expect(ids.size).toBe(doc.groups.length);
    for (const group of doc.groups) { expect(group.required).toBe(false); for (const r of group.requires ?? []) expect(ids.has(r)).toBe(true); }
    // Todas as categorias pedidas pelo treinador estao no documento.
    for (const wanted of ['activity', 'activity_sensors', 'activity_route', 'sleep', 'daily_activity', 'resting_heart_rate', 'hrv', 'vo2_max', 'body_composition']) expect(HEALTH_CONNECT_CATEGORIES).toContain(wanted);
    // Texto honesto: promete "quando disponibilizar", nunca que o dado ja' esta sendo recebido.
    expect(JSON.stringify(doc)).toContain('quando o seu relógio ou aplicativo os disponibilizar');
    expect(doc.optionalPurposes.find((p) => p.id === 'ai_external')?.screen?.version).toBe('1.0');
  });
});

describe('autorizacoes: nada presumido, Atlas separado e travado', () => {
  it('sem registro nada e autorizado; conceder exige aceite, versao e hash vigentes; cria o registro SEM credenciais', async () => {
    const { prisma, rows, events } = fakeDb();
    const service = new HealthConnectConsentService(prisma, config());
    expect((await service.allowedCategories('u1')).size).toBe(0);
    await expect(service.updateGroups('u1', { grant: ['sleep'], acknowledged: false, version: doc.version, textHash: hash })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateGroups('u1', { grant: ['sleep'], acknowledged: true, version: '0.1', textHash: hash })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateGroups('u1', { grant: ['nao_existe'], ...ack })).rejects.toBeInstanceOf(BadRequestException);
    await service.updateGroups('u1', { grant: ['exercise', 'sleep'], ...ack });
    const row = rows.get('u1');
    expect(row).toMatchObject({ externalAccountId: 'u1', accessTokenEncrypted: null, refreshTokenEncrypted: null, consentVersion: doc.version, disconnectedAt: null });
    expect([...(await service.allowedCategories('u1'))].sort()).toEqual(['activity', 'sleep']);
    expect(await service.isAllowed('u1', 'hrv')).toBe(false); // nao marcada: nao vale
    expect(events.some((e) => e.type === 'connected' && e.details.decision === 'granted')).toBe(true);
  });

  it('dependencia: sensores sem exercicios e recusado; retirar exercicios retira os sensores junto; retirar invalida os artefatos de IA', async () => {
    const { prisma } = fakeDb(); const providerData = fakeProviderData();
    const service = new HealthConnectConsentService(prisma, config(), providerData as never);
    await expect(service.updateGroups('u1', { grant: ['exercise_sensors'], ...ack })).rejects.toBeInstanceOf(BadRequestException);
    await service.updateGroups('u1', { grant: ['exercise', 'exercise_sensors', 'sleep'], ...ack });
    await service.updateGroups('u1', { revoke: ['exercise'] }); // revogar nao exige aceite
    expect([...(await service.allowedCategories('u1'))]).toEqual(['sleep']);
    expect(providerData.invalidateAiArtifacts).toHaveBeenCalledWith('u1', 'health_connect');
  });

  it('Atlas: separado dos grupos, so com a tela propria (versao+hash dela), travado ate o sistema liberar; revogar invalida a IA', async () => {
    const atlas = doc.optionalPurposes.find((p) => p.id === 'ai_external')!;
    const atlasAck = { acknowledged: true, version: atlas.screen!.version, textHash: purposeTextHash(atlas) };
    const locked = fakeDb(); const lockedService = new HealthConnectConsentService(locked.prisma, config());
    await lockedService.updateGroups('u1', { grant: ['sleep'], ...ack });
    await expect(lockedService.updatePurposes('u1', { grant: ['ai_external'], ...atlasAck })).rejects.toBeInstanceOf(ConflictException); // sistema ainda nao liberou
    expect((await lockedService.permissions('u1')).purposes.find((p) => p.id === 'ai_external')).toMatchObject({ granted: false, available: false });
    const open = fakeDb(); const providerData = fakeProviderData();
    const service = new HealthConnectConsentService(open.prisma, config({ HEALTH_CONNECT_EXTERNAL_AI_ENABLED: 'true' }), providerData as never);
    await expect(service.updatePurposes('u1', { grant: ['ai_external'], ...atlasAck })).rejects.toBeInstanceOf(ConflictException); // sem nenhuma autorizacao de dados ainda
    await service.updateGroups('u1', { grant: ['sleep'], ...ack });
    await expect(service.updatePurposes('u1', { grant: ['ai_external'], ...ack })).rejects.toBeInstanceOf(ConflictException); // texto da CONEXAO nao vale para o Atlas
    await service.updatePurposes('u1', { grant: ['ai_external'], ...atlasAck });
    expect((await service.permissions('u1')).purposes.find((p) => p.id === 'ai_external')).toMatchObject({ granted: true, available: true });
    await service.updatePurposes('u1', { revoke: ['ai_external'] });
    expect(providerData.invalidateAiArtifacts).toHaveBeenCalled();
    expect((await service.permissions('u1')).purposes.find((p) => p.id === 'ai_external')?.granted).toBe(false);
  });

  it('texto da conexao mudou depois da autorizacao: nada vale ate reconfirmar; retirar tudo encerra e zera as categorias', async () => {
    const { prisma, rows } = fakeDb();
    const service = new HealthConnectConsentService(prisma, config());
    await service.updateGroups('u1', { grant: ['sleep'], ...ack });
    rows.get('u1').consentVersion = '0.9';
    expect((await service.allowedCategories('u1')).size).toBe(0);
    expect((await service.permissions('u1')).consent.needsReview).toBe(true);
    await service.reconfirm('u1', ack);
    expect(await service.isAllowed('u1', 'sleep')).toBe(true);
    expect(await service.withdrawAll('u1')).toEqual({ withdrawn: true });
    expect((await service.allowedCategories('u1')).size).toBe(0);
    expect(rows.get('u1').grantedCategories).toEqual([]);
    // conceder de novo depois de retirar recria uma autorizacao limpa (sem finalidades opcionais antigas)
    await service.updateGroups('u1', { grant: ['hrv'], ...ack });
    expect([...(await service.allowedCategories('u1'))]).toEqual(['hrv']);
    expect(rows.get('u1').purposeConsents).toEqual({});
  });
});

const sleepRecord = (over: Record<string, unknown> = {}) => ({
  kind: 'sleep', recordId: 'sl-1', dataOrigin: 'com.sec.android.app.shealth', startTime: '2026-10-21T01:00:00.000Z', endTime: '2026-10-21T09:00:00.000Z', startZoneOffsetSeconds: -10800,
  stages: [{ stage: 4, startTime: '2026-10-21T01:00:00.000Z', endTime: '2026-10-21T04:00:00.000Z' }, { stage: 5, startTime: '2026-10-21T04:00:00.000Z', endTime: '2026-10-21T06:00:00.000Z' }, { stage: 6, startTime: '2026-10-21T06:00:00.000Z', endTime: '2026-10-21T08:30:00.000Z' }, { stage: 1, startTime: '2026-10-21T08:30:00.000Z', endTime: '2026-10-21T09:00:00.000Z' }], ...over,
});

describe('registros de saude: so o autorizado e guardado, sem estimar nada', () => {
  it('sono: soma os segmentos entregues por etapa; sem segmentos as etapas ficam nulas (nunca zero); data local pelo fuso', () => {
    const ok = normalizeHealthRecord(sleepRecord());
    expect(ok.ok && ok.value.type === 'sleep' && ok.value).toMatchObject({ calendarDate: '2026-10-21', data: { durationSec: 8 * 3600, lightSleepSec: 3 * 3600, deepSleepSec: 2 * 3600, remSleepSec: 2.5 * 3600, awakeSec: 1800 } });
    const plain = normalizeHealthRecord(sleepRecord({ stages: [] }));
    expect(plain.ok && plain.value.type === 'sleep' && plain.value.data).toMatchObject({ deepSleepSec: null, lightSleepSec: null, remSleepSec: null, awakeSec: null, durationSec: 8 * 3600 });
    for (const bad of [null, 'x', { kind: 'sleep' }, sleepRecord({ endTime: '2026-10-20T00:00:00.000Z' }), { kind: 'desconhecido' }, { kind: 'daily', calendarDate: '2026-10-21', startTime: '2026-10-21T03:00:00.000Z' }]) expect(normalizeHealthRecord(bad).ok).toBe(false);
  });

  it('cada tipo exige a sua categoria; sem autorizacao ativa a chamada e recusada; sem a categoria o registro e rejeitado e NADA e gravado', async () => {
    const { prisma, tables } = fakeDb();
    const consent = new HealthConnectConsentService(prisma, config());
    const health = new HealthConnectHealthService(consent);
    await expect(health.importRecords('u1', { records: [sleepRecord()] })).rejects.toBeInstanceOf(ForbiddenException);
    await consent.updateGroups('u1', { grant: ['sleep'], ...ack });
    const result = await health.importRecords('u1', { records: [sleepRecord(), { kind: 'hrv', recordId: 'h1', calendarDate: '2026-10-21', startTime: '2026-10-21T03:00:00.000Z', lastNightAvg: 55 }, { kind: 'vo2_max', recordId: 'v1', startTime: '2026-10-21T03:00:00.000Z', values: { vo2MillilitersPerMinuteKilogram: 48 } }] });
    expect(result).toMatchObject({ stored: 1, rejected: 2 });
    expect(result.items.filter((i) => i.reason === 'categoria_nao_autorizada')).toHaveLength(2);
    expect(tables.sleep).toHaveLength(1);
    expect(tables.sleep[0]).toMatchObject({ userId: 'u1', provider: 'health_connect' });
    expect(tables.hrv).toHaveLength(0);
    expect(tables.metric).toHaveLength(0);
  });

  it('FC de repouso e atividade do dia sao categorias independentes no registro diario', async () => {
    const day = { kind: 'daily', calendarDate: '2026-10-21', startTime: '2026-10-21T03:00:00.000Z', startZoneOffsetSeconds: -10800, steps: 9000, distanceMeters: 6500, activeKilocalories: 420, restingHeartRateBpm: 52 };
    const onlyResting = fakeDb();
    const c1 = new HealthConnectConsentService(onlyResting.prisma, config());
    await c1.updateGroups('u1', { grant: ['resting_hr'], ...ack });
    await new HealthConnectHealthService(c1).importRecords('u1', { records: [day] });
    expect(onlyResting.tables.daily[0]).toMatchObject({ steps: null, distanceMeters: null, activeKilocalories: null, restingHeartRateBpm: 52 });
    const onlyDaily = fakeDb();
    const c2 = new HealthConnectConsentService(onlyDaily.prisma, config());
    await c2.updateGroups('u1', { grant: ['daily'], ...ack });
    await new HealthConnectHealthService(c2).importRecords('u1', { records: [day] });
    expect(onlyDaily.tables.daily[0]).toMatchObject({ steps: 9000, restingHeartRateBpm: null });
    expect(HEALTH_RECORD_CATEGORY.daily_energy).toBe('daily_activity');
  });

  it('indicadores (VO2 max, composicao corporal, SpO2...) ficam com os campos ORIGINAIS e a origem (app/dispositivo) preservada', async () => {
    const { prisma, tables } = fakeDb();
    const consent = new HealthConnectConsentService(prisma, config());
    await consent.updateGroups('u1', { grant: ['fitness', 'body'], ...ack });
    await new HealthConnectHealthService(consent).importRecords('u1', { records: [
      { kind: 'vo2_max', recordId: 'v1', dataOrigin: 'com.sec.android.app.shealth', device: { manufacturer: 'Samsung', model: 'Galaxy Watch' }, startTime: '2026-10-21T03:00:00.000Z', values: { vo2MillilitersPerMinuteKilogram: 48.5, measurementMethod: 1 } },
      { kind: 'body_composition', recordId: 'b1', startTime: '2026-10-21T03:00:00.000Z', values: { weightKg: 70.5, bodyFatPercentage: 14.2 } },
    ] });
    expect(tables.metric).toHaveLength(2);
    expect(tables.metric[0]).toMatchObject({ metricKind: 'vo2_max', values: { vo2MillilitersPerMinuteKilogram: 48.5, _origin: { dataOrigin: 'com.sec.android.app.shealth', device: { manufacturer: 'Samsung', model: 'Galaxy Watch' } } } });
    expect(tables.metric[1].values).toMatchObject({ weightKg: 70.5, bodyFatPercentage: 14.2 });
  });
});

describe('exercicios: gate por categoria e sensores como categoria propria', () => {
  function ingestion(grant: string[]) {
    const logs: any[] = [];
    const tx = {
      activityLog: { findUnique: async () => null, create: async ({ data }: any) => { logs.push(data); return { id: `l${logs.length}`, ...data }; }, update: async () => ({}) },
      rawExternalActivity: { upsert: async ({ create }: any) => ({ id: 'r1', ...create }), update: async () => ({}) },
    };
    const db = fakeDb();
    const consent = new HealthConnectConsentService(db.prisma, config());
    const service = new HealthConnectIngestionService({ $transaction: async (fn: any) => fn(tx) } as never, undefined, undefined, consent);
    return { service, logs, setup: async () => { if (grant.length) await consent.updateGroups('u1', { grant, ...ack }); } };
  }
  const exercise = { recordId: 'e1', dataOrigin: 'com.sec.android.app.shealth', exerciseType: 56, startTime: '2026-10-21T09:00:00.000Z', endTime: '2026-10-21T09:55:00.000Z', distanceMeters: 10000, avgHeartRateBpm: 150, maxHeartRateBpm: 175, heartRateSampleCount: 300, powerAvgWatts: 250, cadenceAvgPerMin: 170, elevationGainMeters: 40, speedAvgMps: 3, activeKilocalories: 700 };

  it('sem autorizacao de exercicios nada e guardado (403); com exercicios mas sem sensores, FC/potencia/cadencia/elevacao NAO entram; com sensores entram', async () => {
    const none = ingestion([]); await none.setup();
    await expect(none.service.importExercises('u1', { exercises: [exercise] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(none.logs).toHaveLength(0);
    const noSensors = ingestion(['exercise']); await noSensors.setup();
    await noSensors.service.importExercises('u1', { exercises: [exercise] });
    expect(noSensors.logs[0]).toMatchObject({ distanceMeters: 10000, avgHeartRateBpm: null, maxHeartRateBpm: null });
    expect(JSON.stringify(noSensors.logs[0].providerMetrics)).not.toContain('"powerAvgWatts":250');
    const withSensors = ingestion(['exercise', 'exercise_sensors']); await withSensors.setup();
    await withSensors.service.importExercises('u1', { exercises: [exercise] });
    expect(withSensors.logs[0]).toMatchObject({ avgHeartRateBpm: 150, maxHeartRateBpm: 175 });
    expect(withSensors.logs[0].providerMetrics.sensors).toMatchObject({ powerAvgWatts: 250, cadenceAvgPerMin: 170, elevationGainMeters: 40, speedAvgMps: 3 });
    expect(withSensors.logs[0].providerMetrics.energy).toMatchObject({ activeKilocalories: 700 });
  });
});

describe('IA: o Health Connect deixou de ser "legado elegivel"; so o autorizado e liberado chega ao Atlas', () => {
  it('liberado para IA externa na lista do codigo e tratado como provedor com consentimento do aparelho', () => {
    expect(EXTERNAL_AI_APPROVED_PROVIDERS).toContain('health_connect');
    expect(DEVICE_CONSENT_PROVIDERS.health_connect).toBe(doc);
  });

  async function eligibility(env: Record<string, string>) {
    const db = fakeDb();
    const consent = new HealthConnectConsentService(db.prisma, config(env));
    const prisma: any = { ...(db.prisma as object), activityLog: { findMany: async () => [{ provider: 'health_connect' }] } };
    const registry: any = { list: () => [], get: () => undefined };
    return { consent, eligibility: new AiDataEligibility(prisma, registry, config(env)) };
  }
  const atlas = doc.optionalPurposes.find((p) => p.id === 'ai_external')!;
  const atlasAck = { acknowledged: true, version: atlas.screen!.version, textHash: purposeTextHash(atlas) };

  it('sem autorizacao ou com a variavel desligada: bloqueado (inclusive saude por categoria); autorizado + liberado: permitido so nas categorias marcadas', async () => {
    const off = await eligibility({});
    await off.consent.updateGroups('u1', { grant: ['sleep'], ...ack });
    expect(await off.eligibility.decide('u1', 'health_connect', { category: 'sleep', destination: 'external_ai' })).toMatchObject({ allowed: false, reason: 'provider_locked' });

    const on = await eligibility({ HEALTH_CONNECT_EXTERNAL_AI_ENABLED: 'true' });
    expect(await on.eligibility.decide('u1', 'health_connect', { category: 'sleep', destination: 'external_ai' })).toMatchObject({ allowed: false, reason: 'not_connected' });
    await on.consent.updateGroups('u1', { grant: ['sleep', 'exercise'], ...ack });
    expect(await on.eligibility.decide('u1', 'health_connect', { category: 'sleep', destination: 'external_ai' })).toMatchObject({ allowed: false, reason: 'purpose_not_granted' }); // Atlas ainda nao autorizado
    await on.consent.updatePurposes('u1', { grant: ['ai_external'], ...atlasAck });
    expect(await on.eligibility.decide('u1', 'health_connect', { category: 'sleep', destination: 'external_ai' })).toMatchObject({ allowed: true });
    expect(await on.eligibility.decide('u1', 'health_connect', { category: 'hrv', destination: 'external_ai' })).toMatchObject({ allowed: false, reason: 'category_not_granted' });
    const scope = await on.eligibility.scopeFor('u1', 'external_ai', 'activity');
    expect(scope.blocked).not.toContain('health_connect');
    expect(scope.blockedHealth).toContain('health_connect:hrv');
    expect(scope.blockedHealth).not.toContain('health_connect:sleep');
    await on.consent.updatePurposes('u1', { revoke: ['ai_external'] });
    expect((await on.eligibility.scopeFor('u1', 'external_ai', 'activity')).blocked).toContain('health_connect');
  });
});

describe('revisao independente (22/10/2026): sensores retirados, lock, conflito, exclusao', () => {
  const granted = async (groups: string[], withData = true) => {
    const db = fakeDb(); const providerData = fakeProviderData();
    const consent = new HealthConnectConsentService(db.prisma, config(), providerData as never);
    await consent.updateGroups('u1', { grant: groups, ...ack });
    if (withData) {
      db.activityLogs.push({ id: 'l1', userId: 'u1', provider: 'health_connect', avgHeartRateBpm: 150, maxHeartRateBpm: 175, cadenceAvg: 170, powerAvgWatts: 250, elevationGainMeters: 40, distanceMeters: 10000, providerMetrics: { channel: 'health_connect', heartRate: { sampleCount: 300 }, sensors: { powerAvgWatts: 250 }, energy: { activeKilocalories: 700 } } });
      db.rawActivities.push({ id: 'r1', userId: 'u1', provider: 'health_connect', payload: { recordId: 'e1', distanceMeters: 10000, avgHeartRateBpm: 150, powerAvgWatts: 250, cadenceAvgPerMin: 170 } });
    }
    return { db, consent, providerData };
  };

  it('A2: retirar SO os sensores apaga FC/potencia/cadencia/elevacao ja guardados (coluna, resumo e bruto), mantem distancia e invalida a IA', async () => {
    const { db, consent, providerData } = await granted(['exercise', 'exercise_sensors']);
    await consent.updateGroups('u1', { revoke: ['exercise_sensors'] });
    expect(db.activityLogs[0]).toMatchObject({ avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null, distanceMeters: 10000 });
    expect(db.activityLogs[0].providerMetrics).toEqual({ channel: 'health_connect', energy: { activeKilocalories: 700 } });
    expect(db.rawActivities[0].payload).toMatchObject({ distanceMeters: 10000, avgHeartRateBpm: null, powerAvgWatts: null, cadenceAvgPerMin: null });
    expect(providerData.invalidateAiArtifacts).toHaveBeenCalledWith('u1', 'health_connect');
    expect(await consent.isAllowed('u1', 'activity')).toBe(true);
    expect(await consent.isAllowed('u1', 'activity_sensors')).toBe(false);
  });

  it('retirar so outra categoria (sono) NAO mexe nos sensores', async () => {
    const { db, consent } = await granted(['exercise', 'exercise_sensors', 'sleep']);
    await consent.updateGroups('u1', { revoke: ['sleep'] });
    expect(db.activityLogs[0].avgHeartRateBpm).toBe(150);
  });

  it('M1: retirada NO MEIO do lote: o registro seguinte nao e gravado (autorizacao relida com lock em cada registro)', async () => {
    const { db, consent } = await granted(['sleep'], false);
    const health = new HealthConnectHealthService(consent);
    const original = db.raw.wearableSleepSummary.upsert;
    db.raw.wearableSleepSummary.upsert = jest.fn(async (args: any) => { const r = await original(args); db.rows.get('u1').disconnectedAt = new Date(); return r; }); // revoga logo apos o 1o registro
    const result = await health.importRecords('u1', { records: [sleepRecord({ recordId: 's-a' }), sleepRecord({ recordId: 's-b', startTime: '2026-10-20T01:00:00.000Z', endTime: '2026-10-20T09:00:00.000Z' })] });
    expect(result).toMatchObject({ stored: 1, rejected: 1 });
    expect(result.items[1].reason).toBe('autorizacao_encerrada');
    expect(db.tables.sleep).toHaveLength(1);
  });

  it('M2: duas alteracoes simultaneas nao se sobrescrevem — a segunda recebe conflito e a revogacao nao se perde', async () => {
    const { db, consent } = await granted(['sleep', 'hrv'], false);
    const real = db.raw.providerConnection.findUnique;
    let first = true;
    db.raw.providerConnection.findUnique = jest.fn(async (args: any) => { const row = await real(args); if (first && row) { first = false; return { ...row, grantedCategories: ['sleep', 'hrv'] }; } return row; });
    db.rows.get('u1').grantedCategories = ['hrv']; // outra chamada ja revogou o sono depois da leitura da primeira
    await expect(consent.updateGroups('u1', { grant: ['fitness'], ...ack })).rejects.toBeInstanceOf(ConflictException);
    expect(db.rows.get('u1').grantedCategories).toEqual(['hrv']);
  });

  it('M6: excluir os dados importados exige estar sem autorizacao ativa; depois apaga atividades e as 4 tabelas de saude do provedor', async () => {
    const { db, consent, providerData } = await granted(['sleep'], false);
    await expect(consent.deleteImportedData('u1')).rejects.toBeInstanceOf(ConflictException);
    await consent.withdrawAll('u1');
    await consent.deleteImportedData('u1');
    expect(providerData.deleteProviderData).toHaveBeenCalledWith('u1', 'health_connect');
    expect(db.deleted.sort()).toEqual(['daily', 'hrv', 'metric', 'sleep']);
    expect(db.events.some((e) => e.type === 'data_deleted')).toBe(true);
  });

  it('baixo: tipos herdados do prototipo (constructor, __proto__) sao tipo desconhecido; chaves perigosas nao entram em values', () => {
    expect(normalizeHealthRecord({ kind: 'constructor', recordId: 'x' })).toMatchObject({ ok: false, reason: 'tipo_desconhecido' });
    expect(normalizeHealthRecord({ kind: '__proto__', recordId: 'x' })).toMatchObject({ ok: false, reason: 'tipo_desconhecido' });
    const out = normalizeHealthRecord({ kind: 'vo2_max', recordId: 'v', startTime: '2026-10-21T03:00:00.000Z', values: JSON.parse('{"ok": 1, "constructor": {"x": 1}, "__proto__": {"y": 2}}') });
    expect(out.ok && out.value.type === 'metric' && Object.keys(out.value.values)).toEqual(expect.arrayContaining(['ok']));
    expect(out.ok && out.value.type === 'metric' && Object.keys(out.value.values)).not.toContain('constructor');
  });
});
