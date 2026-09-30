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
  let conn = connection;
  let rawSeq = 0;
  let logSeq = 0;

  const keyOf = (where: { provider_userId_externalId: { provider: string; userId: string; externalId: string } }) => {
    const k = where.provider_userId_externalId;
    return `${k.provider}|${k.userId}|${k.externalId}`;
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
  };

  const polarService = { decryptAccessToken: jest.fn(() => 'plain-access-token') };
  const service = new PolarActivityIngestionService(
    prisma as unknown as PrismaService,
    polarService as unknown as PolarService,
  );

  return { service, prisma, rawStore, activityStore, getConnection: () => conn };
}

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
      sport: 'RUNNING',
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
      jsonResponse(200, evening),
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
      jsonResponse(200, {}),
    ]);
    global.fetch = fn as unknown as typeof fetch;
    await service.sync('user-a');
    const log = activityStore.get('polar|user-a|no-hr');
    expect(log?.avgHeartRateBpm).toBeNull();
    expect(log?.maxHeartRateBpm).toBeNull();
  });

  it('campos opcionais ausentes (distancia, duracao, calorias, esporte) ficam null, nunca zero/undefined silencioso', async () => {
    const { service, activityStore } = fixture(baseConnection({ registeredAt: new Date() }));
    const summary = { id: 'bare-minimum', 'start-time': '2026-09-30T07:00:00Z' };
    const { fn } = queueFetch([
      jsonResponse(201, { 'transaction-id': 'txn-5' }),
      jsonResponse(200, { exercises: [EXERCISE_URL] }),
      jsonResponse(200, summary),
      jsonResponse(200, {}),
    ]);
    global.fetch = fn as unknown as typeof fetch;
    await service.sync('user-a');
    const log = activityStore.get('polar|user-a|bare-minimum');
    expect(log).toMatchObject({
      distanceMeters: null, durationSec: null, caloriesKcal: null, sport: null,
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
      jsonResponse(200, ex2),
      jsonResponse(200, {}), // commit
    ]);
    global.fetch = fetchRetry as unknown as typeof fetch;

    const retryResult = await service.sync('user-a');
    expect(retryResult).toEqual({ status: 'synced', imported: 2, resumedTransaction: true });
    // Retomou a MESMA transaction: a 1a chamada do retry e a listagem (GET), nao uma abertura
    // (POST) de nova transaction — confirmado tambem pelo fato de so 4 respostas terem sido
    // enfileiradas (sem uma de abertura) e o sync ainda assim ter tido sucesso.
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
      jsonResponse(200, {}),
    ]);
    global.fetch = fn as unknown as typeof fetch;
    await service.sync('user-a');

    expect(rawStore.get('polar|user-a|rich-payload')?.payload).toEqual(summary);
    const log = activityStore.get('polar|user-a|rich-payload')!;
    expect(log).not.toHaveProperty('trainingLoad');
    expect(log).not.toHaveProperty('detailedSportInfo');
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

  it('nao importa nem depende de nada do modulo Strava', () => {
    // O mock de Prisma usado em todo este arquivo nao define stravaActivity/stravaConnection —
    // se qualquer teste acima passou, e porque o servico de ingestao Polar nunca tentou usá-los.
    // Aqui confirmamos tambem que nenhum import vem de ../strava/* (mencionar "Strava" em
    // comentario explicativo, como a nota sobre o bug de fuso do StravaService, e permitido).
    const src = readFileSync(join(__dirname, '../src/polar/polar-activity-ingestion.service.ts'), 'utf8');
    const importLines = src.split('\n').filter((line) => line.trim().startsWith('import '));
    expect(importLines.some((line) => line.includes('/strava/'))).toBe(false);
  });
});
