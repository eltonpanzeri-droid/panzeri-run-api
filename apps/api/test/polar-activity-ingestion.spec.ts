import { readFileSync } from 'fs';
import { join } from 'path';
import { BadGatewayException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { PolarService } from '../src/polar/polar.service';
import { PolarActivityIngestionService } from '../src/polar/polar-activity-ingestion.service';

interface FakeConnection {
  userId: string;
  polarUserId: string;
  accessTokenEncrypted: string;
  registeredAt: Date | null;
  openTransactionId: string | null;
  openTransactionOpenedAt: Date | null;
  lastSyncCompletedAt: Date | null;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

// Enfileira respostas na ordem EXATA das chamadas HTTP que o fluxo faz: registrar -> abrir
// transaction -> listar exercicios -> buscar cada exercicio (em ordem) -> commit.
function queueFetch(responses: Response[]) {
  let i = 0;
  const calls: string[] = [];
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (i >= responses.length) throw new Error(`fetch chamado mais vezes que o esperado (chamada ${i + 1}: ${url})`);
    return responses[i++];
  });
  return { fn, calls };
}

// Mock de Prisma com armazenamento em memoria real (Map), nao so jest.fn espionado — permite
// verificar de fato ausencia de duplicata/perda apos upserts repetidos, nao so "foi chamado".
// Deliberadamente NAO define stravaActivity/stravaConnection: se algum caminho de codigo tentar
// tocar Strava, o teste quebra com "is not a function" em vez de passar escondendo a interferencia.
function fixture(connection: FakeConnection | null) {
  const rawStore = new Map<string, Record<string, unknown>>();
  const activityStore = new Map<string, Record<string, unknown>>();
  const sampleStore = new Map<string, Record<string, unknown>>();
  let conn = connection;
  let rawSeq = 0;
  let logSeq = 0;
  let sampleSeq = 0;

  const keyOf = (where: { provider_userId_externalId: { provider: string; userId: string; externalId: string } }) => {
    const k = where.provider_userId_externalId;
    return `${k.provider}|${k.userId}|${k.externalId}`;
  };
  const sampleKeyOf = (where: { activityLogId_provider_sampleType: { activityLogId: string; provider: string; sampleType: string } }) => {
    const k = where.activityLogId_provider_sampleType;
    return `${k.activityLogId}|${k.provider}|${k.sampleType}`;
  };

  const prisma = {
    polarConnection: {
      findUnique: jest.fn(async () => conn),
      update: jest.fn(async ({ data }: { data: Partial<FakeConnection> }) => {
        conn = { ...(conn as FakeConnection), ...data };
        return conn;
      }),
    },
    rawExternalActivity: {
      upsert: jest.fn(async ({ where, create, update }: { where: Parameters<typeof keyOf>[0]; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = keyOf(where);
        const existing = rawStore.get(key);
        const row = existing ? { ...existing, ...update } : { id: `raw-${++rawSeq}`, ...create };
        rawStore.set(key, row);
        return row;
      }),
    },
    activityLog: {
      upsert: jest.fn(async ({ where, create, update }: { where: Parameters<typeof keyOf>[0]; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = keyOf(where);
        const existing = activityStore.get(key);
        const row = existing ? { ...existing, ...update } : { id: `log-${++logSeq}`, ...create };
        activityStore.set(key, row);
        return row;
      }),
    },
    rawActivitySample: {
      upsert: jest.fn(async ({ where, create, update }: { where: Parameters<typeof sampleKeyOf>[0]; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = sampleKeyOf(where);
        const existing = sampleStore.get(key);
        const row = existing ? { ...existing, ...update } : { id: `sample-${++sampleSeq}`, ...create };
        sampleStore.set(key, row);
        return row;
      }),
    },
  };

  const polarService = { decryptAccessToken: jest.fn(() => 'plain-access-token') };
  // Stub: a normalizacao canonica (ActivityTimeSeriesService) tem testes proprios e dedicados em
  // activity-timeseries.service.spec.ts. Aqui so' precisamos confirmar que ela e' CHAMADA sem
  // quebrar o fluxo de ingestao — nao reimplementamos sua logica de novo neste arquivo.
  const timeSeriesService = { normalizeFromRawSamples: jest.fn(async () => undefined) };
  // Stub: o Motor de Reconciliacao (SessionExecutionLinkService.classify) tem testes proprios e
  // dedicados em reconciliation-v1.spec.ts. Aqui so' precisamos confirmar que ele e' ACIONADO apos
  // a ingestao sem quebrar o fluxo — nao reimplementamos a logica de classificacao de novo aqui.
  const sessionExecutionLinkService = { classify: jest.fn(async () => 'corresponding') };
  const service = new PolarActivityIngestionService(
    prisma as unknown as PrismaService,
    polarService as unknown as PolarService,
    timeSeriesService as unknown as import('../src/activity-timeseries/activity-timeseries.service').ActivityTimeSeriesService,
    sessionExecutionLinkService as unknown as import('../src/activity-execution/session-execution-link.service').SessionExecutionLinkService,
  );

  return { service, prisma, rawStore, activityStore, sampleStore, timeSeriesService, sessionExecutionLinkService, getConnection: () => conn };
}

// Resposta padrao pra' "esta atividade nao tem samples disponiveis" — usada em todos os testes
// que nao sao especificamente sobre samples, pra nao precisar simular um payload de samples em
// cada um deles. 404 e' tratado pelo servico como ausencia de dado, nunca como erro.
const NO_SAMPLES_RESPONSE = () => jsonResponse(404, {});

const baseConnection = (overrides: Partial<FakeConnection> = {}): FakeConnection => ({
  userId: 'user-a',
  polarUserId: '999',
  accessTokenEncrypted: 'v1:iv:tag:data',
  registeredAt: null,
  openTransactionId: null,
  openTransactionOpenedAt: null,
  lastSyncCompletedAt: null,
  ...overrides,
});

const EXERCISE_URL = 'https://www.polaraccesslink.com/v3/users/999/exercise-transactions/txn-1/exercises/ex-1';
const EXERCISE_URL_2 = 'https://www.polaraccesslink.com/v3/users/999/exercise-transactions/txn-1/exercises/ex-2';

describe('PolarActivityIngestionService', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('primeira importacao: registra, abre transaction, importa 1 exercicio e commita', async () => {
    const { service, rawStore, activityStore, getConnection } = fixture(baseConnection());
    const summary = {
      id: 123456789,
      sport: 'RUNNING',
      duration: 'PT31M15S',
      distance: 5230.5,
      calories: 320,
      'start-time': '2026-09-30T07:15:00Z',
      'start-time-utc-offset': -180,
      'has-route': true,
      'heart-rate': { average: 152, maximum: 178 },
    };
    const { fn } = queueFetch([
      jsonResponse(200, {}), // registrar
      jsonResponse(201, { 'transaction-id': 'txn-1' }), // abrir transaction
      jsonResponse(200, { exercises: [EXERCISE_URL] }), // listar
      jsonResponse(200, summary), // buscar exercicio
      NO_SAMPLES_RESPONSE(), // listar samples (ausentes)
      jsonResponse(200, {}), // commit
    ]);
    global.fetch = fn as unknown as typeof fetch;

    const result = await service.sync('user-a');

    expect(result).toEqual({ status: 'synced', imported: 1, resumedTransaction: false });
    expect(getConnection()?.registeredAt).toBeInstanceOf(Date);
    expect(getConnection()?.openTransactionId).toBeNull();
    expect(getConnection()?.lastSyncCompletedAt).toBeInstanceOf(Date);

    const raw = rawStore.get('polar|user-a|123456789');
    expect(raw).toBeDefined();
    expect(raw?.payload).toEqual(summary); // payload bruto preservado por inteiro

    const log = activityStore.get('polar|user-a|123456789');
    expect(log).toMatchObject({
      distanceMeters: 5230.5,
      durationSec: 31 * 60 + 15,
      sport: 'corrida', // modalidade canonica (sport=RUNNING normalizado), nunca o enum bruto
      caloriesKcal: 320,
      avgHeartRateBpm: 152,
      maxHeartRateBpm: 178,
      hasRoute: true,
    });
    expect((log?.startedAt as Date).toISOString()).toBe('2026-09-30T07:15:00.000Z');
  });

  it('nao registra de novo nem reabre transaction quando ja registrado', async () => {
    const { service } = fixture(baseConnection({ registeredAt: new Date() }));
    const { fn, calls } = queueFetch([
      jsonResponse(204, {}), // abrir transaction -> nada novo
    ]);
    global.fetch = fn as unknown as typeof fetch;

    const result = await service.sync('user-a');
    expect(result).toEqual({ status: 'no_new_data', imported: 0, resumedTransaction: false });
    expect(calls).toEqual(['POST https://www.polaraccesslink.com/v3/users/999/exercise-transactions']);
  });

  it('registro (POST /v3/users) com 401: falha com UnauthorizedException, registeredAt permanece null e nenhuma transaction e aberta', async () => {
    const { service, getConnection } = fixture(baseConnection({ registeredAt: null }));
    const { fn, calls } = queueFetch([jsonResponse(401, { error: 'invalid_token' })]);
    global.fetch = fn as unknown as typeof fetch;

    await expect(service.sync('user-a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(getConnection()?.registeredAt).toBeNull();
    expect(calls).toEqual(['POST https://www.polaraccesslink.com/v3/users']);
  });

  it('registro (POST /v3/users) com 500: falha com BadGatewayException, registeredAt permanece null e nenhuma transaction e aberta', async () => {
    const { service, getConnection } = fixture(baseConnection({ registeredAt: null }));
    const { fn, calls } = queueFetch([jsonResponse(500, { error: 'internal' })]);
    global.fetch = fn as unknown as typeof fetch;

    await expect(service.sync('user-a')).rejects.toBeInstanceOf(BadGatewayException);
    expect(getConnection()?.registeredAt).toBeNull();
    expect(calls).toEqual(['POST https://www.polaraccesslink.com/v3/users']);
  });

  it('registro (POST /v3/users) com falha de rede: falha de forma controlada, registeredAt permanece null e nenhuma transaction e aberta', async () => {
    const { service, getConnection } = fixture(baseConnection({ registeredAt: null }));
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      throw new Error('network unreachable');
    }) as unknown as typeof fetch;

    await expect(service.sync('user-a')).rejects.toBeInstanceOf(BadGatewayException);
    expect(getConnection()?.registeredAt).toBeNull();
    expect(calls).toEqual(['POST https://www.polaraccesslink.com/v3/users']);
  });

  it('mesma atividade Polar recebida duas vezes nao duplica nem perde dado', async () => {
    const summary = {
      id: 'ex-42',
      distance: 10000,
      duration: 'PT50M0S',
      'start-time': '2026-09-30T10:00:00Z',
    };
    const runOnce = async (conn: FakeConnection) => {
      const { service, rawStore, activityStore } = fixture(conn);
      const { fn } = queueFetch([
        jsonResponse(201, { 'transaction-id': 'txn-x' }),
        jsonResponse(200, { exercises: [EXERCISE_URL] }),
        jsonResponse(200, summary),
        NO_SAMPLES_RESPONSE(),
        jsonResponse(200, {}),
      ]);
      global.fetch = fn as unknown as typeof fetch;
      await service.sync('user-a');
      return { rawStore, activityStore };
    };

    const first = await runOnce(baseConnection({ registeredAt: new Date() }));
    expect(first.rawStore.size).toBe(1);
    expect(first.activityStore.size).toBe(1);

    // Segunda entrega da mesma atividade (ex.: Polar reenviando, ou nova tentativa manual) —
    // upsert pela chave (provider, userId, externalId) deve sobrescrever a MESMA linha, nunca
    // criar uma segunda.
    const second = await runOnce(baseConnection({ registeredAt: new Date() }));
    expect(second.rawStore.size).toBe(1);
    expect(second.activityStore.size).toBe(1);
  });

  it('duas atividades no mesmo dia geram dois registros canonicos distintos', async () => {
    const { service, activityStore } = fixture(baseConnection({ registeredAt: new Date() }));
    const morning = { id: 'am-1', distance: 5000, duration: 'PT25M0S', 'start-time': '2026-09-30T07:00:00Z' };
    const evening = { id: 'pm-1', distance: 8000, duration: 'PT40M0S', 'start-time': '2026-09-30T18:00:00Z' };
    const { fn } = queueFetch([
      jsonResponse(201, { 'transaction-id': 'txn-2' }),
      jsonResponse(200, { exercises: [EXERCISE_URL, EXERCISE_URL_2] }),
      jsonResponse(200, morning),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, evening),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, {}),
    ]);
    global.fetch = fn as unknown as typeof fetch;

    const result = await service.sync('user-a');
    expect(result.imported).toBe(2);
    expect(activityStore.size).toBe(2);
    expect(activityStore.get('polar|user-a|am-1')).toMatchObject({ distanceMeters: 5000 });
    expect(activityStore.get('polar|user-a|pm-1')).toMatchObject({ distanceMeters: 8000 });
  });

  it('atividade sem rota (has-route ausente) fica null, nao false nem true por adivinhacao', async () => {
    const { service, activityStore } = fixture(baseConnection({ registeredAt: new Date() }));
    const summary = { id: 'no-route', distance: 3000, duration: 'PT15M0S', 'start-time': '2026-09-30T07:00:00Z' };
    const { fn } = queueFetch([
      jsonResponse(201, { 'transaction-id': 'txn-3' }),
      jsonResponse(200, { exercises: [EXERCISE_URL] }),
      jsonResponse(200, summary),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, {}),
    ]);
    global.fetch = fn as unknown as typeof fetch;
    await service.sync('user-a');
    expect(activityStore.get('polar|user-a|no-route')?.hasRoute).toBeNull();
  });

  it('atividade sem FC preserva null em vez de zero', async () => {
    const { service, activityStore } = fixture(baseConnection({ registeredAt: new Date() }));
    const summary = { id: 'no-hr', distance: 3000, duration: 'PT15M0S', 'start-time': '2026-09-30T07:00:00Z' };
    const { fn } = queueFetch([
      jsonResponse(201, { 'transaction-id': 'txn-4' }),
      jsonResponse(200, { exercises: [EXERCISE_URL] }),
      jsonResponse(200, summary),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, {}),
    ]);
    global.fetch = fn as unknown as typeof fetch;
    await service.sync('user-a');
    const log = activityStore.get('polar|user-a|no-hr');
    expect(log?.avgHeartRateBpm).toBeNull();
    expect(log?.maxHeartRateBpm).toBeNull();
  });

  it('campos opcionais ausentes (distancia, duracao, calorias) ficam null, nunca zero/undefined silencioso; modalidade sem sport reconhecido cai em "outra" (nunca null, nunca o enum bruto)', async () => {
    const { service, activityStore } = fixture(baseConnection({ registeredAt: new Date() }));
    const summary = { id: 'bare-minimum', 'start-time': '2026-09-30T07:00:00Z' };
    const { fn } = queueFetch([
      jsonResponse(201, { 'transaction-id': 'txn-5' }),
      jsonResponse(200, { exercises: [EXERCISE_URL] }),
      jsonResponse(200, summary),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, {}),
    ]);
    global.fetch = fn as unknown as typeof fetch;
    await service.sync('user-a');
    const log = activityStore.get('polar|user-a|bare-minimum');
    expect(log).toMatchObject({
      distanceMeters: null, durationSec: null, caloriesKcal: null, sport: 'outra',
      avgHeartRateBpm: null, maxHeartRateBpm: null, hasRoute: null,
    });
  });

  it('start-time sem timezone explicito e convertido para UTC usando start-time-utc-offset', async () => {
    const { service, activityStore } = fixture(baseConnection({ registeredAt: new Date() }));
    // Hora local 07:15 em fuso -03:00 (Brasil) -> UTC 10:15.
    const summary = { id: 'tz-1', 'start-time': '2026-09-30T07:15:00', 'start-time-utc-offset': -180 };
    const { fn } = queueFetch([
      jsonResponse(201, { 'transaction-id': 'txn-6' }),
      jsonResponse(200, { exercises: [EXERCISE_URL] }),
      jsonResponse(200, summary),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, {}),
    ]);
    global.fetch = fn as unknown as typeof fetch;
    await service.sync('user-a');
    const log = activityStore.get('polar|user-a|tz-1');
    expect((log?.startedAt as Date).toISOString()).toBe('2026-09-30T10:15:00.000Z');
  });

  it('erro da Polar (5xx) ao abrir transaction propaga BadGatewayException sem corromper estado', async () => {
    const { service, getConnection } = fixture(baseConnection({ registeredAt: new Date() }));
    const { fn } = queueFetch([jsonResponse(500, { error: 'internal' })]);
    global.fetch = fn as unknown as typeof fetch;
    await expect(service.sync('user-a')).rejects.toBeInstanceOf(BadGatewayException);
    expect(getConnection()?.openTransactionId).toBeNull();
  });

  it('token Polar invalido/expirado (401) em qualquer chamada gera UnauthorizedException', async () => {
    const { service } = fixture(baseConnection({ registeredAt: new Date() }));
    const { fn } = queueFetch([jsonResponse(401, { error: 'invalid_token' })]);
    global.fetch = fn as unknown as typeof fetch;
    await expect(service.sync('user-a')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('falha no meio da sincronizacao: preserva o que ja persistiu, nao commita, e retry completa sem duplicar', async () => {
    const conn = baseConnection({ registeredAt: new Date() });
    const { service, rawStore, activityStore, getConnection } = fixture(conn);
    const ex1 = { id: 'ex-1', distance: 1000, duration: 'PT5M0S', 'start-time': '2026-09-30T07:00:00Z' };
    const { fn: fetchFail } = queueFetch([
      jsonResponse(201, { 'transaction-id': 'txn-partial' }),
      jsonResponse(200, { exercises: [EXERCISE_URL, EXERCISE_URL_2] }),
      jsonResponse(200, ex1), // exercicio 1 ok
      NO_SAMPLES_RESPONSE(), // samples do exercicio 1
      jsonResponse(500, { error: 'timeout' }), // exercicio 2 falha
    ]);
    global.fetch = fetchFail as unknown as typeof fetch;

    await expect(service.sync('user-a')).rejects.toBeInstanceOf(InternalServerErrorException);

    // Exercicio 1 foi persistido apesar da falha do exercicio 2 — nao perdido.
    expect(rawStore.size).toBe(1);
    expect(activityStore.size).toBe(1);
    // Transaction Polar NAO foi commitada (nao ha chamada PUT na fila acima, e o teste passaria
    // sem consumi-la de qualquer forma) — continua aberta para retomada.
    expect(getConnection()?.openTransactionId).toBe('txn-partial');

    // Retry: mesma transaction e reutilizada (sem novo POST de abertura), exercicio 1 e
    // reprocessado (idempotente) e exercicio 2 agora entra com sucesso.
    const ex2 = { id: 'ex-2', distance: 2000, duration: 'PT10M0S', 'start-time': '2026-09-30T08:00:00Z' };
    const { fn: fetchRetry, calls } = queueFetch([
      jsonResponse(200, { exercises: [EXERCISE_URL, EXERCISE_URL_2] }), // lista de novo a MESMA transaction
      jsonResponse(200, ex1),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, ex2),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, {}), // commit
    ]);
    global.fetch = fetchRetry as unknown as typeof fetch;

    const retryResult = await service.sync('user-a');
    expect(retryResult).toEqual({ status: 'synced', imported: 2, resumedTransaction: true });
    // Retomou a MESMA transaction: a 1a chamada do retry e a listagem (GET), nao uma abertura
    // (POST) de nova transaction — confirmado tambem pelo fato de nenhuma resposta de abertura
    // ter sido enfileirada acima e o sync ainda assim ter tido sucesso.
    expect(calls[0]).toBe(`GET https://www.polaraccesslink.com/v3/users/999/exercise-transactions/txn-partial`);

    // Sem duplicata: ex-1 continua sendo UMA linha (a mesma, so atualizada), ex-2 e nova.
    expect(rawStore.size).toBe(2);
    expect(activityStore.size).toBe(2);
    expect(getConnection()?.openTransactionId).toBeNull();
  });

  it('preserva no raw campos sem equivalente canonico (ex.: training-load, detailed-sport-info)', async () => {
    const { service, rawStore, activityStore } = fixture(baseConnection({ registeredAt: new Date() }));
    const summary = {
      id: 'rich-payload',
      distance: 4000,
      duration: 'PT20M0S',
      'start-time': '2026-09-30T07:00:00Z',
      'training-load': 187.5,
      'detailed-sport-info': 'RUNNING_TRACK',
      'club-id': 42,
      device: 'Polar Pacer Pro',
    };
    const { fn } = queueFetch([
      jsonResponse(201, { 'transaction-id': 'txn-7' }),
      jsonResponse(200, { exercises: [EXERCISE_URL] }),
      jsonResponse(200, summary),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, {}),
    ]);
    global.fetch = fn as unknown as typeof fetch;
    await service.sync('user-a');

    expect(rawStore.get('polar|user-a|rich-payload')?.payload).toEqual(summary);
    const log = activityStore.get('polar|user-a|rich-payload')!;
    // Nenhum campo Polar vira coluna canonica solta no ActivityLog (nem trainingLoad, nem
    // detailedSportInfo) — o que e' estruturavel vai para dentro de providerMetrics, identificavel
    // pela coluna "provider" da propria linha; "training-load" (nao confundir com
    // "training-load-pro") nem isso tem, fica so no raw por falta de justificativa semantica clara.
    expect(log).not.toHaveProperty('trainingLoad');
    expect(log).not.toHaveProperty('detailedSportInfo');
    expect(log.sport).toBe('outra'); // sem "sport" no payload, nao da pra classificar -> fallback honesto
    expect(log.providerMetrics).toEqual({ device: 'Polar Pacer Pro', detailedSportInfo: 'RUNNING_TRACK' });
  });

  it('chave de dedup nao colide entre providers diferentes com o mesmo externalId', async () => {
    const { prisma, rawStore } = fixture(baseConnection({ registeredAt: new Date() }));
    await prisma.rawExternalActivity.upsert({
      where: { provider_userId_externalId: { provider: 'polar', userId: 'user-a', externalId: 'shared-id' } },
      create: { userId: 'user-a', provider: 'polar', externalId: 'shared-id', payload: { source: 'polar' } },
      update: { payload: { source: 'polar' } },
    });
    await prisma.rawExternalActivity.upsert({
      where: { provider_userId_externalId: { provider: 'strava', userId: 'user-a', externalId: 'shared-id' } },
      create: { userId: 'user-a', provider: 'strava', externalId: 'shared-id', payload: { source: 'strava' } },
      update: { payload: { source: 'strava' } },
    });
    expect(rawStore.size).toBe(2);
    expect(rawStore.get('polar|user-a|shared-id')?.payload).toEqual({ source: 'polar' });
    expect(rawStore.get('strava|user-a|shared-id')?.payload).toEqual({ source: 'strava' });
  });

  it('representa corretamente os 3 casos reais de producao (1 corrida + 2 treinos de forca) de ponta a ponta', async () => {
    const { service, activityStore } = fixture(baseConnection({ registeredAt: new Date() }));
    const corrida = {
      id: 'real-corrida',
      sport: 'RUNNING',
      duration: 'PT45M0S',
      distance: 8000,
      calories: 520,
      'start-time': '2026-10-01T10:00:00Z',
      'heart-rate': { average: 148, maximum: 171 },
      'training-load-pro': { ['muscle-load']: 1086.25, ['muscle-load-interpretation']: 'MEDIUM' },
    };
    const forca1 = {
      id: 'real-forca-1',
      sport: 'OTHER',
      ['detailed-sport-info']: 'STRENGTH_TRAINING',
      duration: 'PT50M0S',
      'start-time': '2026-10-01T18:00:00Z',
      ['training-load-pro']: { ['muscle-load']: -1, ['muscle-load-interpretation']: 'NOT_AVAILABLE' },
      ['perceived-load']: 0,
      ['perceived-load-interpretation']: 'NOT_AVAILABLE',
      ['user-rpe']: 'UNKNOWN',
    };
    const forca2 = {
      id: 'real-forca-2',
      sport: 'OTHER',
      ['detailed-sport-info']: 'STRENGTH_TRAINING',
      duration: 'PT40M0S',
      'start-time': '2026-10-01T19:00:00Z',
      ['training-load-pro']: { ['muscle-load']: -1, ['muscle-load-interpretation']: 'NOT_AVAILABLE' },
      ['perceived-load']: 0,
      ['perceived-load-interpretation']: 'NOT_AVAILABLE',
      ['user-rpe']: 'UNKNOWN',
    };
    const url2 = 'https://www.polaraccesslink.com/v3/users/999/exercise-transactions/txn-real/exercises/real-forca-1';
    const url3 = 'https://www.polaraccesslink.com/v3/users/999/exercise-transactions/txn-real/exercises/real-forca-2';
    const { fn } = queueFetch([
      jsonResponse(201, { 'transaction-id': 'txn-real' }),
      jsonResponse(200, { exercises: [EXERCISE_URL, url2, url3] }),
      jsonResponse(200, corrida),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, forca1),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, forca2),
      NO_SAMPLES_RESPONSE(),
      jsonResponse(200, {}),
    ]);
    global.fetch = fn as unknown as typeof fetch;

    const result = await service.sync('user-a');
    expect(result).toEqual({ status: 'synced', imported: 3, resumedTransaction: false });

    const logCorrida = activityStore.get('polar|user-a|real-corrida')!;
    expect(logCorrida.sport).toBe('corrida');
    expect(logCorrida.providerMetrics).toEqual({ muscleLoad: { value: 1086.25, interpretation: 'MEDIUM' } });

    for (const id of ['real-forca-1', 'real-forca-2']) {
      const log = activityStore.get(`polar|user-a|${id}`)!;
      expect(log.sport).toBe('forca'); // nunca "OTHER" bruto
      expect(log.providerMetrics).toEqual({
        detailedSportInfo: 'STRENGTH_TRAINING',
        muscleLoad: { value: null, interpretation: 'NOT_AVAILABLE' }, // nunca -1
        perceivedLoad: { value: null, interpretation: 'NOT_AVAILABLE' }, // nunca 0
        // userRpe ausente: 'UNKNOWN' nunca vira RPE zero nem qualquer numero
      });
      expect(log.providerMetrics).not.toHaveProperty('userRpe');
    }
  });

  it('nao importa nem depende de nada do modulo Strava', () => {
    // O mock de Prisma usado em todo este arquivo nao define stravaActivity/stravaConnection —
    // se qualquer teste acima passou, e porque o servico de ingestao Polar nunca tentou usá-los.
    // Aqui confirmamos tambem que nenhum import vem de ../strava/* (mencionar "Strava" em
    // comentario explicativo, como a nota sobre o bug de fuso do StravaService, e permitido).
    const src = readFileSync(join(__dirname, '../src/polar/polar-activity-ingestion.service.ts'), 'utf8');
    const importLines = src.split('\n').filter((line) => line.trim().startsWith('import '));
    expect(importLines.some((line) => line.includes('/strava/'))).toBe(false);
  });

  // Ingestao de samples (02/10/2026) — serie temporal preservada como RawActivitySample, camada
  // RAW (nunca interpretada aqui). A estrutura REAL da listagem de "available samples" da Polar
  // nao esta confirmada por chamada real ainda (ver relatorio da investigacao) — os formatos de
  // entrada usados aqui cobrem os dois formatos mais plausiveis pelos docs publicos (string=URL
  // direta, objeto com sample-type+href), nao sao um contrato fixo da Polar.
  describe('ingestao de samples', () => {
    it('1. atividade com tipos de samples disponiveis: cada tipo listado e buscado e preservado', async () => {
      const { service, sampleStore } = fixture(baseConnection({ registeredAt: new Date() }));
      const summary = { id: 'with-samples', distance: 5000, duration: 'PT25M0S', 'start-time': '2026-09-30T07:00:00Z' };
      const heartRateSeries = { ['heart-rate-samples']: [{ offsetMillis: 0, heartRate: 120 }, { offsetMillis: 1000, heartRate: 125 }] };
      const speedSeries = [1.5, 1.6, 1.7]; // formato bruto desconhecido tambem e' preservado como veio
      const { fn } = queueFetch([
        jsonResponse(201, { 'transaction-id': 'txn-s1' }),
        jsonResponse(200, { exercises: [EXERCISE_URL] }),
        jsonResponse(200, summary),
        // listagem de samples: um tipo via objeto (href a buscar depois), um via URL direta.
        jsonResponse(200, {
          samples: [
            { ['sample-type']: 'heart-rate', href: `${EXERCISE_URL}/samples/heart-rate` },
            `${EXERCISE_URL}/samples/speed`,
          ],
        }),
        jsonResponse(200, heartRateSeries), // busca do tipo heart-rate
        jsonResponse(200, speedSeries), // busca do tipo speed (via URL)
        jsonResponse(200, {}), // commit
      ]);
      global.fetch = fn as unknown as typeof fetch;

      const result = await service.sync('user-a');
      expect(result).toEqual({ status: 'synced', imported: 1, resumedTransaction: false });

      expect(sampleStore.size).toBe(2);
      const hr = [...sampleStore.values()].find((s) => s.sampleType === 'heart-rate');
      expect(hr?.payload).toEqual(heartRateSeries);
      const speed = [...sampleStore.values()].find((s) => s.sampleType === 'speed');
      expect(speed?.payload).toEqual(speedSeries);
    });

    it('2. atividade sem determinado tipo: so os tipos realmente listados sao buscados/preservados, nenhum fabricado', async () => {
      const { service, sampleStore } = fixture(baseConnection({ registeredAt: new Date() }));
      const summary = { id: 'partial-samples', distance: 3000, duration: 'PT15M0S', 'start-time': '2026-09-30T07:00:00Z' };
      const { fn } = queueFetch([
        jsonResponse(201, { 'transaction-id': 'txn-s2' }),
        jsonResponse(200, { exercises: [EXERCISE_URL] }),
        jsonResponse(200, summary),
        // So' heart-rate disponivel pra esta atividade — sem cadencia, potencia, GPS etc.
        jsonResponse(200, { samples: [{ ['sample-type']: 'heart-rate', href: `${EXERCISE_URL}/samples/heart-rate` }] }),
        jsonResponse(200, { ['heart-rate-samples']: [{ offsetMillis: 0, heartRate: 140 }] }),
        jsonResponse(200, {}),
      ]);
      global.fetch = fn as unknown as typeof fetch;

      await service.sync('user-a');

      expect(sampleStore.size).toBe(1);
      expect([...sampleStore.values()][0].sampleType).toBe('heart-rate');
      // Nenhuma entrada fabricada pra cadencia/potencia/altitude/gps so' porque a coluna existe.
      expect([...sampleStore.values()].some((s) => s.sampleType === 'cadence')).toBe(false);
    });

    it('3. tipo de sample desconhecido/formato inesperado e preservado sem quebrar a ingestao', async () => {
      const { service, sampleStore, activityStore } = fixture(baseConnection({ registeredAt: new Date() }));
      const summary = { id: 'weird-sample-type', distance: 3000, duration: 'PT15M0S', 'start-time': '2026-09-30T07:00:00Z' };
      const { fn } = queueFetch([
        jsonResponse(201, { 'transaction-id': 'txn-s3' }),
        jsonResponse(200, { exercises: [EXERCISE_URL] }),
        jsonResponse(200, summary),
        // Entrada sem nenhum campo reconhecivel de tipo (nem sample-type, nem type, nem string-URL).
        jsonResponse(200, { samples: [{ ['algum-campo-novo-da-polar']: 'xyz', ['pontos']: [1, 2, 3] }] }),
        jsonResponse(200, {}),
      ]);
      global.fetch = fn as unknown as typeof fetch;

      const result = await service.sync('user-a');

      // Ingestao do exercicio continua bem-sucedida apesar do tipo de sample nao reconhecido.
      expect(result).toEqual({ status: 'synced', imported: 1, resumedTransaction: false });
      expect(activityStore.get('polar|user-a|weird-sample-type')).toBeDefined();
      expect(sampleStore.size).toBe(1);
      expect([...sampleStore.values()][0].sampleType).toBe('unknown');
    });

    it('4. nova sincronizacao da mesma atividade nao duplica samples (upsert pela chave atividade+provider+tipo)', async () => {
      const summary = { id: 'resync-samples', distance: 4000, duration: 'PT20M0S', 'start-time': '2026-09-30T07:00:00Z' };
      const listResponse = () => jsonResponse(200, { samples: [{ ['sample-type']: 'heart-rate', href: `${EXERCISE_URL}/samples/heart-rate` }] });
      const hrResponse = (avg: number) => jsonResponse(200, { ['heart-rate-samples']: [{ offsetMillis: 0, heartRate: avg }] });

      const conn = baseConnection({ registeredAt: new Date() });
      const { service, sampleStore } = fixture(conn);

      const { fn: fn1 } = queueFetch([
        jsonResponse(201, { 'transaction-id': 'txn-s4a' }),
        jsonResponse(200, { exercises: [EXERCISE_URL] }),
        jsonResponse(200, summary),
        listResponse(),
        hrResponse(130),
        jsonResponse(200, {}),
      ]);
      global.fetch = fn1 as unknown as typeof fetch;
      await service.sync('user-a');
      expect(sampleStore.size).toBe(1);

      // Resincronizacao da MESMA atividade (ex.: Polar reenviando, ou retry manual) — upsert deve
      // atualizar a mesma linha, nunca criar uma segunda.
      const { fn: fn2 } = queueFetch([
        jsonResponse(201, { 'transaction-id': 'txn-s4b' }),
        jsonResponse(200, { exercises: [EXERCISE_URL] }),
        jsonResponse(200, summary),
        listResponse(),
        hrResponse(135), // valor atualizado
        jsonResponse(200, {}),
      ]);
      global.fetch = fn2 as unknown as typeof fetch;
      await service.sync('user-a');

      expect(sampleStore.size).toBe(1);
      const stored = [...sampleStore.values()][0];
      expect((stored.payload as { ['heart-rate-samples']: Array<{ heartRate: number }> })['heart-rate-samples'][0].heartRate).toBe(135);
    });

    it('5. falha ao listar/buscar samples NAO destroi a ActivityLog cujo resumo ja foi importado com sucesso', async () => {
      const { service, activityStore, rawStore, sampleStore, getConnection } = fixture(baseConnection({ registeredAt: new Date() }));
      const summary = { id: 'samples-fail', distance: 6000, duration: 'PT30M0S', 'start-time': '2026-09-30T07:00:00Z' };
      const { fn } = queueFetch([
        jsonResponse(201, { 'transaction-id': 'txn-s5' }),
        jsonResponse(200, { exercises: [EXERCISE_URL] }),
        jsonResponse(200, summary),
        jsonResponse(500, { error: 'internal' }), // listagem de samples falha
        jsonResponse(200, {}), // commit — precisa acontecer normalmente mesmo assim
      ]);
      global.fetch = fn as unknown as typeof fetch;

      const result = await service.sync('user-a');

      // sync() inteiro teve SUCESSO — falha de samples nunca propaga como falha de exercicio.
      expect(result).toEqual({ status: 'synced', imported: 1, resumedTransaction: false });
      expect(activityStore.get('polar|user-a|samples-fail')).toBeDefined();
      expect(rawStore.get('polar|user-a|samples-fail')).toBeDefined();
      expect(sampleStore.size).toBe(0);
      expect(getConnection()?.openTransactionId).toBeNull(); // transaction commitada normalmente
    });
  });

  describe('aciona o Motor de Reconciliacao apos ingestao (03/10/2026)', () => {
    it('chama classify() com o id da ActivityLog recem-importada', async () => {
      const { service, sessionExecutionLinkService, activityStore } = fixture(baseConnection({ registeredAt: new Date() }));
      const summary = { id: 'reconcile-1', distance: 30076, duration: 'PT2H36M6.952S', 'start-time': '2026-10-03T04:58:04Z' };
      const { fn } = queueFetch([
        jsonResponse(201, { 'transaction-id': 'txn-r1' }),
        jsonResponse(200, { exercises: [EXERCISE_URL] }),
        jsonResponse(200, summary),
        NO_SAMPLES_RESPONSE(),
        jsonResponse(200, {}),
      ]);
      global.fetch = fn as unknown as typeof fetch;

      await service.sync('user-a');

      const activityLog = activityStore.get('polar|user-a|reconcile-1');
      expect(sessionExecutionLinkService.classify).toHaveBeenCalledWith(activityLog?.id);
    });

    it('falha no Motor de Reconciliacao nunca derruba a sincronizacao (mesma resiliencia das samples/serie temporal)', async () => {
      const { prisma, activityStore } = fixture(baseConnection({ registeredAt: new Date() }));
      const summary = { id: 'reconcile-fail', distance: 5000, duration: 'PT25M0S', 'start-time': '2026-10-03T07:00:00Z' };
      const { fn } = queueFetch([
        jsonResponse(201, { 'transaction-id': 'txn-r2' }),
        jsonResponse(200, { exercises: [EXERCISE_URL] }),
        jsonResponse(200, summary),
        NO_SAMPLES_RESPONSE(),
        jsonResponse(200, {}),
      ]);
      global.fetch = fn as unknown as typeof fetch;

      const polarService = { decryptAccessToken: jest.fn(() => 'plain-access-token') };
      const timeSeriesService = { normalizeFromRawSamples: jest.fn(async () => undefined) };
      const failingSessionExecutionLink = { classify: jest.fn(async () => { throw new Error('falha simulada no motor'); }) };
      const serviceWithFailingClassify = new PolarActivityIngestionService(
        prisma as unknown as PrismaService,
        polarService as unknown as PolarService,
        timeSeriesService as never,
        failingSessionExecutionLink as never,
      );

      const result = await serviceWithFailingClassify.sync('user-a');

      expect(result).toEqual({ status: 'synced', imported: 1, resumedTransaction: false });
      expect(activityStore.get('polar|user-a|reconcile-fail')).toBeDefined();
      expect(failingSessionExecutionLink.classify).toHaveBeenCalled();
    });
  });

  describe('trava por usuario entre gatilhos (webhook/polling/manual) — 03/10/2026', () => {
    it('dois sync() simultaneos do mesmo aluno: o segundo nao abre/retoma transaction e informa in_progress', async () => {
      const { service } = fixture(baseConnection({ registeredAt: new Date() }));
      const summary = { id: 'inflight-1', distance: 5000, duration: 'PT25M0S', 'start-time': '2026-10-03T07:00:00Z' };
      const { fn, calls } = queueFetch([
        jsonResponse(201, { 'transaction-id': 'txn-f1' }),
        jsonResponse(200, { exercises: [EXERCISE_URL] }),
        jsonResponse(200, summary),
        NO_SAMPLES_RESPONSE(),
        jsonResponse(200, {}),
      ]);
      global.fetch = fn as unknown as typeof fetch;

      const [first, second] = await Promise.all([service.sync('user-a'), service.sync('user-a')]);

      expect(second).toEqual({ status: 'in_progress', imported: 0, resumedTransaction: false });
      expect(first.status).toBe('synced');
      expect(calls.filter((c) => c.startsWith('POST') && c.includes('exercise-transactions')).length).toBe(1);
    });

    it('apos a primeira sincronizacao terminar, uma nova chamada volta a funcionar normalmente (trava liberada)', async () => {
      const { service } = fixture(baseConnection({ registeredAt: new Date() }));
      const { fn } = queueFetch([
        jsonResponse(204, {}), // nenhuma atividade nova
        jsonResponse(204, {}),
      ]);
      global.fetch = fn as unknown as typeof fetch;

      const first = await service.sync('user-a');
      const second = await service.sync('user-a');

      expect(first.status).toBe('no_new_data');
      expect(second.status).toBe('no_new_data');
    });
  });
});
