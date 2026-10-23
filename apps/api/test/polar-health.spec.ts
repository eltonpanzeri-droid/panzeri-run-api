import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  grantedPolarHealthCategories, isPolarHealthConsentCurrent, polarHealthTextHash, POLAR_HEALTH_CONSENT, POLAR_HEALTH_PROVIDER_ID, type PolarHealthRow,
} from '../src/polar/polar-health-consent';
import { extractPolarList, mapPolarDailyActivity, mapPolarNightlyRecharge, mapPolarSleep, parsePolarInstant } from '../src/polar/polar-health-mapper';
import { PolarHealthConsentService } from '../src/polar/polar-health-consent.service';
import { PolarHealthIngestionService } from '../src/polar/polar-health-ingestion.service';
import { PolarProbeService } from '../src/polar/polar-probe.service';
import { AiDataEligibility } from '../src/ai-governance/ai-data-eligibility.service';
import { buildStudentIntegrations, type IntegrationsRaw } from '../src/coach/student-integrations.service';
import { StudentHealthRecoveryService, sourceDisplayName } from '../src/coach/student-health-recovery.service';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { VARIABLE_REGISTRY } from '../src/training-intelligence/variable-registry';
import { runWithAiScope } from '../src/ai-governance/ai-scope';

// 23/10/2026 — ampliacao da Polar para saude e recuperacao (sono, Nightly Recharge/HRV, atividade diaria): consentimento por categoria SEM reconectar, mapeamento puro, importacao com a
// autorizacao reconferida dentro da transacao, diagnostico administrativo somente-leitura e bloqueio da IA. Tudo com dados sinteticos e a rede simulada.

const current = { consentVersion: POLAR_HEALTH_CONSENT.version, consentTextHash: polarHealthTextHash() };
const row = (over: Partial<PolarHealthRow> = {}): PolarHealthRow => ({ disconnectedAt: null, grantedCategories: ['sleep', 'hrv', 'daily_activity'], ...current, ...over });

describe('consentimento por categoria da Polar', () => {
  it('o texto tem versao e hash; o hash muda se uma palavra mudar; cobre sono, HRV e atividade diaria e diz que NAO vai ao Atlas', () => {
    expect(polarHealthTextHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(POLAR_HEALTH_CONSENT.groups.map((g) => g.id)).toEqual(['sleep', 'hrv', 'daily_activity']);
    const text = POLAR_HEALTH_CONSENT.paragraphs.join(' ');
    expect(text).toMatch(/seu treinador os verá no painel/);
    expect(text).toMatch(/não inclui o envio desses dados à inteligência artificial/);
    expect(text).toMatch(/últimos 28 dias/);
    expect(text).toMatch(/apagados do Panzeri Run/);
  });

  it('so ha categoria autorizada com linha ativa E texto vigente; qualquer outra situacao = nenhuma (fail-closed)', () => {
    expect(grantedPolarHealthCategories(null)).toEqual([]);
    expect(grantedPolarHealthCategories(row({ disconnectedAt: new Date() }))).toEqual([]);
    expect(grantedPolarHealthCategories(row({ consentTextHash: 'outro-texto' }))).toEqual([]);
    expect(grantedPolarHealthCategories(row({ consentVersion: '0.9' }))).toEqual([]);
    expect(isPolarHealthConsentCurrent(row())).toBe(true);
    expect(grantedPolarHealthCategories(row({ grantedCategories: ['sleep', 'qualquer-coisa'] }))).toEqual(['sleep']);
    expect(grantedPolarHealthCategories(row({ grantedCategories: 'sleep' }))).toEqual([]);
  });
});

// ── Fake de banco (so o que o servico usa) ───────────────────────────────────────────────────────────────────────────
function fakeDb(opts: { polarConnected?: boolean; consent?: PolarHealthRow & { consentedAt?: Date } | null } = {}) {
  const calls: Array<{ op: string; table: string; args: any }> = [];
  const state = { consent: opts.consent ?? null, polar: opts.polarConnected === false ? { disconnectedAt: new Date(), accessTokenEncrypted: null } : { disconnectedAt: null, accessTokenEncrypted: 'enc' } };
  const rec = (table: string, op: string) => async (args: any) => { calls.push({ op, table, args }); return { count: 1 }; };
  const wearable = (table: string) => ({ deleteMany: rec(table, 'deleteMany'), upsert: rec(table, 'upsert'), aggregate: async () => ({ _max: { receivedAt: null }, _count: 0 }), findMany: async () => [] });
  const db: any = {
    polarConnection: { findUnique: async () => (opts.polarConnected === false ? { disconnectedAt: new Date(), accessTokenEncrypted: null } : state.polar) },
    providerConnection: {
      findUnique: async () => (state.consent ? { consentedAt: new Date('2026-10-23T12:00:00Z'), ...state.consent } : null),
      upsert: async (args: any) => { calls.push({ op: 'upsert', table: 'providerConnection', args }); state.consent = { ...args.update } as never; return {}; },
      updateMany: rec('providerConnection', 'updateMany'),
      findMany: async () => [],
    },
    providerConnectionEvent: { create: async (args: any) => { calls.push({ op: 'create', table: 'providerConnectionEvent', args }); return {}; } },
    wearableSleepSummary: wearable('sleep'), wearableHrvSummary: wearable('hrv'), wearableDailySummary: wearable('daily'),
    $queryRaw: async () => (state.consent ? [state.consent] : []),
  };
  db.$transaction = async (cb: (tx: any) => unknown) => cb(db);
  return { db, calls, state };
}

describe('PolarHealthConsentService', () => {
  const doc = () => ({ acknowledged: true, version: POLAR_HEALTH_CONSENT.version, textHash: polarHealthTextHash() });

  it('autorizar grava a linha PROPRIA (provider polar_health), sem tocar na conexao Polar nem na decisao sobre o Atlas', async () => {
    const { db, calls } = fakeDb();
    const service = new PolarHealthConsentService(db);
    const permissions = await service.set('u1', { categories: ['sleep', 'hrv'], ...doc() });
    const upsert = calls.find((c) => c.table === 'providerConnection' && c.op === 'upsert')!;
    expect(upsert.args.where.provider_userId.provider).toBe(POLAR_HEALTH_PROVIDER_ID);
    expect(upsert.args.update.grantedCategories).toEqual(['sleep', 'hrv']);
    expect(upsert.args.update.disconnectedAt).toBeNull();
    expect(permissions.granted).toEqual(['sleep', 'hrv']);
    expect(calls.filter((c) => c.op === 'deleteMany').map((c) => c.table)).toEqual(['daily']); // o grupo NAO marcado nunca fica guardado
    expect(calls.some((c) => c.table === 'providerConnection' && c.args?.where?.provider_userId?.provider === 'polar')).toBe(false);
    expect(calls.find((c) => c.table === 'providerConnectionEvent')!.args.data.type).toBe('purposes_granted');
  });

  it('exige conexao Polar ativa, aceite expresso e texto vigente; categoria invalida e recusada', async () => {
    const service = new PolarHealthConsentService(fakeDb({ polarConnected: false }).db);
    await expect(service.set('u1', { categories: ['sleep'], ...doc() })).rejects.toBeInstanceOf(ConflictException);
    const ok = new PolarHealthConsentService(fakeDb().db);
    await expect(ok.set('u1', { categories: ['sleep'], acknowledged: false, version: POLAR_HEALTH_CONSENT.version, textHash: polarHealthTextHash() })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ok.set('u1', { categories: ['sleep'], acknowledged: true, version: '0.1', textHash: polarHealthTextHash() })).rejects.toBeInstanceOf(ConflictException);
    await expect(ok.set('u1', { categories: ['sleep'], acknowledged: true, version: POLAR_HEALTH_CONSENT.version, textHash: 'x' })).rejects.toBeInstanceOf(ConflictException);
    await expect(ok.set('u1', { categories: ['sleep', 'nutrition'], ...doc() })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ok.set('u1', { categories: 'sleep' as never, ...doc() })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('retirar um grupo apaga SO os dados dele (na mesma transacao); retirar tudo apaga os tres e marca a linha como encerrada', async () => {
    const { db, calls } = fakeDb({ consent: row() });
    const service = new PolarHealthConsentService(db);
    await service.set('u1', { categories: ['sleep', 'daily_activity'], ...doc() }); // retirou hrv
    expect(calls.filter((c) => c.op === 'deleteMany').map((c) => c.table)).toEqual(['hrv']);
    expect(calls.find((c) => c.op === 'deleteMany')!.args.where).toEqual({ userId: 'u1', provider: 'polar' });
    calls.length = 0;
    const all = await service.set('u1', { categories: [] });
    expect(calls.filter((c) => c.op === 'deleteMany').map((c) => c.table).sort()).toEqual(['daily', 'hrv', 'sleep']);
    expect(calls.find((c) => c.op === 'upsert')!.args.update.disconnectedAt).toBeInstanceOf(Date);
    expect(all.granted).toEqual([]);
    expect(calls.find((c) => c.table === 'providerConnectionEvent')!.args.data.type).toBe('purposes_revoked');
  });

  it('reautorizar so UM grupo apos texto antigo/desconexao apaga os outros mesmo assim (nenhum dado fica sem autorizacao)', async () => {
    for (const stale of [row({ consentTextHash: 'texto-antigo' }), row({ disconnectedAt: new Date('2026-10-01T00:00:00Z') })]) {
      const { db, calls } = fakeDb({ consent: stale });
      await new PolarHealthConsentService(db).set('u1', { categories: ['sleep'], ...doc() });
      expect(calls.filter((c) => c.op === 'deleteMany').map((c) => c.table).sort()).toEqual(['daily', 'hrv']);
    }
  });

  it('desconectar encerra a autorizacao de saude (sem apagar) e excluir os dados apaga a saude importada', async () => {
    const { db, calls } = fakeDb({ consent: row() });
    const service = new PolarHealthConsentService(db);
    await service.revokeOnDisconnect('u1');
    expect(calls.find((c) => c.op === 'updateMany')!.args).toMatchObject({ where: { provider: 'polar_health', userId: 'u1', disconnectedAt: null } });
    expect(calls.filter((c) => c.op === 'deleteMany')).toEqual([]);
    await service.eraseImportedData('u1');
    expect(calls.filter((c) => c.op === 'deleteMany').map((c) => c.table).sort()).toEqual(['daily', 'hrv', 'sleep']);
  });

  it('texto que mudou depois da autorizacao: nada importavel e a tela pede nova autorizacao', async () => {
    const { db } = fakeDb({ consent: row({ consentTextHash: 'texto-antigo' }) });
    const service = new PolarHealthConsentService(db);
    expect(await service.importable('u1')).toEqual([]);
    const p = await service.permissions('u1');
    expect(p.needsNewAuthorization).toBe(true);
    expect(p.granted).toEqual([]);
  });

  it('importable: so com a Polar conectada', async () => {
    expect(await new PolarHealthConsentService(fakeDb({ consent: row() }).db).importable('u1')).toEqual(['sleep', 'hrv', 'daily_activity']);
    expect(await new PolarHealthConsentService(fakeDb({ consent: row(), polarConnected: false }).db).importable('u1')).toEqual([]);
  });
});

describe('mapeamento Polar -> tabelas de saude', () => {
  it('instante ISO com fuso: epoch e deslocamento corretos; sem fuso nao ha como saber (null)', () => {
    expect(parsePolarInstant('2026-10-21T23:10:00+01:00')).toEqual({ epochSec: Date.parse('2026-10-21T22:10:00Z') / 1000, offsetSec: 3600 });
    expect(parsePolarInstant('2026-10-21T23:10:00.000-03:00')).toEqual({ epochSec: Date.parse('2026-10-22T02:10:00Z') / 1000, offsetSec: -10800 });
    expect(parsePolarInstant('2026-10-21T23:10:00Z')).toEqual({ epochSec: Date.parse('2026-10-21T23:10:00Z') / 1000, offsetSec: 0 });
    expect(parsePolarInstant('2026-10-21T23:10:00')).toBeNull();
    expect(parsePolarInstant(5)).toBeNull();
  });

  const sleep = { date: '2026-10-22', sleep_start_time: '2026-10-21T23:10:00-03:00', sleep_end_time: '2026-10-22T06:40:00-03:00', light_sleep: 14000, deep_sleep: 5000, rem_sleep: 6000, unrecognized_sleep_stage: 100, total_interruption_duration: 1500, sleep_score: 78, sleep_charge: 3, sleep_goal: 28800, hypnogram: { '23:10': 1 } };

  it('sono: etapas e interrupcoes vao direto; duracao = soma de leve+profundo+REM que a Polar informou; nada e inventado', () => {
    const m = mapPolarSleep(sleep)!;
    expect(m).toMatchObject({ calendarDate: '2026-10-22', startOffsetSec: -10800, lightSleepSec: 14000, deepSleepSec: 5000, remSleepSec: 6000, awakeSec: 1500, unmeasurableSec: 100, scoreValue: 78, durationSec: 25000, providerSummaryId: 'polar:sleep:2026-10-22' });
    expect(m.endTimeSec! - m.startTimeSec).toBe(27000);
    expect(m.levels).toEqual({ polarHypnogram: { '23:10': 1 } });
    expect((m.sleepScores as Record<string, unknown>).sleep_charge).toBe(3);
  });

  it('sono: etapa ausente => sem duracao (nao zero); sem horario/fuso ou sem data => registro ignorado', () => {
    expect(mapPolarSleep({ ...sleep, rem_sleep: undefined })!.durationSec).toBeNull();
    expect(mapPolarSleep({ ...sleep, rem_sleep: undefined })!.remSleepSec).toBeNull();
    expect(mapPolarSleep({ ...sleep, sleep_start_time: '2026-10-21T23:10:00' })).toBeNull();
    expect(mapPolarSleep({ ...sleep, date: undefined, sleep_end_time: undefined })).toBeNull();
    expect(mapPolarSleep({ ...sleep, date: undefined })!.calendarDate).toBe('2026-10-22'); // vem do fim da noite, no fuso local
    expect(mapPolarSleep(null)).toBeNull();
  });

  it('Nightly Recharge: HRV medio da noite vira lastNightAvg (sem converter unidade); sem HRV => ignorado', () => {
    const m = mapPolarNightlyRecharge({ date: '2026-10-22', heart_rate_variability_avg: 58.3, hrv_samples: { '00:05': 60 }, ans_charge: 4 })!;
    expect(m).toMatchObject({ calendarDate: '2026-10-22', lastNightAvg: 58.3, startOffsetSec: 0, providerSummaryId: 'polar:nightly-recharge:2026-10-22' });
    expect(m.startTimeSec).toBe(Date.parse('2026-10-22T00:00:00Z') / 1000); // estavel: o mesmo dia nunca vira duas linhas
    expect(m.hrvValues).toEqual({ '00:05': 60 });
    expect(mapPolarNightlyRecharge({ date: '2026-10-22', heart_rate_average: 50 })).toBeNull();
    expect(mapPolarNightlyRecharge({ date: '2026-10-22', heart_rate_variability_avg: -3 })).toBeNull();
    expect(mapPolarNightlyRecharge({ heart_rate_variability_avg: 50 })).toBeNull();
  });

  it('atividade diaria: passos, distancia e calorias ativas; FC de repouso NUNCA e mapeada; sem nenhum indicador => ignorado', () => {
    const m = mapPolarDailyActivity({ start_time: '2026-10-22T00:00:00', steps: 9100, distance_from_steps: 7050.5, active_calories: 410, calories: 2300 })!;
    expect(m).toMatchObject({ calendarDate: '2026-10-22', steps: 9100, distanceMeters: 7050.5, activeKilocalories: 410 });
    expect(m).not.toHaveProperty('restingHeartRateBpm');
    expect(mapPolarDailyActivity({ date: '2026-10-22', steps: 0 })!.steps).toBe(0); // zero medido e' valido; ausente e' null
    expect(mapPolarDailyActivity({ date: '2026-10-22', calories: 2300 })).toBeNull();
    expect(mapPolarDailyActivity({ steps: 100 })).toBeNull();
  });

  it('lista: aceita array puro ou objeto com a lista; qualquer outra forma = vazio', () => {
    expect(extractPolarList([1, 2], ['nights'])).toEqual([1, 2]);
    expect(extractPolarList({ nights: [1] }, ['nights'])).toEqual([1]);
    expect(extractPolarList({ outro: [3] }, ['nights'])).toEqual([3]);
    expect(extractPolarList('x', ['nights'])).toEqual([]);
    expect(extractPolarList(null, ['nights'])).toEqual([]);
  });
});

describe('PolarHealthIngestionService', () => {
  const ENV = process.env.POLAR_HEALTH_ENABLED;
  afterEach(() => { if (ENV === undefined) delete process.env.POLAR_HEALTH_ENABLED; else process.env.POLAR_HEALTH_ENABLED = ENV; jest.restoreAllMocks(); });
  const polar = { decryptAccessToken: jest.fn().mockReturnValue('segredo-do-token') };
  const sleepItem = { date: '2026-10-22', sleep_start_time: '2026-10-21T23:10:00-03:00', sleep_end_time: '2026-10-22T06:40:00-03:00', light_sleep: 14000, deep_sleep: 5000, rem_sleep: 6000, total_interruption_duration: 1500 };

  function stubFetch(responses: Record<string, { status: number; body?: unknown }>) {
    const fn = jest.fn(async (url: string) => {
      const path = String(url).replace('https://www.polaraccesslink.com', '').split('?')[0];
      const r = responses[path] ?? { status: 404 };
      return { status: r.status, json: async () => r.body ?? null } as unknown as Response;
    });
    (globalThis as { fetch: unknown }).fetch = fn;
    return fn;
  }

  it('desligado por padrao: nao chama a Polar nem grava nada', async () => {
    delete process.env.POLAR_HEALTH_ENABLED;
    const { db, calls } = fakeDb({ consent: row() });
    const fetchMock = stubFetch({});
    const result = await new PolarHealthIngestionService(db, polar as never).sync('u1');
    expect(result.status).toBe('disabled');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('sem autorizacao de saude: nada e buscado (fail-closed, ao contrario das atividades)', async () => {
    process.env.POLAR_HEALTH_ENABLED = 'true';
    const { db } = fakeDb({ consent: null });
    const fetchMock = stubFetch({});
    expect((await new PolarHealthIngestionService(db, polar as never).sync('u1')).status).toBe('no_consent');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Polar desconectada: nada e buscado', async () => {
    process.env.POLAR_HEALTH_ENABLED = 'true';
    const { db } = fakeDb({ consent: row(), polarConnected: false });
    const fetchMock = stubFetch({});
    expect((await new PolarHealthIngestionService(db, polar as never).sync('u1')).status).toBe('not_connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('so busca e grava as categorias autorizadas; grava com provider "polar" e a origem preservada', async () => {
    process.env.POLAR_HEALTH_ENABLED = 'true';
    const { db, calls } = fakeDb({ consent: row({ grantedCategories: ['sleep'] }) });
    const fetchMock = stubFetch({ '/v3/users/sleep': { status: 200, body: { nights: [sleepItem, { date: 'invalida' }] } } });
    const result = await new PolarHealthIngestionService(db, polar as never).sync('u1');
    expect(result.status).toBe('synced');
    expect(fetchMock.mock.calls.map((c) => String(c[0]).replace('https://www.polaraccesslink.com', ''))).toEqual(['/v3/users/sleep']);
    expect(result.categories.sleep).toEqual({ httpStatus: 200, written: 1, skipped: 1 });
    const upsert = calls.find((c) => c.table === 'sleep' && c.op === 'upsert')!;
    expect(upsert.args.create).toMatchObject({ userId: 'u1', provider: 'polar', calendarDate: '2026-10-22', durationSec: 25000 });
    expect(calls.some((c) => c.table === 'hrv' || c.table === 'daily')).toBe(false);
    // a noite recalculada substitui a anterior da mesma fonte/data (sem duplicar)
    expect(calls.find((c) => c.table === 'sleep' && c.op === 'deleteMany')!.args.where).toMatchObject({ userId: 'u1', provider: 'polar', calendarDate: '2026-10-22' });
  });

  it('403 (consentimento na Polar), 204 e erro de rede sao registrados sem derrubar; 401 e 429 interrompem', async () => {
    process.env.POLAR_HEALTH_ENABLED = 'true';
    const { db } = fakeDb({ consent: row() });
    stubFetch({ '/v3/users/sleep': { status: 403 }, '/v3/users/nightly-recharge': { status: 204 }, '/v3/users/activities': { status: 404 } });
    const mixed = await new PolarHealthIngestionService(db, polar as never).sync('u1');
    expect(mixed.status).toBe('synced');
    expect(mixed.categories).toEqual({ sleep: { httpStatus: 403, written: 0, skipped: 0 }, hrv: { httpStatus: 204, written: 0, skipped: 0 }, daily_activity: { httpStatus: 404, written: 0, skipped: 0 } });
    stubFetch({ '/v3/users/sleep': { status: 401 } });
    expect((await new PolarHealthIngestionService(db, polar as never).sync('u1')).status).toBe('token_invalid');
    const limited = stubFetch({ '/v3/users/sleep': { status: 429 } });
    expect((await new PolarHealthIngestionService(db, polar as never).sync('u1')).status).toBe('rate_limited');
    expect(limited).toHaveBeenCalledTimes(1);
  });

  it('autorizacao retirada NO MEIO do processamento: o registro nao e gravado (reconferida dentro da transacao)', async () => {
    process.env.POLAR_HEALTH_ENABLED = 'true';
    const { db, calls, state } = fakeDb({ consent: row({ grantedCategories: ['sleep'] }) });
    const first = db.$queryRaw;
    let n = 0;
    db.$queryRaw = async () => { n += 1; if (n > 1) state.consent = row({ grantedCategories: [] }); return first(); }; // a aluna retira depois do 1o registro
    stubFetch({ '/v3/users/sleep': { status: 200, body: [sleepItem, { ...sleepItem, date: '2026-10-23', sleep_start_time: '2026-10-22T23:00:00-03:00' }] } });
    const result = await new PolarHealthIngestionService(db, polar as never).sync('u1');
    expect(calls.filter((c) => c.table === 'sleep' && c.op === 'upsert')).toHaveLength(1);
    expect(result.categories.sleep).toMatchObject({ written: 1, skipped: 1 });
  });

  it('nao ha segredo nem valor de saude no resultado devolvido', async () => {
    process.env.POLAR_HEALTH_ENABLED = 'true';
    const { db } = fakeDb({ consent: row({ grantedCategories: ['sleep'] }) });
    stubFetch({ '/v3/users/sleep': { status: 200, body: [sleepItem] } });
    const result = await new PolarHealthIngestionService(db, polar as never).sync('u1');
    expect(JSON.stringify(result)).not.toMatch(/segredo-do-token|14000|5000|2026-10/);
  });

  it('rotina periodica: linha inelegivel (texto desatualizado) e marcada para girar e nao ocupar o lote; lote ordenado pelas mais antigas', async () => {
    process.env.POLAR_HEALTH_ENABLED = 'true';
    const { db, calls } = fakeDb({ consent: row({ consentTextHash: 'antigo' }) });
    let orderBy: unknown;
    db.providerConnection.findMany = async (args: any) => { orderBy = args.orderBy; return [{ userId: 'u1' }]; };
    stubFetch({});
    await new PolarHealthIngestionService(db, polar as never).syncStale(new Date('2026-10-23T12:00:00Z'));
    expect(orderBy).toEqual({ lastSyncCompletedAt: { sort: 'asc', nulls: 'first' } });
    expect(calls.find((c) => c.op === 'updateMany')!.args.data.lastSyncCompletedAt).toEqual(new Date('2026-10-23T12:00:00Z'));
  });

  it('rotina periodica: so age ligada e so para quem tem autorizacao ativa', async () => {
    delete process.env.POLAR_HEALTH_ENABLED;
    expect(await new PolarHealthIngestionService(fakeDb().db, polar as never).syncStale()).toEqual({ eligible: 0, synced: 0, failed: 0 });
    process.env.POLAR_HEALTH_ENABLED = 'true';
    const { db } = fakeDb({ consent: row() });
    db.providerConnection.findMany = async (args: any) => { expect(args.where).toMatchObject({ provider: 'polar_health', disconnectedAt: null }); return [{ userId: 'u1' }]; };
    stubFetch({});
    const r = await new PolarHealthIngestionService(db, polar as never).syncStale();
    expect(r).toEqual({ eligible: 1, synced: 1, failed: 0 });
  });
});

describe('diagnostico administrativo (somente leitura)', () => {
  const ENV = { probe: process.env.POLAR_PROBE_ENABLED, single: process.env.POLAR_PROBE_ALLOW_SINGLE_CONNECTION };
  afterEach(() => {
    for (const [key, value] of [['POLAR_PROBE_ENABLED', ENV.probe], ['POLAR_PROBE_ALLOW_SINGLE_CONNECTION', ENV.single]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const polar = { decryptAccessToken: jest.fn().mockReturnValue('tok-secreto') };
  const prismaWith = (own: boolean, others: number) => ({
    polarConnection: {
      findUnique: async () => (own ? { disconnectedAt: null, accessTokenEncrypted: 'enc' } : null),
      findMany: async () => Array.from({ length: others }, () => ({ accessTokenEncrypted: 'enc' })),
    },
  }) as never;
  const bodies: Record<string, { status: number; body?: unknown }> = {
    '/v3/users/sleep': { status: 200, body: [{ date: '2026-10-22', sleep_start_time: '2026-10-21T23:10:00-03:00', sleep_end_time: '2026-10-22T06:40:00-03:00', light_sleep: 14000, deep_sleep: 5000, rem_sleep: 6000, unrecognized_sleep_stage: 100, total_interruption_duration: 1500, sleep_score: 78, hypnogram: { a: 1, b: 2 } }] },
    '/v3/users/nightly-recharge': { status: 200, body: [{ date: '2026-10-22', heart_rate_variability_avg: 58.3, hrv_samples: { '00:05': 60, '00:10': 56 }, ans_charge: 4 }] },
    '/v3/users/activities': { status: 403 },
    '/v3/users/continuous-heart-rate': { status: 204 },
  };
  const stub = () => {
    const fn = jest.fn(async (url: string) => {
      const path = String(url).replace('https://www.polaraccesslink.com', '').split('?')[0];
      const r = bodies[path] ?? { status: 404 };
      return { status: r.status, json: async () => r.body ?? null } as unknown as Response;
    });
    (globalThis as { fetch: unknown }).fetch = fn;
    return fn;
  };

  it('desligado por padrao (a rota responde 404)', () => {
    delete process.env.POLAR_PROBE_ENABLED;
    expect(new PolarProbeService(prismaWith(true, 0), polar as never).enabled()).toBe(false);
  });

  it('usa a conexao do PROPRIO administrador que chamou; sem conexao propria nao usa a de outra conta (a menos de autorizacao explicita)', async () => {
    process.env.POLAR_PROBE_ENABLED = 'true';
    delete process.env.POLAR_PROBE_ALLOW_SINGLE_CONNECTION;
    const fetchNone = jest.fn(); (globalThis as { fetch: unknown }).fetch = fetchNone;
    const noOwn = await new PolarProbeService(prismaWith(false, 1), polar as never).run('admin');
    expect(noOwn.endpoints).toEqual([]);
    expect(noOwn.note).toMatch(/POLAR_PROBE_ALLOW_SINGLE_CONNECTION/);
    expect(fetchNone).not.toHaveBeenCalled();
    const own = stub();
    expect((await new PolarProbeService(prismaWith(true, 5), polar as never).run('admin')).endpoints.length).toBe(4);
    expect(own).toHaveBeenCalled();
  });

  it('com a autorizacao explicita, usa a unica conexao ativa; com mais de uma, recusa', async () => {
    process.env.POLAR_PROBE_ENABLED = 'true';
    process.env.POLAR_PROBE_ALLOW_SINGLE_CONNECTION = 'true';
    stub();
    expect((await new PolarProbeService(prismaWith(false, 1), polar as never).run('admin')).endpoints.length).toBe(4);
    const fetchNone = jest.fn(); (globalThis as { fetch: unknown }).fetch = fetchNone;
    for (const n of [0, 2]) expect((await new PolarProbeService(prismaWith(false, n), polar as never).run('admin')).endpoints).toEqual([]);
    expect(fetchNone).not.toHaveBeenCalled();
  });

  it('devolve so estrutura AGREGADA: status, campos, formatos (digitos viram d), faixas e a conta do sono por diferencas — sem token, datas, nem valores por noite', async () => {
    process.env.POLAR_PROBE_ENABLED = 'true';
    stub();
    const result = await new PolarProbeService(prismaWith(true, 0), polar as never).run('admin');
    const byEndpoint = Object.fromEntries(result.endpoints.map((e) => [e.endpoint.split(' ')[1].split('?')[0], e]));
    expect(byEndpoint['/v3/users/sleep'].sleepReconciliation).toEqual({
      noites: 1,
      diferenca_intervalo_menos_soma_leve_profundo_rem_s: { min: 2000, max: 2000, n: 1 },
      diferenca_intervalo_menos_etapas_mais_interrupcoes_s: { min: 500, max: 500, n: 1 },
      diferenca_intervalo_menos_etapas_mais_interrupcoes_mais_nao_reconhecido_s: { min: 400, max: 400, n: 1 },
    });
    expect(byEndpoint['/v3/users/sleep'].formats!.sleep_start_time).toBe('dddd-dd-ddTdd:dd:dd-dd:dd');
    expect(byEndpoint['/v3/users/nightly-recharge'].ranges!.heart_rate_variability_avg).toEqual({ min: 58.3, max: 58.3, n: 1 });
    expect(byEndpoint['/v3/users/nightly-recharge'].ranges!.hrv_samples).toEqual({ min: 56, max: 60, n: 2 });
    expect(byEndpoint['/v3/users/activities'].httpStatus).toBe(403);
    expect(byEndpoint['/v3/users/activities'].meaning).toMatch(/consentimentos obrigatorios/);
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/tok-secreto/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/); // nenhuma data real sai
    expect(text).not.toMatch(/"(leve_s|profundo_s|rem_s|interrupcoes_s)"/); // nenhum valor por noite
  });

  it('a rota e restrita ao administrador e passa o id dele; some (404) sem a variavel; e e temporaria', () => {
    const controller = readFileSync(join(__dirname, '..', 'src', 'polar', 'polar-probe.controller.ts'), 'utf8');
    expect(controller).toContain("@Roles('admin')");
    expect(controller).toContain("AuthGuard('jwt'), RolesGuard");
    expect(controller).toContain('NotFoundException');
    expect(controller).toContain('this.probe.run(user.sub)');
    expect(controller).toMatch(/TEMPORARIO/);
    const service = readFileSync(join(__dirname, '..', 'src', 'polar', 'polar-probe.service.ts'), 'utf8');
    expect(service).not.toMatch(/\.(create|update|updateMany|upsert|delete|deleteMany)\s*\(/);
    expect(service).not.toMatch(/logger|console\./);
  });
});

describe('IA: saude da Polar fica FORA do Atlas (fail-closed)', () => {
  it('as categorias de saude de Polar e Wahoo estao sempre bloqueadas no escopo; as de Zepp/Health Connect seguem a regra delas', async () => {
    const prisma: any = { activityLog: { findMany: async () => [] }, providerConnection: { findUnique: async () => null }, providerConnectionEvent: { findFirst: async () => null } };
    const registry: any = { list: () => [], get: () => undefined };
    const config: any = { get: () => undefined };
    const scope = await new AiDataEligibility(prisma, registry, config).scopeFor('u1', 'external_ai');
    for (const category of ['sleep', 'hrv', 'daily_activity', 'resting_heart_rate']) expect(scope.blockedHealth).toContain(`polar:${category}`);
    expect(scope.blockedHealth).toContain('health_connect:sleep'); // sem conexao: bloqueado pela regra propria
  });
});

describe('IA: nenhum leitor entrega saude da Polar dentro do escopo de IA', () => {
  it('ObservationReader: linhas provider=polar das tabelas Wearable* ficam de fora quando o escopo as bloqueia', async () => {
    const sleepRow = { id: 's1', userId: 'u1', provider: 'polar', providerSummaryId: 'polar:sleep:2026-10-22', calendarDate: '2026-10-22', startTimeSec: 1, durationSec: 25000 };
    const reader = Object.create(ObservationReaderService.prototype) as any;
    reader.prisma = { wearableSleepSummary: { findMany: async () => [sleepRow] }, wearableDailySummary: { findMany: async () => [] }, wearableHrvSummary: { findMany: async () => [] } };
    const scope = { userId: 'u1', destination: 'external_ai', blocked: [], blockedHealth: ['polar:sleep', 'polar:hrv', 'polar:daily_activity'], computedAt: Date.now() } as never;
    await runWithAiScope(scope, async () => {
      expect(await reader.readWearableHealthVariable('u1', VARIABLE_REGISTRY['wearable.sleepDurationMin'])).toEqual([]);
    });
  });
});

describe('painel: Polar na aba Integracoes e na Saude e Recuperacao', () => {
  const NOW = new Date('2026-10-23T20:00:00Z');
  const none = { lastAt: null, count: 0 };
  const baseRaw = (over: Partial<IntegrationsRaw> = {}): IntegrationsRaw => ({
    polar: { createdAt: new Date('2026-09-01T00:00:00Z'), disconnectedAt: null, lastSyncCompletedAt: null }, wahoo: null, strava: null, zepp: null, activityByProvider: { polar: { lastAt: new Date('2026-10-20T00:00:00Z'), count: 3 } },
    zepp_activity_sensors: none, zepp_activity_route: none, zepp_sleep: none, zepp_daily: none, zepp_resting_hr: none, zepp_hrv: none,
    zeppLastProcessedEventAt: null, zeppWorkoutLastAcceptedAt: null, inboundFailures: [], zeppWorkoutFailures: [], ...over,
  });
  const polarEntry = (raw: IntegrationsRaw) => buildStudentIntegrations('u1', raw, NOW, false).integrations.find((i) => i.provider === 'polar')!;

  it('sem escolha da aluna: as tres categorias de saude aparecem como NAO autorizadas (atividades seguem como antes)', () => {
    const entry = polarEntry(baseRaw());
    expect(entry.categories.map((c) => [c.id, c.authorized])).toEqual([['activity', true], ['sleep', false], ['hrv', false], ['daily_activity', false]]);
  });

  it('com autorizacao vigente e recebimento: autorizada, com contagem e ultima chegada', () => {
    const entry = polarEntry(baseRaw({ polarHealth: { row: row({ grantedCategories: ['sleep', 'daily_activity'] }), receipts: { sleep: { lastAt: new Date('2026-10-23T08:00:00Z'), count: 12 } } } }));
    const sleep = entry.categories.find((c) => c.id === 'sleep')!;
    expect(sleep).toMatchObject({ authorized: true, count: 12, lastAt: '2026-10-23T08:00:00.000Z' });
    expect(entry.categories.find((c) => c.id === 'hrv')!.authorized).toBe(false);
    expect(entry.categories.find((c) => c.id === 'daily_activity')!.authorized).toBe(true);
  });

  it('Polar desconectada ou texto desatualizado: nenhuma categoria de saude autorizada', () => {
    const disconnected = polarEntry(baseRaw({ polar: { createdAt: new Date('2026-09-01T00:00:00Z'), disconnectedAt: new Date('2026-10-22T00:00:00Z'), lastSyncCompletedAt: null }, polarHealth: { row: row(), receipts: {} } }));
    expect(disconnected.categories.filter((c) => c.id !== 'activity').every((c) => c.authorized === false)).toBe(true);
    const stale = polarEntry(baseRaw({ polarHealth: { row: row({ consentTextHash: 'antigo' }), receipts: {} } }));
    expect(stale.categories.filter((c) => c.id !== 'activity').every((c) => c.authorized === false)).toBe(true);
  });

  it('Saude e Recuperacao: dados da Polar so aparecem com a categoria autorizada; FC de repouso nunca; fonte e nota do HRV da Polar', async () => {
    const hrv = [{ provider: 'polar', providerSummaryId: 'polar:nightly-recharge:2026-10-22', calendarDate: '2026-10-22', lastNightAvg: 58, receivedAt: new Date('2026-10-23T10:00:00Z') }];
    const daily = [{ provider: 'polar', providerSummaryId: 'polar:activity:2026-10-22', calendarDate: '2026-10-22', steps: 9000, activeKilocalories: 400, restingHeartRateBpm: 52, receivedAt: new Date('2026-10-23T10:00:00Z') }];
    const make = (categories: Array<{ id: string; authorized: boolean }>) => new StudentHealthRecoveryService({
      user: { findUnique: async () => ({ id: 'u1' }) }, wearableSleepSummary: { findMany: async () => [] }, wearableHrvSummary: { findMany: async () => hrv }, wearableDailySummary: { findMany: async () => daily },
    } as never, { forStudent: async () => ({ integrations: [{ provider: 'polar', state: 'connected', categories }] }) } as never, new MathLayerService());
    const allowed = await make([{ id: 'sleep', authorized: true }, { id: 'hrv', authorized: true }, { id: 'daily_activity', authorized: true }]).forStudent('u1', { from: '2026-10-01', to: '2026-10-30' });
    const get = (r: typeof allowed, id: string) => r.indicators.find((i) => i.id === id)!;
    expect(get(allowed, 'hrv').points).toEqual([{ date: '2026-10-22', value: 58 }]);
    expect(get(allowed, 'hrv').methodNote).toMatch(/Polar/);
    expect(get(allowed, 'hrv').sources[0].name).toBe('Polar');
    expect(get(allowed, 'steps').points).toHaveLength(1);
    expect(get(allowed, 'restingHr').points).toEqual([]); // a Polar nao tem FC de repouso diaria, mesmo que a linha traga o campo
    expect(get(allowed, 'restingHr').state).toBe('nao_autorizada');
    const blocked = await make([{ id: 'sleep', authorized: true }, { id: 'hrv', authorized: false }, { id: 'daily_activity', authorized: false }]).forStudent('u1', { from: '2026-10-01', to: '2026-10-30' });
    expect(get(blocked, 'hrv').points).toEqual([]);
    expect(get(blocked, 'steps').points).toEqual([]);
    expect(sourceDisplayName('polar')).toBe('Polar');
  });
});

describe('estrutura da ampliacao', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', 'src', ...parts), 'utf8');

  it('o fluxo de exercicios nao foi tocado e a ingestao de saude nao usa a transacao antiga', () => {
    const exercises = read('polar', 'polar-activity-ingestion.service.ts');
    expect(exercises).not.toMatch(/polar_health|nightly-recharge|\/v3\/users\/sleep/);
    expect(read('polar', 'polar-health-ingestion.service.ts')).not.toMatch(/exercise-transactions/);
  });

  it('a importacao de saude nao esta ligada por padrao e a conexao de saude e uma linha propria', () => {
    const ingestion = read('polar', 'polar-health-ingestion.service.ts');
    expect(ingestion).toContain("(env.POLAR_HEALTH_ENABLED ?? '').trim().toLowerCase() === 'true'");
    expect(read('polar', 'polar-health-consent.ts')).toContain("POLAR_HEALTH_PROVIDER_ID = 'polar_health'");
  });

  it('desconectar a Polar encerra a autorizacao de saude e excluir os dados apaga a saude importada', () => {
    const service = read('polar', 'polar.service.ts');
    expect(service).toContain('this.health?.revokeOnDisconnect(userId)');
    expect(service).toContain('this.health?.eraseImportedData(userId)');
    expect(service).not.toMatch(/providerConnection/i); // o pipeline de exercicios nao toca na conexao generica
  });
});
