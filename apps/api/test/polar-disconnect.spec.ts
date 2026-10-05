import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PolarService } from '../src/polar/polar.service';
import { PolarActivityIngestionService } from '../src/polar/polar-activity-ingestion.service';
import { PolarWebhookService } from '../src/polar/polar-webhook.service';
import { PolarSyncFallbackSchedulerService } from '../src/polar/polar-sync-fallback-scheduler.service';
import { ProviderDataDeletionService, classifyMaterializedCompletion } from '../src/activity-execution/provider-data-deletion.service';

// Bloco pre-Garmin 1 (04/10/2026): desconexao, revogacao de coleta e exclusao de dados de provider.
// O "banco" abaixo e' um armazenamento em memoria com a semantica que importa (where simples,
// FOR SHARE modelado como "so' prossegue com conexao ativa"). NAO prova isolamento transacional real
// do Postgres: prova que o codigo consulta o estado canonico antes de cada escrita e aborta quando
// ele esta revogado.

type Row = Record<string, any>;
const TABLES = [
  'rawExternalActivity', 'activityLog', 'rawActivitySample', 'activityTimeSeriesPoint', 'sessionExecutionLink',
  'trainingSession', 'workoutCompletion', 'userNotification', 'providerConnectionEvent',
] as const;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key] ?? null;
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(value);
      if ('startsWith' in cond) return typeof value === 'string' && value.startsWith(cond.startsWith);
    }
    return value === (cond ?? null);
  });
}

function world() {
  const db: Record<string, Row[]> = Object.fromEntries(TABLES.map((t) => [t, []]));
  const conns = new Map<string, Row>();
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;

  const generic = (name: string) => ({
    findMany: async ({ where, include }: { where?: Row; include?: Row } = {}) => db[name].filter((r) => matches(r, where)).map((r) => {
      if (name === 'trainingSession' && include?.completion) {
        const completion = db.workoutCompletion.find((c) => c.sessionId === r.id) ?? null;
        return { ...r, completion: completion ? { ...completion, shoeUsage: completion.shoeUsage ?? null } : null };
      }
      return r;
    }),
    deleteMany: async ({ where }: { where: Row }) => {
      const before = db[name].length;
      db[name] = db[name].filter((r) => !matches(r, where));
      return { count: before - db[name].length };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = db[name].filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    create: async ({ data }: { data: Row }) => { const row = { id: id(name), ...data }; db[name].push(row); return row; },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row = db[name].find((r) => r.id === where.id)!; return Object.assign(row, data); },
  });

  const prisma: Record<string, any> = {
    polarConnection: {
      findUnique: async ({ where }: { where: { userId?: string; polarUserId?: string } }) => { const c = where.userId ? conns.get(where.userId) : [...conns.values()].find((x) => x.polarUserId === where.polarUserId); return c ? { ...c } : null; },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const c = conns.get(where.userId);
        if (!c || !matches(c, where)) return { count: 0 };
        Object.assign(c, data);
        return { count: 1 };
      },
      findMany: jest.fn(async ({ where }: { where: Row }) => [...conns.values()].filter((c) => (where.disconnectedAt === null ? !c.disconnectedAt : true))),
      upsert: async ({ where, create, update }: { where: { userId: string }; create: Row; update: Row }) => {
        const c = conns.get(where.userId);
        if (c) Object.assign(c, update); else conns.set(where.userId, { id: id('conn'), createdAt: new Date(), registeredAt: null, openTransactionId: null, lastSyncCompletedAt: null, disconnectedAt: null, ...create });
      },
    },
    // Mesma semantica do SELECT ... FOR SHARE: sem conexao ativa, nenhuma linha.
    $queryRaw: async (_strings: unknown, userId: string) => {
      const c = conns.get(userId);
      return c && !c.disconnectedAt ? [{ id: c.id }] : [];
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma),
    rawExternalActivity: {
      ...generic('rawExternalActivity'),
      upsert: async ({ where, create, update }: { where: { provider_userId_externalId: Row }; create: Row; update: Row }) => {
        const k = where.provider_userId_externalId;
        const found = db.rawExternalActivity.find((r) => r.provider === k.provider && r.userId === k.userId && r.externalId === k.externalId);
        if (found) return Object.assign(found, update);
        const row = { id: id('raw'), ...create }; db.rawExternalActivity.push(row); return row;
      },
    },
    activityLog: {
      ...generic('activityLog'),
      upsert: async ({ where, create, update }: { where: { provider_userId_externalId: Row }; create: Row; update: Row }) => {
        const k = where.provider_userId_externalId;
        const found = db.activityLog.find((r) => r.provider === k.provider && r.userId === k.userId && r.externalId === k.externalId);
        if (found) return Object.assign(found, update);
        const row = { id: id('log'), ...create }; db.activityLog.push(row); return row;
      },
    },
    rawActivitySample: {
      ...generic('rawActivitySample'),
      upsert: async ({ where, create, update }: { where: { activityLogId_provider_sampleType: Row }; create: Row; update: Row }) => {
        const k = where.activityLogId_provider_sampleType;
        const found = db.rawActivitySample.find((r) => r.activityLogId === k.activityLogId && r.sampleType === k.sampleType);
        if (found) return Object.assign(found, update);
        const row = { id: id('sample'), ...create }; db.rawActivitySample.push(row); return row;
      },
    },
    activityTimeSeriesPoint: generic('activityTimeSeriesPoint'),
    sessionExecutionLink: generic('sessionExecutionLink'),
    trainingSession: generic('trainingSession'),
    workoutCompletion: generic('workoutCompletion'),
    userNotification: generic('userNotification'),
    providerConnectionEvent: generic('providerConnectionEvent'),
  };

  const config = {
    get: (name: string) => ({
      POLAR_CLIENT_ID: 'cid', POLAR_CLIENT_SECRET: 'sec',
      POLAR_REDIRECT_URI: 'https://api.example.com/polar/callback', POLAR_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
    } as Record<string, string>)[name],
  };
  const deletion = new ProviderDataDeletionService(prisma as never);
  const polar = new PolarService(prisma as never, config as never, deletion);
  const timeSeries = { normalizeFromRawSamples: jest.fn(async () => undefined) };
  const link = { classify: jest.fn(async () => 'alternative') };
  const notifications = { notifyReconciliation: jest.fn(async () => true) };
  const ingestion = new PolarActivityIngestionService(prisma as never, polar, timeSeries as never, link as never, notifications as never);

  const connect = (userId: string, polarUserId: string) => {
    conns.set(userId, {
      id: id('conn'), userId, polarUserId, accessTokenEncrypted: polar.encryptSecret(`token-${userId}`),
      registeredAt: new Date(), openTransactionId: null, openTransactionOpenedAt: null, lastSyncCompletedAt: null,
      disconnectedAt: null, createdAt: new Date('2026-09-01T00:00:00Z'),
    });
  };
  return { db, conns, prisma, polar, ingestion, deletion, connect, timeSeries, link, notifications, config };
}

function res(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}

const SUMMARY = (externalId: number) => ({
  id: externalId, sport: 'RUNNING', duration: 'PT30M', distance: 5000,
  'start-time': '2026-10-01T07:00:00Z', 'start-time-utc-offset': 0,
});
const EX_URL = (n: number) => `https://www.polaraccesslink.com/v3/users/999/exercise-transactions/t1/exercises/${n}`;

describe('desconexao de provider (Polar)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

  it('1. usuario conectado desconecta: token descartado, momento registrado, Polar desregistrada, auditoria gravada', async () => {
    const w = world(); w.connect('user-a', '999');
    const fetchMock = jest.fn(async () => res(204));
    global.fetch = fetchMock as never;

    const result = await w.polar.disconnect('user-a');

    expect(result).toEqual({ status: 'disconnected', providerRevocation: 'revoked' });
    const conn = w.conns.get('user-a')!;
    expect(conn.disconnectedAt).toBeInstanceOf(Date);
    expect(conn.accessTokenEncrypted).toBeNull();
    expect(conn.openTransactionId).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.polaraccesslink.com/v3/users/999');
    expect(init.method).toBe('DELETE');
    expect(String((init.headers as Record<string, string>).Authorization)).toBe('Bearer token-user-a');
    expect(w.db.providerConnectionEvent).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('token-user-a');
    expect(JSON.stringify(w.db.providerConnectionEvent)).not.toContain('token-user-a');
    await expect(w.polar.status('user-a')).resolves.toMatchObject({ connected: false, connectedAt: null });
  });

  it('2. usuario nao desconecta a conexao de outro (so o proprio id do JWT; nao ha userId do cliente)', async () => {
    const w = world(); w.connect('user-a', '999'); w.connect('user-b', '888');
    global.fetch = jest.fn(async () => res(204)) as never;

    const result = await w.polar.disconnect('user-c'); // sem conexao propria
    expect(result.status).toBe('not_connected');
    expect(w.conns.get('user-a')!.disconnectedAt).toBeNull();
    expect(w.conns.get('user-b')!.disconnectedAt).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();

    await w.polar.disconnect('user-b');
    expect(w.conns.get('user-a')!.disconnectedAt).toBeNull(); // a de A segue intacta
    expect(w.conns.get('user-a')!.accessTokenEncrypted).not.toBeNull();
  });

  it('3. desconectar duas vezes e seguro e nao repete a chamada a Polar', async () => {
    const w = world(); w.connect('user-a', '999');
    const fetchMock = jest.fn(async () => res(204));
    global.fetch = fetchMock as never;
    await w.polar.disconnect('user-a');
    const firstAt = w.conns.get('user-a')!.disconnectedAt;

    const again = await w.polar.disconnect('user-a');

    expect(again.status).toBe('already_disconnected');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(w.conns.get('user-a')!.disconnectedAt).toBe(firstAt);
    expect(w.db.providerConnectionEvent).toHaveLength(1);
  });

  it('falha da Polar nao impede a revogacao local (coleta para mesmo assim e o resultado e honesto)', async () => {
    const w = world(); w.connect('user-a', '999');
    global.fetch = jest.fn(async () => { throw new Error('rede'); }) as never;
    const result = await w.polar.disconnect('user-a');
    expect(result).toEqual({ status: 'disconnected', providerRevocation: 'failed' });
    expect(w.conns.get('user-a')!.disconnectedAt).toBeInstanceOf(Date);
  });

  it('4. sync manual apos desconexao nao importa atividade nem chama a Polar', async () => {
    const w = world(); w.connect('user-a', '999');
    global.fetch = jest.fn(async () => res(204)) as never;
    await w.polar.disconnect('user-a');
    const fetchMock = jest.fn(async () => res(201, { 'transaction-id': 't1' }));
    global.fetch = fetchMock as never;

    await expect(w.ingestion.sync('user-a')).rejects.toBeInstanceOf(ConflictException);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(w.db.rawExternalActivity).toHaveLength(0);
    expect(w.db.activityLog).toHaveLength(0);
  });

  it('5. polling apos desconexao: o agendador nem seleciona a conexao e, se chamado, o sync recusa', async () => {
    const w = world(); w.connect('user-a', '999'); w.connect('user-b', '888');
    global.fetch = jest.fn(async () => res(204)) as never;
    await w.polar.disconnect('user-a');
    const sync = jest.fn(async () => ({ status: 'synced', imported: 0, resumedTransaction: false }));
    const scheduler = new PolarSyncFallbackSchedulerService(w.prisma as never, { sync } as never);

    await scheduler.syncStaleConnections(new Date());

    const where = (w.prisma.polarConnection.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.disconnectedAt).toBeNull();
    expect(sync.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['user-b']);
  });

  it('6. webhook atrasado apos a desconexao nao dispara sync e nada e persistido', async () => {
    const w = world(); w.connect('user-a', '999');
    global.fetch = jest.fn(async () => res(204)) as never;
    await w.polar.disconnect('user-a');
    const sync = jest.fn(async () => ({ status: 'synced', imported: 1, resumedTransaction: false }));
    const webhook = new PolarWebhookService(w.prisma as never, w.polar, { sync } as never);

    await webhook.handleEvent({ event: 'EXERCISE', user_id: 999 }); // polarUserId preservado: evento e identificado e descartado

    expect(sync).not.toHaveBeenCalled();
    expect(w.db.rawExternalActivity).toHaveLength(0);
  });

  it('7. retry atrasado do webhook nao reativa coleta: o timer dispara depois da revogacao e o sync recusa', async () => {
    jest.useFakeTimers();
    const w = world(); w.connect('user-a', '999');
    // 1o sync devolve in_progress -> agenda UMA retentativa em 60s (comportamento existente).
    const sync = jest.fn()
      .mockResolvedValueOnce({ status: 'in_progress', imported: 0, resumedTransaction: false })
      .mockImplementation((userId: string) => w.ingestion.sync(userId));
    const webhook = new PolarWebhookService(w.prisma as never, w.polar, { sync } as never);
    await webhook.handleEvent({ event: 'EXERCISE', user_id: 999 });

    global.fetch = jest.fn(async () => res(204)) as never;
    await w.polar.disconnect('user-a'); // revoga ANTES do timer
    const afterRevoke = jest.fn(async () => res(201, { 'transaction-id': 't1' }));
    global.fetch = afterRevoke as never;
    await jest.advanceTimersByTimeAsync(61_000);

    expect(sync).toHaveBeenCalledTimes(2);
    expect(afterRevoke).not.toHaveBeenCalled();
    expect(w.db.activityLog).toHaveLength(0);
    expect(w.conns.get('user-a')!.disconnectedAt).toBeInstanceOf(Date);
  });

  it('8. reconectar exige nova autorizacao valida; so entao a coleta volta, com estado limpo', async () => {
    const w = world(); w.connect('user-a', '999');
    global.fetch = jest.fn(async () => res(204)) as never;
    await w.polar.disconnect('user-a');
    await expect(w.ingestion.sync('user-a')).rejects.toBeInstanceOf(ConflictException);

    // Nova autorizacao: state + code -> token novo (mesmo fluxo OAuth de sempre).
    const attempts = new Map<string, Row>();
    w.prisma.user = { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id }) };
    w.prisma.polarOAuthAttempt = {
      create: async ({ data }: { data: Row }) => { attempts.set(data.stateHash, { ...data, consumedAt: null }); },
      updateMany: async ({ where }: { where: Row }) => { const a = attempts.get(where.stateHash); if (!a || a.consumedAt) return { count: 0 }; a.consumedAt = new Date(); return { count: 1 }; },
      findUnique: async ({ where }: { where: Row }) => attempts.get(where.stateHash) ?? null,
    };
    const state = new URL((await w.polar.connectUrl('user-a')).url).searchParams.get('state')!;
    expect(attempts.has(createHash('sha256').update(state).digest('hex'))).toBe(true);
    global.fetch = jest.fn(async () => res(200, { access_token: 'novo-token', token_type: 'bearer', x_user_id: 999 })) as never;

    expect(await w.polar.callback({ state, code: 'c' })).toBe('connected');

    const conn = w.conns.get('user-a')!;
    expect(conn.disconnectedAt).toBeNull();
    expect(conn.registeredAt).toBeNull(); // o registro anterior pertencia ao token revogado
    expect(conn.accessTokenEncrypted).toMatch(/^v1:/);
    await expect(w.polar.status('user-a')).resolves.toMatchObject({ connected: true });
  });

  it('9. desconectar NAO apaga historico (raw, canonico, samples, series, vinculos permanecem)', async () => {
    const w = world(); w.connect('user-a', '999');
    seedHistory(w, 'user-a', 'polar', 'e1');
    global.fetch = jest.fn(async () => res(204)) as never;

    await w.polar.disconnect('user-a');

    expect(w.db.rawExternalActivity).toHaveLength(1);
    expect(w.db.activityLog).toHaveLength(1);
    expect(w.db.rawActivitySample).toHaveLength(1);
    expect(w.db.activityTimeSeriesPoint).toHaveLength(1);
    expect(w.db.sessionExecutionLink).toHaveLength(1);
  });

  it('14a. race: desconexao ocorre ENQUANTO o sync busca o exercicio — nada e persistido e a transaction nao e confirmada', async () => {
    const w = world(); w.connect('user-a', '999');
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/exercise-transactions') && init?.method === 'POST') return res(201, { 'transaction-id': 't1' });
      if (url.endsWith('/exercise-transactions/t1') && !init?.method) return res(200, { exercises: [EX_URL(1)] });
      if (url === EX_URL(1)) {
        // O aluno desconecta exatamente aqui, com o sync ja em andamento (token ja em memoria).
        await w.polar.disconnect('user-a'); // desconexao REAL (DELETE na Polar cai no 404 abaixo)
        return res(200, SUMMARY(1));
      }
      return res(404);
    }) as never;

    const result = await w.ingestion.sync('user-a');

    expect(result.status).toBe('disconnected');
    expect(w.db.rawExternalActivity).toHaveLength(0);
    expect(w.db.activityLog).toHaveLength(0);
    expect(calls.some((c) => c.startsWith('PUT '))).toBe(false); // sem commit da transaction
    expect(w.conns.get('user-a')!.openTransactionId).toBeNull(); // estado nao e' ressuscitado
    expect(w.conns.get('user-a')!.lastSyncCompletedAt).toBeNull();
    expect(w.timeSeries.normalizeFromRawSamples).not.toHaveBeenCalled();
    expect(w.link.classify).not.toHaveBeenCalled();
  });

  it('14b. race: desconexao durante samples — a atividade ja gravada antes da revogacao fica, nenhum sample novo entra', async () => {
    const w = world(); w.connect('user-a', '999');
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/exercise-transactions') && init?.method === 'POST') return res(201, { 'transaction-id': 't1' });
      if (url.endsWith('/exercise-transactions/t1') && !init?.method) return res(200, { exercises: [EX_URL(1)] });
      if (url === EX_URL(1)) return res(200, SUMMARY(1));
      if (url === `${EX_URL(1)}/samples`) {
        await w.polar.disconnect('user-a'); // desconexao REAL (DELETE na Polar cai no 404 abaixo)
        return res(200, { samples: [`${EX_URL(1)}/samples/0`] });
      }
      if (url.endsWith('/samples/0')) return res(200, { data: '1,2,3' });
      return res(404);
    }) as never;

    const result = await w.ingestion.sync('user-a');

    expect(result.status).toBe('disconnected');
    expect(w.db.activityLog).toHaveLength(1); // coletado enquanto autorizado
    expect(w.db.rawActivitySample).toHaveLength(0);
    expect(w.link.classify).not.toHaveBeenCalled();
  });
});

const STARTED_AT = new Date('2026-10-01T07:15:30Z');

function seedHistory(w: ReturnType<typeof world>, userId: string, provider: string, externalId: string) {
  const raw = { id: `raw-${userId}-${provider}-${externalId}`, userId, provider, externalId, payload: {} };
  const log = { id: `log-${userId}-${provider}-${externalId}`, userId, provider, externalId, rawActivityId: raw.id, executionClassification: 'corresponding', startedAt: STARTED_AT, distanceMeters: 5230, durationSec: 1815, avgHeartRateBpm: 152, maxHeartRateBpm: 178 };
  w.db.rawExternalActivity.push(raw);
  w.db.activityLog.push(log);
  w.db.rawActivitySample.push({ id: `s-${log.id}`, activityLogId: log.id, provider, sampleType: '0' });
  w.db.activityTimeSeriesPoint.push({ id: `p-${log.id}`, activityLogId: log.id, provider });
  w.db.sessionExecutionLink.push({ id: `l-${log.id}`, userId, activityLogId: log.id, trainingSessionId: `prescribed-${userId}`, status: 'active', supersededByLinkId: null });
  return { raw, log };
}

describe('exclusao dos dados de um provider (userId + provider)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('10/11. nao afeta outro usuario nem outro provider do mesmo usuario', async () => {
    const w = world();
    seedHistory(w, 'user-a', 'polar', 'e1');
    seedHistory(w, 'user-a', 'strava', 'e1'); // mesmo externalId, outro provider
    seedHistory(w, 'user-b', 'polar', 'e1'); // mesmo externalId, outro usuario

    const result = await w.deletion.deleteProviderData('user-a', 'polar');

    expect(result).toMatchObject({ provider: 'polar', activities: 1, rawActivities: 1, samples: 1, timeSeriesPoints: 1, executionLinks: 1 });
    expect(w.db.activityLog.map((l) => `${l.userId}|${l.provider}`).sort()).toEqual(['user-a|strava', 'user-b|polar']);
    expect(w.db.rawExternalActivity.map((l) => `${l.userId}|${l.provider}`).sort()).toEqual(['user-a|strava', 'user-b|polar']);
    expect(w.db.rawActivitySample).toHaveLength(2);
    expect(w.db.activityTimeSeriesPoint).toHaveLength(2);
    expect(w.db.sessionExecutionLink).toHaveLength(2);
  });

  it('12. trata raw, canonico, samples, series, vinculos (inclusive cadeia de substituicao) e notificacoes derivadas', async () => {
    const w = world();
    const a = seedHistory(w, 'user-a', 'polar', 'e1');
    const b = seedHistory(w, 'user-a', 'strava', 'e2');
    // Vinculo da atividade Strava foi revogado e substituido pelo vinculo da atividade Polar:
    // apagar o vinculo Polar nao pode violar a FK do vinculo Strava.
    w.db.sessionExecutionLink.find((l) => l.activityLogId === b.log.id)!.supersededByLinkId = `l-${a.log.id}`;
    w.db.userNotification.push(
      { id: 'n1', userId: 'user-a', externalRef: `activity-reconciled:${a.log.id}:alternative` },
      { id: 'n2', userId: 'user-a', externalRef: `activity-reconciled:${b.log.id}:alternative` },
      { id: 'n3', userId: 'user-a', externalRef: 'asaas-payment-1' },
    );
    // Prescricao do programa vinculada: nunca e' tocada, so' perde o vinculo.
    w.db.trainingSession.push({ id: 'prescribed-user-a', userId: 'user-a', origin: 'agent', structure: {} });

    const result = await w.deletion.deleteProviderData('user-a', 'polar');

    expect(result.notifications).toBe(1);
    expect(w.db.userNotification.map((n) => n.id).sort()).toEqual(['n2', 'n3']);
    expect(w.db.sessionExecutionLink.find((l) => l.activityLogId === b.log.id)!.supersededByLinkId).toBeNull();
    expect(w.db.trainingSession.map((s) => s.id)).toEqual(['prescribed-user-a']);
    expect(w.db.providerConnectionEvent.at(-1)).toMatchObject({ userId: 'user-a', provider: 'polar', type: 'data_deleted' });
    expect(JSON.stringify(w.db.providerConnectionEvent)).not.toContain('payload');
  });

  // Sessao sintetica materializada a partir de uma atividade (mesmos campos que
  // SessionExecutionLinkService.materializeExtraActivity copia do relogio).
  function materialize(w: ReturnType<typeof world>, userId: string, logId: string, sid: string, student: Row = {}, completionOverrides: Row = {}) {
    w.db.trainingSession.push({
      id: sid, userId, modality: 'corrida', title: 'corrida (extra · polar)', origin: 'device_extra',
      scheduledDate: new Date('2026-10-01T00:00:00Z'),
      structure: { type: 'extra', source: 'device', provider: 'polar', modality: 'corrida', activityLogId: logId },
    });
    w.db.workoutCompletion.push({
      id: `c-${sid}`, sessionId: sid, userId, status: 'done', completedAt: STARTED_AT, source: 'device_extra',
      distanceKm: 5.23, durationMin: 1815 / 60, avgHeartRate: 152, maxHeartRate: 178, avgPaceSecondsKm: null,
      adjustmentReasons: [], perceivedEffort: null, painFlag: null, notes: null, ...student, ...completionOverrides,
    });
  }
  const completionOf = (w: ReturnType<typeof world>, sid: string) => w.db.workoutCompletion.find((c) => c.sessionId === sid)!;
  const sessionOf = (w: ReturnType<typeof world>, sid: string) => w.db.trainingSession.find((x) => x.id === sid)!;

  it('12b. sessao sintetica pura (sem nada do aluno) e apagada junto com a atividade', async () => {
    const w = world();
    const a = seedHistory(w, 'user-a', 'polar', 'e1');
    materialize(w, 'user-a', a.log.id, 's-pure');

    const result = await w.deletion.deleteProviderData('user-a', 'polar');

    expect(result.syntheticSessions).toBe(1);
    expect(w.db.trainingSession).toHaveLength(0);
    expect(w.db.workoutCompletion).toHaveLength(0);
    expect(result.preservedMaterialized).toEqual([]);
  });

  it('B1. atividade Polar materializada + RPE: o RPE permanece e as metricas do relogio desaparecem', async () => {
    const w = world();
    const a = seedHistory(w, 'user-a', 'polar', 'e1');
    materialize(w, 'user-a', a.log.id, 's1', { perceivedEffort: 7, preMotivation: 4 });

    const result = await w.deletion.deleteProviderData('user-a', 'polar');

    const c = completionOf(w, 's1');
    expect(c.perceivedEffort).toBe(7); // dado do aluno
    expect(c.preMotivation).toBe(4);
    expect(c.distanceKm).toBeNull();
    expect(c.durationMin).toBeNull();
    expect(c.avgHeartRate).toBeNull();
    expect(c.maxHeartRate).toBeNull();
    expect(c.avgPaceSecondsKm).toBeNull();
    expect(result.preservedMaterialized).toEqual([
      { sessionId: 's1', reason: 'student_input', clearedFields: expect.arrayContaining(['distanceKm', 'durationMin', 'avgHeartRate', 'maxHeartRate', 'completedAt(hora)']) },
    ]);
  });

  it('B2. dor e observacao do aluno permanecem; sessao perde toda referencia a atividade e ao provider', async () => {
    const w = world();
    const a = seedHistory(w, 'user-a', 'polar', 'e1');
    materialize(w, 'user-a', a.log.id, 's2', { painFlag: 'leve', painTiming: 'so_depois', notes: 'joelho incomodou no fim', perceivedEffort: 5 });

    await w.deletion.deleteProviderData('user-a', 'polar');

    const c = completionOf(w, 's2');
    expect(c).toMatchObject({ painFlag: 'leve', painTiming: 'so_depois', notes: 'joelho incomodou no fim', perceivedEffort: 5 });
    const session = sessionOf(w, 's2');
    expect(session.structure).toEqual({ type: 'extra', source: 'student' }); // sem activityLogId/provider/device
    expect(session.origin).toBe('student_extra');
    expect(session.title).toBe('corrida (extra)');
    expect(c.source).toBe('manual');
    // O que sobra de data e' o dia da sessao, nao a hora medida pelo relogio.
    expect((c.completedAt as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('B3. metricas ausentes permanecem null (nunca zero) e nada e inventado no lugar das removidas', async () => {
    const w = world();
    const log = seedHistory(w, 'user-a', 'polar', 'e1').log;
    Object.assign(w.db.activityLog.find((l) => l.id === log.id)!, { avgHeartRateBpm: null, maxHeartRateBpm: null });
    materialize(w, 'user-a', log.id, 's3', { perceivedEffort: 6 }, { avgHeartRate: null, maxHeartRate: null });

    await w.deletion.deleteProviderData('user-a', 'polar');

    const c = completionOf(w, 's3');
    for (const field of ['distanceKm', 'durationMin', 'avgHeartRate', 'maxHeartRate', 'avgPaceSecondsKm']) {
      expect(c[field]).toBeNull();
      expect(c[field]).not.toBe(0);
    }
  });

  it('B4. nenhum consumidor recupera a metrica excluida: nao sobra o valor em nenhum campo, vinculo ou referencia', async () => {
    const w = world();
    const a = seedHistory(w, 'user-a', 'polar', 'e1');
    materialize(w, 'user-a', a.log.id, 's4', { perceivedEffort: 8 });

    await w.deletion.deleteProviderData('user-a', 'polar');

    const remaining = JSON.stringify({ s: sessionOf(w, 's4'), c: completionOf(w, 's4') });
    for (const leaked of ['5.23', '1815', '1815', '152', '178', a.log.id, a.raw.id, 'polar', 'device', '07:15:30']) {
      expect(remaining).not.toContain(leaked);
    }
    // Consumidor real de volume (coach): a sessao preservada contribui com 0 km conhecidos, nao com 5,23.
    const { summarizeSessions } = await import('../src/coach/coach.service');
    const summary = summarizeSessions([{ scheduledDate: new Date('2026-10-01'), durationMin: null, distanceKm: null, completion: { status: 'done', distanceKm: completionOf(w, 's4').distanceKm } }]);
    expect(JSON.stringify(summary)).not.toContain('5.23');
    // As atividades que alimentam pace/FC/cadencia/TI (ActivityLog, samples, serie) nao existem mais.
    expect(w.db.activityLog).toHaveLength(0);
    expect(w.db.rawActivitySample).toHaveLength(0);
    expect(w.db.activityTimeSeriesPoint).toHaveLength(0);
    expect(w.db.sessionExecutionLink).toHaveLength(0);
  });

  it('B5. dados de outro provider (e de outro usuario) permanecem intactos, inclusive sessao sintetica deles', async () => {
    const w = world();
    const polar = seedHistory(w, 'user-a', 'polar', 'e1');
    const strava = seedHistory(w, 'user-a', 'strava', 'e1');
    const other = seedHistory(w, 'user-b', 'polar', 'e1');
    materialize(w, 'user-a', polar.log.id, 's-polar', { perceivedEffort: 7 });
    materialize(w, 'user-a', strava.log.id, 's-strava', { perceivedEffort: 6 });
    materialize(w, 'user-b', other.log.id, 's-other', { perceivedEffort: 5 });
    const before = JSON.stringify([sessionOf(w, 's-strava'), completionOf(w, 's-strava'), sessionOf(w, 's-other'), completionOf(w, 's-other')]);

    await w.deletion.deleteProviderData('user-a', 'polar');

    expect(JSON.stringify([sessionOf(w, 's-strava'), completionOf(w, 's-strava'), sessionOf(w, 's-other'), completionOf(w, 's-other')])).toBe(before);
    expect(completionOf(w, 's-strava').distanceKm).toBe(5.23);
  });

  it('B6. valor editado pelo aluno (nao e mais a copia do relogio) e dado do aluno e permanece', async () => {
    const w = world();
    const a = seedHistory(w, 'user-a', 'polar', 'e1');
    // O aluno corrigiu a distancia para 5,0 km e o tempo para 32 min; FC segue a copia.
    materialize(w, 'user-a', a.log.id, 's6', { perceivedEffort: 7 }, { distanceKm: 5.0, durationMin: 32 });

    await w.deletion.deleteProviderData('user-a', 'polar');

    const c = completionOf(w, 's6');
    expect(c.distanceKm).toBe(5.0);
    expect(c.durationMin).toBe(32);
    expect(c.avgHeartRate).toBeNull();
    expect(c.maxHeartRate).toBeNull();
  });

  it('tenis escolhido pelo aluno (ShoeUsage) mantem a sessao; status alterado pelo aluno tambem', async () => {
    const w = world();
    const a = seedHistory(w, 'user-a', 'polar', 'e1');
    const b = seedHistory(w, 'user-a', 'polar', 'e2');
    materialize(w, 'user-a', a.log.id, 's-shoe', {}, { shoeUsage: { id: 'u1' } });
    materialize(w, 'user-a', b.log.id, 's-adj', {}, { status: 'adjusted' });

    const result = await w.deletion.deleteProviderData('user-a', 'polar');

    expect(result.preservedMaterialized.map((p) => [p.sessionId, p.reason]).sort()).toEqual([['s-adj', 'not_done'], ['s-shoe', 'shoe_usage']]);
    expect(completionOf(w, 's-shoe').shoeUsage).toEqual({ id: 'u1' });
    expect(completionOf(w, 's-shoe').distanceKm).toBeNull();
  });

  it('classifyMaterializedCompletion: coluna desconhecida preenchida cai no lado seguro (e do aluno)', () => {
    const activity = { startedAt: STARTED_AT, distanceMeters: 5230, durationSec: 1815, avgHeartRateBpm: 152, maxHeartRateBpm: 178 };
    const copy = { id: 'c', userId: 'u', sessionId: 's', status: 'done', distanceKm: 5.23, durationMin: 1815 / 60, avgHeartRate: 152, maxHeartRate: 178, source: 'device_extra', adjustmentReasons: [], notes: null };
    expect(classifyMaterializedCompletion(copy, activity)).toMatchObject({ studentInput: false });
    expect(classifyMaterializedCompletion({ ...copy, notes: 'cansado' }, activity).studentInput).toBe(true);
    expect(classifyMaterializedCompletion({ ...copy, adjustmentReasons: ['x'] }, activity).studentInput).toBe(true);
    expect(classifyMaterializedCompletion({ ...copy, colunaFutura: 3 }, activity).studentInput).toBe(true);
    expect(classifyMaterializedCompletion({ ...copy, avgPaceSecondsKm: 347 }, activity).clear).toHaveProperty('avgPaceSecondsKm');
  });

  it('13. exclusao e idempotente: a segunda chamada devolve zeros e nao falha', async () => {
    const w = world();
    seedHistory(w, 'user-a', 'polar', 'e1');
    await w.deletion.deleteProviderData('user-a', 'polar');

    const again = await w.deletion.deleteProviderData('user-a', 'polar');

    expect(again).toMatchObject({ activities: 0, rawActivities: 0, samples: 0, timeSeriesPoints: 0, executionLinks: 0, syntheticSessions: 0, preservedMaterialized: [] });
  });

  it('exclusao via Polar exige conexao desconectada (senao o proximo sync reimportaria) e depois funciona', async () => {
    const w = world(); w.connect('user-a', '999');
    seedHistory(w, 'user-a', 'polar', 'e1');
    await expect(w.polar.deleteData('user-a')).rejects.toBeInstanceOf(ConflictException);
    expect(w.db.activityLog).toHaveLength(1);

    global.fetch = jest.fn(async () => res(204)) as never;
    await w.polar.disconnect('user-a');
    await expect(w.polar.deleteData('user-a')).resolves.toMatchObject({ activities: 1 });
    expect(w.db.activityLog).toHaveLength(0);
    // Nova coleta continua bloqueada apos a exclusao.
    await expect(w.ingestion.sync('user-a')).rejects.toBeInstanceOf(ConflictException);
  });
});
