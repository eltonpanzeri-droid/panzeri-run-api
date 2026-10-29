import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { AppleHealthRecordsService } from '../src/apple-health/apple-health-records.service';
import { AppleHealthConsentService } from '../src/apple-health/apple-health-consent.service';
import { APPLE_HEALTH_CONSENT } from '../src/apple-health/apple-health-consent';
import { APPLE_HEALTH_RECORD_CATEGORIES, APPLE_RECORD_CATEGORY, metricKindsOfCategory } from '../src/apple-health/apple-health-records';
import { PROVIDER_DATA_CATEGORIES } from '../src/provider-hub/provider-connector';

// Saude do dia a dia do Apple Saude (29/10/2026): recebimento por categoria autorizada, idempotencia, ausencia != zero, rotulo da HRV (SDNN) e limpeza por categoria retirada. Dados SINTETICOS.

type Row = Record<string, any>;

// Banco em memoria com as 4 tabelas Wearable*: upsert pela chave natural, deleteMany e updateMany com igualdade / { in } / null.
function fakeDb() {
  const tables: Record<string, Row[]> = { wearableSleepSummary: [], wearableDailySummary: [], wearableHrvSummary: [], wearableMetricRecord: [] };
  const keyOf = (table: string, where: Row): Row => (table === 'wearableMetricRecord' ? where.userId_provider_metricKind_identityKey : where.userId_provider_calendarDate_startTimeSec);
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'in' in v ? v.in.includes(row[k]) : row[k] === v));
  const model = (table: string) => ({
    upsert: async ({ where, create, update }: Row) => {
      const key = keyOf(table, where);
      const existing = tables[table].find((r) => Object.entries(key).every(([k, v]) => r[k] === v));
      if (existing) Object.assign(existing, update); else tables[table].push({ ...create });
    },
    deleteMany: async ({ where }: Row) => { const before = tables[table].length; tables[table] = tables[table].filter((r) => !matches(r, where)); return { count: before - tables[table].length }; },
    updateMany: async ({ where, data }: Row) => { const hit = tables[table].filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
  });
  const db: any = Object.fromEntries(Object.keys(tables).map((t) => [t, model(t)]));
  return { db, tables };
}

function setup(mode: 'legacy' | 'recorded' | 'blocked', allowed: string[]) {
  const { db, tables } = fakeDb();
  let current = { mode, allowed: new Set(allowed) };
  const consent = {
    access: async () => current,
    writeWhileAuthorized: async (_userId: string, fn: (tx: any, access: any) => Promise<unknown>) => fn(db, current),
  } as unknown as AppleHealthConsentService;
  return { service: new AppleHealthRecordsService(consent), tables, db, setAccess: (m: 'legacy' | 'recorded' | 'blocked', a: string[]) => { current = { mode: m, allowed: new Set(a) }; } };
}

const T = '2026-10-20T03:00:00.000Z';
const sleepRecord = (extra: Row = {}) => ({
  kind: 'sleep', recordId: 'sleep-1', startTime: '2026-10-19T01:30:00.000Z', endTime: '2026-10-19T09:30:00.000Z', startZoneOffsetSeconds: -10800, dataOrigin: 'com.apple.health.watch',
  stages: [
    { startTime: '2026-10-19T01:30:00.000Z', endTime: '2026-10-19T03:30:00.000Z', stage: 4, sourceStage: 3 }, // basico (core) -> leve
    { startTime: '2026-10-19T03:30:00.000Z', endTime: '2026-10-19T04:30:00.000Z', stage: 5, sourceStage: 4 },
    { startTime: '2026-10-19T04:30:00.000Z', endTime: '2026-10-19T05:00:00.000Z', stage: 6, sourceStage: 5 },
    { startTime: '2026-10-19T05:00:00.000Z', endTime: '2026-10-19T05:10:00.000Z', stage: 1, sourceStage: 2 },
  ],
  ...extra,
});

describe('catalogo de tipos e categorias', () => {
  it('toda categoria de saude do Apple existe no vocabulario de provedores e e oferecida por algum grupo do consentimento', () => {
    const offered = new Set(APPLE_HEALTH_CONSENT.groups.flatMap((g) => g.categories as readonly string[]));
    for (const category of APPLE_HEALTH_RECORD_CATEGORIES) {
      expect(PROVIDER_DATA_CATEGORIES as readonly string[]).toContain(category);
      expect(offered.has(category)).toBe(true);
    }
  });

  it('todo tipo de registro mapeia para uma categoria oferecida no consentimento (nada e coletado sem pergunta)', () => {
    const offered = new Set(APPLE_HEALTH_CONSENT.groups.flatMap((g) => g.categories as readonly string[]));
    for (const [kind, category] of Object.entries(APPLE_RECORD_CATEGORY)) expect({ kind, offered: offered.has(category) }).toEqual({ kind, offered: true });
  });

  it('dados sensiveis (percurso, pressao, glicemia, ciclo) nao entram nas categorias de IA', async () => {
    const { HEALTH_AI_CATEGORIES } = await import('../src/ai-governance/ai-data-eligibility.service');
    for (const sensitive of ['activity_route', 'clinical_vitals', 'menstrual_cycle']) expect(HEALTH_AI_CATEGORIES as readonly string[]).not.toContain(sensitive);
  });

  it('as categorias de indicadores genericos apagaveis cobrem todos os tipos genericos', () => {
    const generic = Object.keys(APPLE_RECORD_CATEGORY).filter((k) => !['sleep', 'hrv', 'daily'].includes(k));
    const covered = new Set(APPLE_HEALTH_RECORD_CATEGORIES.flatMap((c) => metricKindsOfCategory(c)));
    for (const kind of generic) expect(covered.has(kind)).toBe(true);
  });
});

describe('recebimento de registros de saude do Apple', () => {
  it('sem consentimento registrado (aplicativo antigo), bloqueado ou sem nenhuma categoria de saude: recusa a chamada inteira', async () => {
    for (const [mode, allowed] of [['legacy', []], ['blocked', ['sleep']], ['recorded', ['activity', 'activity_sensors']]] as const) {
      const { service, tables } = setup(mode, [...allowed]);
      await expect(service.importRecords('u1', { records: [sleepRecord()] })).rejects.toBeInstanceOf(ForbiddenException);
      expect(tables.wearableSleepSummary).toHaveLength(0);
    }
  });

  it('valida o corpo: lista vazia, ausente ou maior que 100 -> 400', async () => {
    const { service } = setup('recorded', ['sleep']);
    for (const body of [{}, { records: [] }, { records: Array.from({ length: 101 }, () => sleepRecord()) }, null]) await expect(service.importRecords('u1', body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sono: guarda duracao e etapas, preserva a etapa original do Apple, a origem e e idempotente (reenviar nao duplica)', async () => {
    const { service, tables } = setup('recorded', ['sleep']);
    const first = await service.importRecords('u1', { records: [sleepRecord()] });
    expect(first).toMatchObject({ stored: 1, rejected: 0 });
    const again = await service.importRecords('u1', { records: [sleepRecord()] });
    expect(again.stored).toBe(1);
    expect(tables.wearableSleepSummary).toHaveLength(1);
    const row = tables.wearableSleepSummary[0];
    expect(row).toMatchObject({ userId: 'u1', provider: 'apple_health', calendarDate: '2026-10-19', durationSec: 8 * 3600, lightSleepSec: 2 * 3600, deepSleepSec: 3600, remSleepSec: 1800, awakeSec: 600 });
    expect(row.providerSummaryId).toContain('com.apple.health.watch');
    expect(row.levels[0]).toMatchObject({ stage: 4, sourceStage: 3 });
  });

  it('sono sem etapas: duracao guardada e a divisao fica NULA (nunca zero inventado)', async () => {
    const { service, tables } = setup('recorded', ['sleep']);
    await service.importRecords('u1', { records: [sleepRecord({ stages: [] })] });
    expect(tables.wearableSleepSummary[0]).toMatchObject({ durationSec: 8 * 3600, deepSleepSec: null, lightSleepSec: null, remSleepSec: null, awakeSec: null });
  });

  it('categoria nao autorizada: o registro e recusado e nada e gravado; os autorizados do mesmo lote sao gravados', async () => {
    const { service, tables } = setup('recorded', ['sleep']);
    const result = await service.importRecords('u1', {
      records: [
        sleepRecord(),
        { kind: 'menstrual_cycle', recordId: 'mc-1', startTime: T, calendarDate: '2026-10-20', values: { flow: 2 } },
        { kind: 'body_composition', recordId: '2026-10-20', startTime: T, calendarDate: '2026-10-20', values: { bodyMassKg: 70 } },
      ],
    });
    expect(result.items.map((i) => [i.status, i.reason])).toEqual([['stored', undefined], ['rejected', 'categoria_nao_autorizada'], ['rejected', 'categoria_nao_autorizada']]);
    expect(tables.wearableMetricRecord).toHaveLength(0);
    expect(tables.wearableSleepSummary).toHaveLength(1);
  });

  it('tipo desconhecido e registro invalido sao recusados com motivo, sem derrubar o lote', async () => {
    const { service } = setup('recorded', ['sleep']);
    const result = await service.importRecords('u1', { records: [{ kind: 'qualquer_coisa', startTime: T }, null, sleepRecord()] });
    expect(result.items.map((i) => i.reason ?? i.status)).toEqual(['tipo_desconhecido', 'registro_invalido', 'stored']);
  });

  it('dia: passos 0 informado e guardado como 0; ausente fica nulo; so a categoria autorizada e gravada', async () => {
    const day = { kind: 'daily', calendarDate: '2026-10-20', startTime: T, startZoneOffsetSeconds: -10800, steps: 0, distanceMeters: 0, restingHeartRateBpm: 52, dataOrigin: 'com.apple.health' };
    const both = setup('recorded', ['daily_activity', 'resting_heart_rate']);
    await both.service.importRecords('u1', { records: [day] });
    expect(both.tables.wearableDailySummary[0]).toMatchObject({ steps: 0, distanceMeters: 0, activeKilocalories: null, restingHeartRateBpm: 52 });
    const onlyResting = setup('recorded', ['resting_heart_rate']);
    await onlyResting.service.importRecords('u1', { records: [day] });
    expect(onlyResting.tables.wearableDailySummary[0]).toMatchObject({ steps: null, distanceMeters: null, restingHeartRateBpm: 52 });
    const onlyDaily = setup('recorded', ['daily_activity']);
    await onlyDaily.service.importRecords('u1', { records: [day] });
    expect(onlyDaily.tables.wearableDailySummary[0]).toMatchObject({ steps: 0, restingHeartRateBpm: null });
  });

  it('HRV do Apple e SDNN, nao RMSSD: o rotulo da metrica acompanha o valor', async () => {
    const { service, tables } = setup('recorded', ['hrv']);
    await service.importRecords('u1', { records: [{ kind: 'hrv', calendarDate: '2026-10-20', startTime: T, lastNightAvg: 48.2, sampleCount: 6, hrvMetric: 'sdnn_ms' }] });
    expect(tables.wearableHrvSummary[0]).toMatchObject({ provider: 'apple_health', lastNightAvg: 48.2 });
    expect(tables.wearableHrvSummary[0].hrvValues).toEqual({ metric: 'sdnn_ms', sampleCount: 6 });
  });

  it('indicador generico: valores e unidades preservados, idempotente por tipo+identidade, origem guardada; revogacao no meio do lote nao grava', async () => {
    const { service, tables, setAccess } = setup('recorded', ['body_composition', 'mobility']);
    const body = { kind: 'body_composition', recordId: '2026-10-20', startTime: T, calendarDate: '2026-10-20', dataOrigin: 'com.apple.health', values: { bodyMassKg: 70.4, bodyFatFraction: 0.18 } };
    await service.importRecords('u1', { records: [body] });
    await service.importRecords('u1', { records: [{ ...body, values: { bodyMassKg: 70.1, bodyFatFraction: 0.18 } }] });
    expect(tables.wearableMetricRecord).toHaveLength(1);
    expect(tables.wearableMetricRecord[0]).toMatchObject({ provider: 'apple_health', metricKind: 'body_composition', identityKey: 'body_composition:2026-10-20' });
    expect(tables.wearableMetricRecord[0].values).toMatchObject({ bodyMassKg: 70.1, bodyFatFraction: 0.18 });
    // retirada entre o inicio e o fim da chamada: a leitura dentro da transacao ja ve a retirada
    setAccess('blocked', []);
    const late = await service.importRecords('u1', { records: [{ kind: 'mobility', recordId: '2026-10-20', startTime: T, values: { walkingSpeedMs: 1.2 } }] }).catch((e) => e);
    expect(late).toBeInstanceOf(ForbiddenException);
    expect(tables.wearableMetricRecord).toHaveLength(1);
  });
});

describe('retirada de categoria apaga apenas o que ela guardou', () => {
  const seed = (tables: Record<string, Row[]>) => {
    const mine = { userId: 'u1', provider: 'apple_health' };
    tables.wearableSleepSummary.push({ ...mine, calendarDate: '2026-10-19' }, { userId: 'u1', provider: 'health_connect', calendarDate: '2026-10-19' }, { userId: 'u2', provider: 'apple_health', calendarDate: '2026-10-19' });
    tables.wearableHrvSummary.push({ ...mine, calendarDate: '2026-10-19' });
    tables.wearableDailySummary.push({ ...mine, calendarDate: '2026-10-19', steps: 8000, distanceMeters: 6000, activeKilocalories: 400, stepsGoal: 10000, restingHeartRateBpm: 52 }, { ...mine, calendarDate: '2026-10-20', steps: 100, distanceMeters: null, activeKilocalories: null, restingHeartRateBpm: null });
    tables.wearableMetricRecord.push({ ...mine, metricKind: 'menstrual_cycle' }, { ...mine, metricKind: 'body_composition' }, { ...mine, metricKind: 'daily_energy' }, { userId: 'u1', provider: 'zepp', metricKind: 'body_composition' });
  };
  const scrub = (tables: Row, db: any, categories: string[]) => (AppleHealthConsentService.prototype as any).scrubHealthData.call({}, 'u1', categories, db);

  it('sono: apaga so o sono do Apple desta aluna; Health Connect e outra aluna ficam', async () => {
    const { db, tables } = fakeDb(); seed(tables);
    await scrub(tables, db, ['sleep']);
    expect(tables.wearableSleepSummary.map((r) => `${r.userId}:${r.provider}`).sort()).toEqual(['u1:health_connect', 'u2:apple_health']);
    expect(tables.wearableHrvSummary).toHaveLength(1);
    expect(tables.wearableMetricRecord).toHaveLength(4);
  });

  it('atividade do dia: zera so as colunas dela, mantem a FC de repouso e remove a linha que ficou vazia', async () => {
    const { db, tables } = fakeDb(); seed(tables);
    await scrub(tables, db, ['daily_activity']);
    expect(tables.wearableDailySummary).toHaveLength(1);
    expect(tables.wearableDailySummary[0]).toMatchObject({ steps: null, distanceMeters: null, activeKilocalories: null, stepsGoal: null, restingHeartRateBpm: 52 });
    expect(tables.wearableMetricRecord.map((r) => `${r.provider}:${r.metricKind}`)).not.toContain('apple_health:daily_energy');
    expect(tables.wearableMetricRecord.map((r) => `${r.provider}:${r.metricKind}`)).toContain('apple_health:body_composition');
  });

  it('ciclo menstrual: apaga so os registros de ciclo; outras categorias e outros provedores ficam', async () => {
    const { db, tables } = fakeDb(); seed(tables);
    await scrub(tables, db, ['menstrual_cycle']);
    expect(tables.wearableMetricRecord.map((r) => `${r.provider}:${r.metricKind}`).sort()).toEqual(['apple_health:body_composition', 'apple_health:daily_energy', 'zepp:body_composition']);
  });

  it('retirada total: nada do Apple Saude desta aluna permanece nas quatro tabelas; outros provedores e alunas ficam', async () => {
    const { db, tables } = fakeDb(); seed(tables);
    await scrub(tables, db, [...APPLE_HEALTH_RECORD_CATEGORIES]);
    const remaining = Object.values(tables).flat().map((r) => `${r.userId}:${r.provider}`).sort();
    expect(remaining).toEqual(['u1:health_connect', 'u1:zepp', 'u2:apple_health']);
  });
});
