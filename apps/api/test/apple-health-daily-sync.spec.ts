import { normalizeHealthRecord } from '../src/health-connect/health-connect-health-records';
import { APPLE_RECORD_CATEGORY } from '../src/apple-health/apple-health-records';
import { APPLE_HEALTH_CONSENT } from '../src/apple-health/apple-health-consent';
import {
  CATEGORY_GROUPS, HEALTH_GROUPS, QUANTITY_SPECS, SLEEP_IDENTIFIER, buildCategoryRecords, buildQuantityRecords, buildSleepRecords, buildWindowRecords, categoryIdsForGroups, specsForGroups,
  type CategoryRow, type StatRow,
} from '../../mobile/src/appleHealthSync/appleHealthRecords';
import {
  dayKey, dropRevoked, emptyCounters, markCovered, markThrough, messageFor, packRecords, parseCoverage, planSyncWindows, type Coverage,
} from '../../mobile/src/appleHealthSync/appleHealthSyncLogic';

// Saude do dia a dia do Apple Saude no APP (29/10/2026): catalogo de tipos, montagem dos registros, historico incremental e o CONTRATO com o servidor (tudo o que o app monta e o servidor aceita).
// Dados SINTETICOS. O Swift nao roda aqui: ele so' le; toda a modelagem esta neste TypeScript.

const spec = (identifier: string) => QUANTITY_SPECS.find((s) => s.identifier === `HKQuantityTypeIdentifier${identifier}`)!;
const stat = (name: string, day: string, values: Partial<StatRow>): StatRow => ({ identifier: `HKQuantityTypeIdentifier${name}`, day, startTime: `${day}T03:00:00.000Z`, offsetSeconds: -10800, ...values });
const cat = (identifier: string, value: number, start: string, end: string, source = 'com.apple.health.watch'): CategoryRow => ({ identifier, value, startTime: start, endTime: end, offsetSeconds: -10800, sourceBundleId: source, sourceName: source, deviceName: null });
const KNOWN_UNITS = ['count', 'bpm', 'm', 'kcal', 'ms', 's', 'min', 'mps', 'kg', 'g', 'mg', 'ml', 'percent', 'degC', 'mmHg', 'mgdl', 'dbaspl', 'vo2'];
const ALL = new Set(HEALTH_GROUPS);

describe('catalogo de tipos', () => {
  it('todo tipo pertence a um grupo do consentimento, usa um tipo de registro que o servidor conhece e uma unidade que o nativo conhece', () => {
    const groupIds = new Set(APPLE_HEALTH_CONSENT.groups.map((g) => g.id));
    for (const s of QUANTITY_SPECS) {
      expect({ id: s.identifier, group: groupIds.has(s.group) }).toEqual({ id: s.identifier, group: true });
      expect({ id: s.identifier, kind: s.kind in APPLE_RECORD_CATEGORY }).toEqual({ id: s.identifier, kind: true });
      expect({ id: s.identifier, unit: KNOWN_UNITS.includes(s.unit) }).toEqual({ id: s.identifier, unit: true });
      expect(s.identifier).toMatch(/^HKQuantityTypeIdentifier[A-Za-z0-9]+$/);
      expect(s.outputs.length).toBeGreaterThan(0);
    }
    for (const group of [...Object.keys(CATEGORY_GROUPS), ...HEALTH_GROUPS]) expect(groupIds.has(group)).toBe(true);
  });

  it('o catalogo cobre todos os grupos de saude do consentimento (nenhum grupo oferecido sem leitura)', () => {
    const covered = new Set([...QUANTITY_SPECS.map((s) => s.group), ...Object.keys(CATEGORY_GROUPS)]);
    const health = APPLE_HEALTH_CONSENT.groups.map((g) => g.id).filter((id) => !['workouts', 'sensors', 'route'].includes(id));
    for (const id of health) expect({ id, covered: covered.has(id) }).toEqual({ id, covered: true });
  });

  it('nenhuma chave de saida se repete dentro do mesmo tipo de registro (um valor nao sobrescreve outro)', () => {
    const seen = new Map<string, string>();
    for (const s of QUANTITY_SPECS) for (const [, key] of s.outputs) {
      const id = `${s.kind}.${key}`;
      expect({ id, owner: seen.get(id) ?? s.identifier }).toEqual({ id, owner: s.identifier });
      seen.set(id, s.identifier);
    }
  });

  it('so se le o que o grupo autorizado cobre', () => {
    const onlySleep = new Set(['sleep']);
    expect(specsForGroups(onlySleep)).toHaveLength(0);
    expect(categoryIdsForGroups(onlySleep)).toEqual([SLEEP_IDENTIFIER]);
    expect(specsForGroups(new Set(['hrv'])).map((s) => s.identifier)).toEqual(['HKQuantityTypeIdentifierHeartRateVariabilitySDNN']);
    expect(specsForGroups(new Set(['clinical'])).every((s) => s.kind === 'clinical_vitals')).toBe(true);
  });
});

describe('registros a partir das estatisticas do dia', () => {
  it('valor 0 informado e preservado; ausencia nao gera valor; grupo nao autorizado nao gera registro', () => {
    const rows = [
      stat('StepCount', '2026-10-20', { sum: 0 }),
      stat('DistanceWalkingRunning', '2026-10-20', { sum: 5230.4 }),
      stat('RestingHeartRate', '2026-10-20', { avg: 51.6 }),
      stat('BasalEnergyBurned', '2026-10-20', { sum: 1650 }),
      stat('BodyMass', '2026-10-20', { latest: 70.2, avg: 70.2 }),
    ];
    const records = buildQuantityRecords(rows, new Set(['daily', 'heart']));
    const daily = records.find((r) => r.kind === 'daily')!;
    expect(daily).toMatchObject({ calendarDate: '2026-10-20', steps: 0, distanceMeters: 5230.4, restingHeartRateBpm: 51.6, dataOrigin: 'com.apple.health', startZoneOffsetSeconds: -10800 });
    expect('activeKilocalories' in daily).toBe(false); // ausente, nunca zero
    expect(records.find((r) => r.kind === 'daily_energy')!.values).toEqual({ basalKilocalories: 1650 });
    expect(records.find((r) => r.kind === 'body_composition')).toBeUndefined(); // grupo 'body' nao autorizado
  });

  it('so a FC de repouso (grupo heart sem daily): registro diario com o campo da FC apenas', () => {
    const records = buildQuantityRecords([stat('StepCount', '2026-10-20', { sum: 9000 }), stat('RestingHeartRate', '2026-10-20', { avg: 50 })], new Set(['heart']));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'daily', restingHeartRateBpm: 50 });
    expect('steps' in records[0]).toBe(false);
  });

  it('HRV: media diaria de SDNN com o rotulo da metrica; FC do dia com media, minimo e maximo; oxigenacao como fracao', () => {
    const records = buildQuantityRecords([
      stat('HeartRateVariabilitySDNN', '2026-10-20', { avg: 47.5 }),
      stat('HeartRate', '2026-10-20', { avg: 74, min: 48, max: 171 }),
      stat('OxygenSaturation', '2026-10-20', { avg: 0.97, min: 0.93, max: 0.99 }),
    ], ALL);
    expect(records.find((r) => r.kind === 'hrv')).toMatchObject({ lastNightAvg: 47.5, hrvMetric: 'sdnn_ms' });
    expect(records.find((r) => r.kind === 'heart_rate_daily')!.values).toEqual({ heartRateAvg: 74, heartRateMin: 48, heartRateMax: 171 });
    expect(records.find((r) => r.kind === 'pulse_ox')!.values).toEqual({ oxygenSaturationFractionAvg: 0.97, oxygenSaturationFractionMin: 0.93, oxygenSaturationFractionMax: 0.99 });
  });

  it('identificador fora do catalogo e linhas sem numero valido sao ignorados', () => {
    const records = buildQuantityRecords([{ identifier: 'HKQuantityTypeIdentifierSomethingNew', day: '2026-10-20', startTime: 'x', offsetSeconds: 0, sum: 5 }, stat('StepCount', '2026-10-20', { sum: Number.NaN })], ALL);
    expect(records).toEqual([]);
  });
});

describe('sono', () => {
  const night = (source: string, stages: Array<[number, string, string]>) => stages.map(([v, a, b]) => cat(SLEEP_IDENTIFIER, v, a, b, source));
  const watchNight = night('com.apple.health.watch', [
    [0, '2026-10-19T01:00:00.000Z', '2026-10-19T09:40:00.000Z'], // na cama: nao e sono
    [3, '2026-10-19T01:30:00.000Z', '2026-10-19T03:30:00.000Z'], [4, '2026-10-19T03:30:00.000Z', '2026-10-19T04:30:00.000Z'],
    [5, '2026-10-19T04:30:00.000Z', '2026-10-19T05:00:00.000Z'], [2, '2026-10-19T05:00:00.000Z', '2026-10-19T05:10:00.000Z'], [3, '2026-10-19T05:10:00.000Z', '2026-10-19T09:30:00.000Z'],
  ]);

  it('uma noite com etapas: mapeia basico/profundo/REM/acordado, preserva a etapa original e a origem; "na cama" nao entra', () => {
    const [record] = buildSleepRecords(watchNight);
    expect(record).toMatchObject({ kind: 'sleep', dataOrigin: 'com.apple.health.watch', startTime: '2026-10-19T01:30:00.000Z', endTime: '2026-10-19T09:30:00.000Z' });
    const stages = record.stages as Array<{ stage: number; sourceStage: number }>;
    expect(stages.map((s) => [s.stage, s.sourceStage])).toEqual([[4, 3], [5, 4], [6, 5], [1, 2], [4, 3]]);
    const normalized = normalizeHealthRecord(record, APPLE_RECORD_CATEGORY);
    expect(normalized.ok).toBe(true);
    if (normalized.ok && normalized.value.type === 'sleep') {
      expect(normalized.value.data).toMatchObject({ durationSec: 8 * 3600, deepSleepSec: 3600, remSleepSec: 1800, awakeSec: 600, lightSleepSec: 2 * 3600 + 4 * 3600 + 1200 });
    }
  });

  it('a mesma noite gravada por duas fontes conta UMA vez: fica a que tem etapas', () => {
    const phone = night('com.apple.health.phone', [[1, '2026-10-19T01:20:00.000Z', '2026-10-19T09:50:00.000Z']]);
    const records = buildSleepRecords([...phone, ...watchNight]);
    expect(records).toHaveLength(1);
    expect(records[0].dataOrigin).toBe('com.apple.health.watch');
  });

  it('sem etapas (so dormindo): sem divisao enviada, o servidor guarda duracao e deixa a divisao nula', () => {
    const [record] = buildSleepRecords(night('com.example.app', [[1, '2026-10-19T02:00:00.000Z', '2026-10-19T08:00:00.000Z']]));
    expect(record.stages).toEqual([]);
    const normalized = normalizeHealthRecord(record, APPLE_RECORD_CATEGORY);
    expect(normalized.ok && normalized.value.type === 'sleep' && normalized.value.data).toMatchObject({ durationSec: 6 * 3600, deepSleepSec: null, lightSleepSec: null });
  });

  it('intervalo maior que 2 h separa sessoes (noite e cochilo); so acordado nao e noite de sono', () => {
    const rows = [...watchNight, ...night('com.apple.health.watch', [[3, '2026-10-19T17:00:00.000Z', '2026-10-19T17:40:00.000Z']]), ...night('com.apple.health.watch', [[2, '2026-10-21T01:00:00.000Z', '2026-10-21T01:30:00.000Z']])];
    const records = buildSleepRecords(rows);
    expect(records.map((r) => r.startTime)).toEqual(['2026-10-19T01:30:00.000Z', '2026-10-19T17:00:00.000Z']);
  });

  it('identidade estavel: o mesmo sono lido em outra janela gera o mesmo recordId', () => {
    expect(buildSleepRecords(watchNight)[0].recordId).toBe(buildSleepRecords([...watchNight].reverse())[0].recordId);
  });
});

describe('ciclo, eventos cardiacos e atencao plena', () => {
  it('ciclo: amostras do dia viram um registro com a temperatura basal do mesmo dia; so dos dias da janela', () => {
    const rows = [
      cat('HKCategoryTypeIdentifierMenstrualFlow', 3, '2026-10-20T12:00:00.000Z', '2026-10-20T12:00:00.000Z'),
      cat('HKCategoryTypeIdentifierOvulationTestResult', 1, '2026-10-20T13:00:00.000Z', '2026-10-20T13:00:00.000Z'),
      cat('HKCategoryTypeIdentifierMenstrualFlow', 2, '2026-10-05T12:00:00.000Z', '2026-10-05T12:00:00.000Z'), // fora da janela
    ];
    const records = buildWindowRecords({ stats: [stat('BasalBodyTemperature', '2026-10-20', { avg: 36.4 })], categories: rows, groups: new Set(['cycle']), fromDay: '2026-10-15', toDay: '2026-10-25' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'menstrual_cycle', calendarDate: '2026-10-20', values: { menstrualFlow: [3], ovulationTestResult: [1], basalBodyTemperatureC: 36.4 } });
  });

  it('temperatura basal sozinha (sem amostras de categoria) ainda gera o registro do ciclo, sem duplicar', () => {
    const records = buildWindowRecords({ stats: [stat('BasalBodyTemperature', '2026-10-20', { avg: 36.4 })], categories: [], groups: new Set(['cycle']), fromDay: '2026-10-15', toDay: '2026-10-25' });
    expect(records).toHaveLength(1);
    expect(records[0].values).toEqual({ basalBodyTemperatureC: 36.4 });
  });

  it('eventos cardiacos contados por dia; atencao plena soma os minutos e entra no registro de habitos do dia', () => {
    const rows = [
      cat('HKCategoryTypeIdentifierHighHeartRateEvent', 0, '2026-10-20T15:00:00.000Z', '2026-10-20T15:10:00.000Z'),
      cat('HKCategoryTypeIdentifierHighHeartRateEvent', 0, '2026-10-20T18:00:00.000Z', '2026-10-20T18:10:00.000Z'),
      cat('HKCategoryTypeIdentifierMindfulSession', 0, '2026-10-20T10:00:00.000Z', '2026-10-20T10:10:00.000Z'),
      cat('HKCategoryTypeIdentifierMindfulSession', 0, '2026-10-20T20:00:00.000Z', '2026-10-20T20:05:30.000Z'),
    ];
    const records = buildWindowRecords({ stats: [stat('TimeInDaylight', '2026-10-20', { sum: 42 })], categories: rows, groups: new Set(['heart', 'lifestyle']), fromDay: '2026-10-15', toDay: '2026-10-25' });
    expect(records.find((r) => r.kind === 'cardiac_events')!.values).toEqual({ highHeartRateEvents: 2 });
    expect(records.filter((r) => r.kind === 'lifestyle_daily')).toHaveLength(1);
    expect(records.find((r) => r.kind === 'lifestyle_daily')!.values).toEqual({ daylightMinutes: 42, mindfulMinutes: 15.5 });
  });

  it('dia de borda da janela vizinha nao gera registro parcial (nao sobrescreve o completo da outra janela)', () => {
    const rows = [cat('HKCategoryTypeIdentifierMindfulSession', 0, '2026-10-14T10:00:00.000Z', '2026-10-14T10:10:00.000Z')];
    const records = buildWindowRecords({ stats: [], categories: rows, groups: new Set(['lifestyle']), fromDay: '2026-10-15', toDay: '2026-10-25' });
    expect(records).toEqual([]);
  });
});

describe('contrato app -> servidor', () => {
  it('todo registro que o app monta, com todos os grupos, e aceito pelo normalizador do servidor (nenhum tipo/campo e descartado por formato)', () => {
    const stats: StatRow[] = [];
    for (const s of QUANTITY_SPECS) {
      const values: Partial<StatRow> = {};
      for (const [name] of s.outputs) values[name] = name === 'sum' ? 12 : 0.5 + (s.unit === 'bpm' ? 60 : 0);
      if (s.identifier.endsWith('HeartRateVariabilitySDNN')) values.avg = 45;
      stats.push(stat(s.identifier.replace('HKQuantityTypeIdentifier', ''), '2026-10-20', values));
    }
    const categories: CategoryRow[] = [
      cat('HKCategoryTypeIdentifierMenstrualFlow', 2, '2026-10-20T12:00:00.000Z', '2026-10-20T12:00:00.000Z'),
      cat('HKCategoryTypeIdentifierLowHeartRateEvent', 0, '2026-10-20T04:00:00.000Z', '2026-10-20T04:05:00.000Z'),
      cat('HKCategoryTypeIdentifierMindfulSession', 0, '2026-10-20T10:00:00.000Z', '2026-10-20T10:10:00.000Z'),
      cat(SLEEP_IDENTIFIER, 3, '2026-10-19T01:30:00.000Z', '2026-10-19T08:30:00.000Z'),
    ];
    const records = buildWindowRecords({ stats, categories, groups: ALL, fromDay: '2026-10-15', toDay: '2026-10-25' });
    const kinds = new Set(records.map((r) => r.kind));
    // todos os tipos de registro do servidor aparecem
    for (const kind of Object.keys(APPLE_RECORD_CATEGORY)) expect({ kind, built: kinds.has(kind) }).toEqual({ kind, built: true });
    for (const record of records) {
      const result = normalizeHealthRecord(record, APPLE_RECORD_CATEGORY);
      expect({ kind: record.kind, ok: result.ok, reason: result.ok ? undefined : result.reason }).toEqual({ kind: record.kind, ok: true, reason: undefined });
    }
  });

  it('identidades de dias diferentes nao colidem e a do mesmo dia e a mesma ao reler a janela (idempotente)', () => {
    const rows = [stat('BodyMass', '2026-10-20', { latest: 70 }), stat('BodyMass', '2026-10-21', { latest: 70.5 })];
    const first = buildQuantityRecords(rows, ALL).map((r) => (normalizeHealthRecord(r, APPLE_RECORD_CATEGORY) as { ok: true; value: { identity: string } }).value.identity);
    const again = buildQuantityRecords([...rows].reverse(), ALL).map((r) => (normalizeHealthRecord(r, APPLE_RECORD_CATEGORY) as { ok: true; value: { identity: string } }).value.identity);
    expect(new Set(first).size).toBe(2);
    expect([...first].sort()).toEqual([...again].sort());
  });
});

describe('historico incremental', () => {
  const NOW = new Date(2026, 9, 29, 15, 0, 0); // 29/10/2026, hora local
  const ALLG = new Set(['workouts', 'daily', 'sleep']);

  it('primeira sincronizacao: janela recente (14 dias) e depois janelas de 60 dias ate o horizonte de 3 anos, da mais nova para a mais antiga, sem buracos', () => {
    const windows = planSyncWindows(NOW, ALLG, { from: {} });
    expect(dayKey(windows[0].start)).toBe('2026-10-15');
    expect(dayKey(windows[0].end)).toBe('2026-10-30');
    for (let i = 1; i < windows.length; i += 1) expect(windows[i].end.getTime()).toBe(windows[i - 1].start.getTime());
    expect(dayKey(windows[windows.length - 1].start)).toBe(dayKey(new Date(2026, 9, 29 - 1095)));
    expect(windows.every((w) => w.groups.join() === 'daily,sleep,workouts')).toBe(true);
    expect(windows.length).toBeGreaterThan(15);
  });

  it('depois de tudo coberto: so a janela recente; cobertura e "ate ontem" preservada entre sincronizacoes', () => {
    let coverage: Coverage = { from: {} };
    for (const w of planSyncWindows(NOW, ALLG, coverage)) coverage = markCovered(coverage, w);
    coverage = markThrough(coverage, NOW);
    const next = planSyncWindows(new Date(2026, 9, 30, 9, 0, 0), ALLG, coverage);
    expect(next).toHaveLength(1);
    expect(dayKey(next[0].start)).toBe('2026-10-16'); // 14 dias antes de 30/10
  });

  it('ficou semanas sem sincronizar: a janela recente cresce para cobrir o intervalo (2 dias antes da ultima sincronizacao), sem buraco', () => {
    let coverage: Coverage = { from: {} };
    for (const w of planSyncWindows(NOW, ALLG, coverage)) coverage = markCovered(coverage, w);
    coverage = markThrough(coverage, NOW);
    const later = new Date(2026, 11, 20, 9, 0, 0); // 20/12/2026
    const windows = planSyncWindows(later, ALLG, coverage);
    expect(windows).toHaveLength(1);
    expect(dayKey(windows[0].start)).toBe('2026-10-27');
  });

  it('grupo autorizado depois: le o historico so dele; os que ja estavam cobertos nao sao relidos fora da janela recente', () => {
    let coverage: Coverage = { from: {} };
    for (const w of planSyncWindows(NOW, new Set(['workouts', 'daily']), coverage)) coverage = markCovered(coverage, w);
    coverage = markThrough(coverage, NOW);
    const windows = planSyncWindows(NOW, new Set(['workouts', 'daily', 'sleep']), coverage);
    expect(windows[0].groups).toEqual(['daily', 'sleep', 'workouts']);
    expect(windows.slice(1).every((w) => w.groups.join() === 'sleep')).toBe(true);
    expect(windows.length).toBeGreaterThan(15);
  });

  it('falha no meio: a cobertura so avanca ate onde foi enviado; a proxima sincronizacao retoma dali', () => {
    const planned = planSyncWindows(NOW, ALLG, { from: {} });
    let coverage: Coverage = { from: {} };
    for (const w of planned.slice(0, 4)) coverage = markCovered(coverage, w); // 4 janelas enviadas, a 5a falhou
    const resumed = planSyncWindows(NOW, ALLG, coverage);
    expect(dayKey(resumed[1].start)).toBe(dayKey(planned[4].start)); // retoma na que falhou
    expect(resumed.length).toBe(planned.length - 3); // recente + as pendentes (as 3 antigas ja cobertas ficam de fora)
  });

  it('grupo retirado perde a cobertura local (os dados foram apagados no servidor); autorizar de novo le o historico outra vez', () => {
    let coverage: Coverage = { from: {} };
    for (const w of planSyncWindows(NOW, ALLG, coverage)) coverage = markCovered(coverage, w);
    const reduced = dropRevoked(coverage, new Set(['workouts', 'daily']));
    expect(Object.keys(reduced.from).sort()).toEqual(['daily', 'workouts']);
    expect(planSyncWindows(NOW, ALLG, reduced).length).toBeGreaterThan(15);
  });

  it('armazenamento corrompido ou vazio vira cobertura vazia (relê tudo, idempotente)', () => {
    for (const raw of [null, '', 'não é json', '[]', '{"from":{"daily":"ontem"},"through":42}']) expect(parseCoverage(raw)).toEqual({ from: {} });
    expect(parseCoverage('{"from":{"daily":"2026-01-01"},"through":"2026-10-29"}')).toEqual({ from: { daily: '2026-01-01' }, through: '2026-10-29' });
  });

  it('sem nenhum grupo autorizado nao ha janelas', () => {
    expect(planSyncWindows(NOW, new Set(), { from: {} })).toEqual([]);
  });
});

describe('lotes e mensagens', () => {
  it('lotes respeitam 100 registros e o orcamento de bytes; nada se perde nem se repete', () => {
    const records = Array.from({ length: 250 }, (_, i) => ({ kind: 'daily', calendarDate: `d${i}`, steps: i }));
    const batches = packRecords(records);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(records);
    const big = Array.from({ length: 10 }, (_, i) => ({ kind: 'x', values: { text: 'a'.repeat(9000), i } }));
    for (const batch of packRecords(big, { maxRecords: 100, maxBytes: 20_000 })) expect(JSON.stringify({ records: batch }).length).toBeLessThanOrEqual(20_000);
  });

  it('mensagem de conclusao conta registros de saude e avisa tipos que este iPhone nao le; parcial lista periodos que faltam', () => {
    const done = emptyCounters(); done.healthStored = 1200; done.created = 4; done.healthUnreadable = 3;
    const text = messageFor('completed', done).text;
    expect(text).toContain('1200 registros de saúde guardados');
    expect(text).toContain('3 tipos de dado do app Saúde não existem ou não puderam ser lidos neste iPhone');
    const partial = emptyCounters(); partial.healthStored = 300; partial.windowsPending = 6; partial.healthNotSent = 40; partial.routesDeferred = 12;
    const message = messageFor('partial', partial);
    expect(message.ok).toBe(false);
    expect(message.text).toContain('6 períodos do histórico ainda faltam');
    expect(message.text).toContain('40 registros de saúde não foram enviados');
    expect(message.text).toContain('12 percursos ficaram para a próxima sincronização');
    expect(message.text).toContain('não é duplicado');
  });
});
