import { HcRawSession, ImportResponse, ExercisePayload } from '../../mobile/src/healthConnect/contract';
import { createHealthConnectSync, HealthConnectGateway, SyncStore } from '../../mobile/src/healthConnect/sync';
import { HC_CATEGORY_RECORD_TYPES, permissionsFor, recordTypesFor } from '../../mobile/src/healthConnect/categories';
import { chunkBySize, buildDailyRecord, buildSleepRecord, enumerateLocalDays, hrvRecordsByDay, restingHeartRateByDay, summarizeCadence, summarizePower, summarizeSpeed, sumElevationGain, sumEnergy, buildVo2Max, buildWeight } from '../../mobile/src/healthConnect/healthRecords';
import { normalizeHealthRecord } from '../src/health-connect/health-connect-health-records';
import { HEALTH_CONNECT_CATEGORIES } from '../src/health-connect/health-connect-consent';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Health Connect no app (22/10/2026): leitura GUIADA pelas autorizacoes, sono/dia/HRV/indicadores, resumos de sensores do exercicio. Health Connect FALSO — nao substitui a validacao em aparelho real.

const T0 = new Date('2026-10-22T12:00:00.000Z');
const session = (id = 's1'): HcRawSession => ({ metadata: { id, dataOrigin: 'com.sec.android.app.shealth', lastModifiedTime: '2026-10-21T10:30:00.000Z', device: { manufacturer: 'Samsung', model: 'Galaxy Watch', type: 1 } }, exerciseType: 56, startTime: '2026-10-21T09:00:00.000Z', endTime: '2026-10-21T09:55:00.000Z', startZoneOffset: { totalSeconds: -10800 } });
const sleep = { metadata: { id: 'sl1', dataOrigin: 'com.sec.android.app.shealth' }, startTime: '2026-10-21T01:00:00.000Z', endTime: '2026-10-21T09:00:00.000Z', startZoneOffset: { totalSeconds: -10800 }, stages: [{ startTime: '2026-10-21T01:00:00.000Z', endTime: '2026-10-21T05:00:00.000Z', stage: 4 }] };

function memoryStore(): SyncStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, remove: async (k) => { data.delete(k); } };
}

function setup(authorized: { categories: string[]; history?: boolean } | Error, granted: string[], extra: Record<string, unknown[]> = {}, fail: string[] = [], opts: { postHealth?: (items: unknown[]) => Promise<{ stored: number; rejected: number; items?: Array<{ status: string; reason?: string }> }>; now?: () => Date } = {}) {
  const calls = { readSessions: 0, readAny: [] as string[], requested: [] as Array<{ types?: string[]; history?: boolean }>, aggregateDay: 0 };
  const hc: HealthConnectGateway = {
    getSdkStatus: async () => 'available', initialize: async () => true, getGrantedRecordTypes: async () => granted,
    requestPermissions: async (types, history) => { calls.requested.push({ types, history }); return granted; },
    revokeAllPermissions: async () => undefined,
    readSessions: async () => { calls.readSessions += 1; return [session()]; },
    readDistance: async () => [{ startTime: '2026-10-21T09:00:00.000Z', endTime: '2026-10-21T09:55:00.000Z', distance: { inMeters: 10000 } }],
    readHeartRate: async () => [{ startTime: '2026-10-21T09:00:00.000Z', endTime: '2026-10-21T09:55:00.000Z', samples: [{ time: '2026-10-21T09:10:00.000Z', beatsPerMinute: 150 }, { time: '2026-10-21T09:20:00.000Z', beatsPerMinute: 170 }] }],
    readAny: async (type) => { calls.readAny.push(type); if (fail.includes(type)) throw new Error('falha de leitura'); if (extra[type]) return extra[type]; if (type === 'SleepSession') return [sleep]; if (type === 'Power') return [{ startTime: '2026-10-21T09:00:00.000Z', endTime: '2026-10-21T09:55:00.000Z', samples: [{ time: '2026-10-21T09:10:00.000Z', power: { inWatts: 200 } }, { time: '2026-10-21T09:20:00.000Z', power: { inWatts: 300 } }] }]; return extra[type] ?? []; },
    aggregateDay: async () => { calls.aggregateDay += 1; return { steps: 9000, distanceMeters: 6500, activeKilocalories: 420, totalKilocalories: 2300 }; },
  };
  const exercises: ExercisePayload[][] = []; const health: unknown[][] = [];
  const store = memoryStore();
  const sync = createHealthConnectSync({
    hc, store, userId: 'u1', now: opts.now ?? (() => T0),
    getAuthorizedCategories: async () => { if (authorized instanceof Error) throw authorized; return { categories: new Set(authorized.categories), history: authorized.history ?? false }; },
    postExercises: async (items): Promise<ImportResponse> => { exercises.push(items); return { created: items.length, updated: 0, alreadyImported: 0, rejected: 0 }; },
    postHealthRecords: async (items) => { health.push(items); return opts.postHealth ? opts.postHealth(items) : { stored: items.length, rejected: 0 }; },
  });
  return { sync, calls, exercises, health, store };
}

describe('categorias autorizadas -> permissoes do Android (so o que a aluna autorizou)', () => {
  it('cada categoria do consentimento do servidor tem entrada no mapa do app; pedir permissao so inclui as categorias autorizadas', () => {
    for (const category of HEALTH_CONNECT_CATEGORIES) expect(Object.keys(HC_CATEGORY_RECORD_TYPES)).toContain(category);
    expect(recordTypesFor(['sleep'])).toEqual(['SleepSession']);
    expect(recordTypesFor(['activity', 'daily_activity'])).toEqual(['ExerciseSession', 'Distance', 'Speed', 'ActiveCaloriesBurned', 'TotalCaloriesBurned', 'Steps']); // sem repeticao
    expect(recordTypesFor([])).toEqual([]);
    expect(permissionsFor(['sleep'], true)).toEqual([{ accessType: 'read', recordType: 'SleepSession' }, { accessType: 'read', recordType: 'ReadHealthDataHistory' }]);
  });

  it('o manifesto do app declara uma permissao de leitura para cada tipo que o app pode pedir (nada pedido sem declarar)', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'mobile', 'app.json'), 'utf8')).expo.android.permissions as string[];
    const declared = new Set(manifest.map((p) => p.replace('android.permission.health.', '')));
    const needed: Record<string, string> = { ExerciseSession: 'READ_EXERCISE', Distance: 'READ_DISTANCE', Speed: 'READ_SPEED', ActiveCaloriesBurned: 'READ_ACTIVE_CALORIES_BURNED', TotalCaloriesBurned: 'READ_TOTAL_CALORIES_BURNED', HeartRate: 'READ_HEART_RATE', Power: 'READ_POWER', StepsCadence: 'READ_STEPS', ElevationGained: 'READ_ELEVATION_GAINED', SleepSession: 'READ_SLEEP', Steps: 'READ_STEPS', RestingHeartRate: 'READ_RESTING_HEART_RATE', HeartRateVariabilityRmssd: 'READ_HEART_RATE_VARIABILITY', Vo2Max: 'READ_VO2_MAX', Weight: 'READ_WEIGHT', BodyFat: 'READ_BODY_FAT', LeanBodyMass: 'READ_LEAN_BODY_MASS', BoneMass: 'READ_BONE_MASS', BodyWaterMass: 'READ_BODY_WATER_MASS', OxygenSaturation: 'READ_OXYGEN_SATURATION', RespiratoryRate: 'READ_RESPIRATORY_RATE', Nutrition: 'READ_NUTRITION', Hydration: 'READ_HYDRATION' };
    for (const types of Object.values(HC_CATEGORY_RECORD_TYPES)) for (const type of types) expect(declared.has(needed[type])).toBe(true);
    expect(declared.has('READ_HEALTH_DATA_HISTORY')).toBe(true);
    expect(declared.has('READ_EXERCISE_ROUTES')).toBe(false); // percurso GPS e segundo plano ainda nao: so' entram com a leitura implementada e declarada
  });
});

describe('sincronizacao guiada pelas autorizacoes', () => {
  it('falha ao consultar as autorizacoes: NADA e lido nem enviado (fail-closed)', async () => {
    const s = setup(new Error('rede'), ['ExerciseSession', 'SleepSession']);
    await s.store.set('panzeri-run:health-connect:u1:connected', '1');
    const result = await s.sync.syncNow();
    expect(result.status).toBe('error');
    expect(s.calls.readSessions).toBe(0);
    expect(s.calls.readAny).toEqual([]);
    expect(s.exercises).toHaveLength(0);
  });

  it('sem nenhuma autorizacao: pede nada ao Android (needs_consent) e nao le nada', async () => {
    const s = setup({ categories: [] }, []);
    expect((await s.sync.connect()).status).toBe('needs_consent');
    expect(s.calls.requested).toEqual([]);
  });

  it('so sono autorizado: pede so SleepSession ao Android, le so o sono, NAO le exercicios; marcador avanca', async () => {
    const s = setup({ categories: ['sleep'] }, ['SleepSession']);
    expect((await s.sync.connect()).status).toBe('connected');
    expect(s.calls.requested).toEqual([{ types: ['SleepSession'], history: false }]);
    const result = await s.sync.syncNow();
    expect(result).toMatchObject({ status: 'done', sent: 0, healthSent: 1, healthStored: 1, failedCategories: [] });
    expect(s.calls.readSessions).toBe(0);
    expect(s.calls.readAny).toEqual(['SleepSession']);
    expect(s.health[0][0]).toMatchObject({ kind: 'sleep', recordId: 'sl1', dataOrigin: 'com.sec.android.app.shealth' });
    expect(s.calls.aggregateDay).toBe(0);
  });

  it('exercicios sem a categoria de sensores: nao le FC/potencia/cadencia/elevacao; com sensores: envia os resumos da mesma origem dentro da sessao', async () => {
    const plain = setup({ categories: ['activity'] }, ['ExerciseSession', 'Distance', 'HeartRate', 'Power']);
    await plain.sync.connect();
    await plain.sync.syncNow();
    expect(plain.exercises[0][0]).toMatchObject({ distanceMeters: 10000, avgHeartRateBpm: null, powerAvgWatts: null });
    expect(plain.calls.readAny).not.toContain('Power');
    const full = setup({ categories: ['activity', 'activity_sensors'] }, ['ExerciseSession', 'Distance', 'HeartRate', 'Power']);
    await full.sync.connect();
    await full.sync.syncNow();
    expect(full.exercises[0][0]).toMatchObject({ avgHeartRateBpm: 160, maxHeartRateBpm: 170, powerAvgWatts: 250, powerMaxWatts: 300 });
  });

  it('categoria que falha na leitura nao derruba as outras e segura o marcador para a proxima rodada', async () => {
    const s = setup({ categories: ['sleep', 'vo2_max'] }, ['SleepSession', 'Vo2Max'], {}, ['Vo2Max']);
    await s.sync.connect();
    const result = await s.sync.syncNow();
    expect(result).toMatchObject({ status: 'done', healthStored: 1, failedCategories: ['vo2_max'] }); // o sono seguiu
    expect(s.store.data.has('panzeri-run:health-connect:u1:cursor')).toBe(false); // marcador nao avancou: a proxima rodada relê a janela
  });

  it('saude diaria: usa os totais do proprio Health Connect e so a FC de repouso quando e a unica autorizada', async () => {
    const both = setup({ categories: ['daily_activity', 'resting_heart_rate'] }, ['Steps', 'Distance', 'ActiveCaloriesBurned', 'TotalCaloriesBurned', 'RestingHeartRate'], { RestingHeartRate: [{ time: '2026-10-21T08:00:00.000Z', zoneOffset: { totalSeconds: -10800 }, beatsPerMinute: 52 }] });
    await both.sync.connect();
    await both.sync.syncNow();
    expect(both.calls.aggregateDay).toBeGreaterThan(0);
    const daily = (both.health.flat() as any[]).filter((r) => r.kind === 'daily');
    expect(daily.length).toBeGreaterThan(0);
    expect(daily.find((r) => r.steps === 9000)).toBeTruthy();
    const onlyResting = setup({ categories: ['resting_heart_rate'] }, ['RestingHeartRate'], { RestingHeartRate: [{ time: '2026-10-21T08:00:00.000Z', zoneOffset: { totalSeconds: -10800 }, beatsPerMinute: 52 }] });
    await onlyResting.sync.connect();
    await onlyResting.sync.syncNow();
    expect(onlyResting.calls.aggregateDay).toBe(0);
    expect((onlyResting.health.flat() as any[]).every((r) => r.steps === null && r.restingHeartRateBpm === 52 || r.kind !== 'daily')).toBe(true);
  });
});

describe('montagem dos registros (nada estimado)', () => {
  it('payload de sono e aceito pelo normalizador do servidor; registro sem id e descartado', () => {
    const payload = buildSleepRecord(sleep as never)!;
    expect(normalizeHealthRecord(payload).ok).toBe(true);
    expect(buildSleepRecord({ ...sleep, metadata: undefined } as never)).toBeNull();
    const day = buildDailyRecord('2026-10-21', '2026-10-21T03:00:00.000Z', -10800, { steps: 9000, distanceMeters: null, activeKilocalories: null, totalKilocalories: null }, 52, true)!;
    expect(normalizeHealthRecord(day).ok).toBe(true);
    expect(buildDailyRecord('2026-10-21', '2026-10-21T03:00:00.000Z', -10800, { steps: null, distanceMeters: null, activeKilocalories: null, totalKilocalories: null }, null, true)).toBeNull(); // dia sem dado
  });

  it('FC de repouso: o registro mais recente do dia; HRV: media das amostras do dia, unidade ms; indicadores com unidades originais e id', () => {
    const resting = restingHeartRateByDay([{ time: '2026-10-21T06:00:00.000Z', zoneOffset: { totalSeconds: 0 }, beatsPerMinute: 55 }, { time: '2026-10-21T20:00:00.000Z', zoneOffset: { totalSeconds: 0 }, beatsPerMinute: 51 }, { time: '2026-10-21T07:00:00.000Z', beatsPerMinute: -1 }]);
    expect(resting.get('2026-10-21')).toBe(51);
    const hrv = hrvRecordsByDay([{ metadata: { id: 'a' }, time: '2026-10-21T04:00:00.000Z', heartRateVariabilityMillis: 40 }, { metadata: { id: 'b' }, time: '2026-10-21T05:00:00.000Z', heartRateVariabilityMillis: 60 }]);
    expect(hrv).toHaveLength(1);
    expect(hrv[0]).toMatchObject({ kind: 'hrv', lastNightAvg: 50, sampleCount: 2 });
    expect(normalizeHealthRecord(hrv[0]).ok).toBe(true);
    const vo2 = buildVo2Max({ metadata: { id: 'v', dataOrigin: 'com.sec.android.app.shealth' }, time: '2026-10-21T04:00:00.000Z', vo2MillilitersPerMinuteKilogram: 48.5, measurementMethod: 1 })!;
    expect(vo2).toMatchObject({ kind: 'vo2_max', values: { vo2MillilitersPerMinuteKilogram: 48.5 } });
    expect(normalizeHealthRecord(vo2).ok).toBe(true);
    expect(buildWeight({ metadata: { id: 'w' }, time: '2026-10-21T04:00:00.000Z', weight: { inKilograms: 70.5 } })).toMatchObject({ values: { weightKg: 70.5 } });
    expect(buildWeight({ metadata: { id: 'w' }, time: '2026-10-21T04:00:00.000Z' })).toBeNull(); // sem valor: nenhum registro
  });

  it('resumos do exercicio: so amostras DENTRO da sessao; ausencia vira null (nunca zero)', () => {
    const range = { startTime: '2026-10-21T09:00:00.000Z', endTime: '2026-10-21T09:55:00.000Z' };
    expect(summarizeSpeed([{ ...range, samples: [{ time: '2026-10-21T09:10:00.000Z', speed: { inMetersPerSecond: 3 } }, { time: '2026-10-21T10:30:00.000Z', speed: { inMetersPerSecond: 9 } }] }], range)).toEqual({ speedAvgMps: 3, speedMaxMps: 3 });
    expect(summarizePower([], range)).toEqual({ powerAvgWatts: null, powerMaxWatts: null });
    expect(summarizeCadence([{ ...range, samples: [{ time: '2026-10-21T09:10:00.000Z', rate: 170 }] }], range)).toEqual({ cadenceAvgPerMin: 170 });
    expect(sumElevationGain([{ ...range, elevation: { inMeters: 40 } }, { startTime: '2026-10-20T09:00:00.000Z', endTime: '2026-10-20T09:55:00.000Z', elevation: { inMeters: 999 } }], range)).toEqual({ elevationGainMeters: 40 });
    expect(sumEnergy([{ ...range, energy: { inKilocalories: 700 } }], range)).toBe(700);
    expect(sumEnergy([], range)).toBeNull();
  });

  it('dias locais: um por dia, em ordem, o ultimo termina no fim da janela', () => {
    const days = enumerateLocalDays(new Date(2026, 9, 19, 15, 0), new Date(2026, 9, 21, 10, 0));
    expect(days.map((d) => d.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
    expect(days[2].end.getTime()).toBe(new Date(2026, 9, 21, 10, 0).getTime());
  });
});

describe('revisao independente (22/10/2026): lotes por tamanho, janela, HRV estavel, falha do servidor', () => {
  it('A1: lotes de saude respeitam o tamanho (sono em etapas e pesado) e a quantidade; a ordem e preservada', () => {
    const sleeps = Array.from({ length: 40 }, (_, i) => ({ kind: 'sleep', recordId: 'sl' + i, stages: Array.from({ length: 60 }, (_, j) => ({ stage: 4, startTime: '2026-10-21T01:00:00.000Z', endTime: '2026-10-21T01:10:00.000Z', n: j })) }));
    const chunks = chunkBySize(sleeps, 60_000, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(60_000 + 1);
    expect(chunks.flat().map((r) => r.recordId)).toEqual(sleeps.map((r) => r.recordId));
    expect(chunkBySize(Array.from({ length: 250 }, (_, i) => ({ i })), 60_000, 100).map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunkBySize([], 60_000, 100)).toEqual([]);
    expect(chunkBySize([{ big: 'x'.repeat(70_000) }], 60_000, 100)).toHaveLength(1); // um registro maior que o limite segue sozinho (o servidor decide)
  });

  it('A1 (ponta a ponta): sincronizacao com muitos sonos envia varios lotes pequenos, nunca um lote acima do limite', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...sleep, metadata: { id: 'sl' + i, dataOrigin: 'com.sec.android.app.shealth' }, stages: Array.from({ length: 60 }, () => ({ startTime: '2026-10-21T01:00:00.000Z', endTime: '2026-10-21T01:10:00.000Z', stage: 4 })) }));
    const s = setup({ categories: ['sleep'] }, ['SleepSession'], { SleepSession: many });
    await s.sync.connect();
    const result = await s.sync.syncNow();
    expect(result.status).toBe('done');
    for (const batch of s.health) expect(JSON.stringify(batch).length).toBeLessThanOrEqual(60_001);
  });

  it('M3: incremental — dado que chega ATRASADO ao Health Connect e relido pela data de modificacao (nao so pela janela de horario); registro antigo e ja enviado nao e reenviado', async () => {
    const lateSleep = { ...sleep, metadata: { id: 'late', dataOrigin: 'x', lastModifiedTime: '2026-10-22T11:00:00.000Z' }, startTime: '2026-10-10T01:00:00.000Z', endTime: '2026-10-10T09:00:00.000Z' };
    const oldSleep = { ...sleep, metadata: { id: 'old', dataOrigin: 'x', lastModifiedTime: '2026-10-01T11:00:00.000Z' } };
    const s = setup({ categories: ['sleep'] }, ['SleepSession'], { SleepSession: [lateSleep, oldSleep] });
    await s.sync.connect();
    // 1a rodada: tudo; 2a rodada (cursor existente): so' o modificado depois do cursor
    const first = await s.sync.syncNow();
    expect(first.healthSent).toBeGreaterThan(0);
    await s.store.set('panzeri-run:health-connect:u1:cursor', '2026-10-22T00:00:00.000Z');
    s.health.length = 0;
    await s.sync.syncNow();
    const ids = (s.health.flat() as any[]).filter((r) => r.kind === 'sleep').map((r) => r.recordId);
    expect(ids).toContain('late'); // startTime de 12 dias atras, mas modificado depois do cursor
    expect(ids).not.toContain('old');
  });

  it('M3: agregado diario incremental recalcula so os ultimos 7 dias; a 1a sincronizacao cobre a janela inteira', async () => {
    const first = setup({ categories: ['daily_activity'] }, ['Steps']);
    await first.sync.connect(); await first.sync.syncNow();
    const incremental = setup({ categories: ['daily_activity'] }, ['Steps']);
    await incremental.sync.connect();
    await incremental.store.set('panzeri-run:health-connect:u1:cursor', '2026-10-22T00:00:00.000Z');
    await incremental.sync.syncNow();
    expect(first.calls.aggregateDay).toBeGreaterThan(20);
    expect(incremental.calls.aggregateDay).toBeLessThanOrEqual(8);
  });

  it('M4: HRV usa SEMPRE o inicio do dia local (a mesma data nunca vira duas linhas) e so reenvia as datas pedidas', () => {
    const a = hrvRecordsByDay([{ metadata: { id: 'a' }, time: '2026-10-21T04:00:00.000Z', zoneOffset: { totalSeconds: -10800 }, heartRateVariabilityMillis: 40 }]);
    const b = hrvRecordsByDay([{ metadata: { id: 'b' }, time: '2026-10-21T08:30:00.000Z', zoneOffset: { totalSeconds: -10800 }, heartRateVariabilityMillis: 60 }]);
    expect(a[0].startTime).toBe('2026-10-21T03:00:00.000Z');
    expect(b[0].startTime).toBe(a[0].startTime);
    expect(hrvRecordsByDay([{ metadata: { id: 'a' }, time: '2026-10-21T04:00:00.000Z', heartRateVariabilityMillis: 40 }], new Set(['2026-10-20']))).toEqual([]);
  });

  it('M5: falha TRANSITORIA do servidor num registro segura o marcador (proxima rodada reenvia); rejeicao por validacao nao trava', async () => {
    const transient = setup({ categories: ['sleep'] }, ['SleepSession'], {}, [], { postHealth: async (items) => ({ stored: 0, rejected: items.length, items: [{ status: 'rejected', reason: 'falha_ao_gravar' }] }) });
    await transient.sync.connect();
    const result = await transient.sync.syncNow();
    expect(result.failedCategories).toContain('envio_ao_servidor');
    expect(transient.store.data.has('panzeri-run:health-connect:u1:cursor')).toBe(false);
    const validation = setup({ categories: ['sleep'] }, ['SleepSession'], {}, [], { postHealth: async (items) => ({ stored: 0, rejected: items.length, items: [{ status: 'rejected', reason: 'sono_invalido' }] }) });
    await validation.sync.connect();
    expect((await validation.sync.syncNow()).failedCategories).toEqual([]);
    expect(validation.store.data.has('panzeri-run:health-connect:u1:cursor')).toBe(true);
  });
});
