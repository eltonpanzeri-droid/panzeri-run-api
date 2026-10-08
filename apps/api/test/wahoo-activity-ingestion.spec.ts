import { ConflictException, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { WahooActivityIngestionService } from '../src/wahoo/wahoo-activity-ingestion.service';
import { WahooWebhookService } from '../src/wahoo/wahoo-webhook.service';
import { WahooSyncFallbackSchedulerService } from '../src/wahoo/wahoo-sync-fallback-scheduler.service';
import { WahooController } from '../src/wahoo/wahoo.controller';
import {
  isCompletedSummary, mapWahooActivity, normalizeWahooModality, parseWahooStartedAt, utcOffsetMinutesFor, extractWahooProviderMetrics,
} from '../src/wahoo/wahoo-activity-normalizer';

type Row = Record<string, any>;
const NOW = new Date('2026-10-08T20:00:00Z');
const SCOPES = 'user_read workouts_read offline_data';

const workout = (id: number, startsIso: string, extra: Row = {}) => ({ id, starts: startsIso, minutes: 30, name: `Treino ${id}`, workout_type_id: 1, updated_at: '2026-10-08T12:00:00Z', ...extra });
const summary = (extra: Row = {}) => ({
  id: 1, distance_accum: '5000.00', duration_active_accum: '1800.00', duration_total_accum: '1900.00', calories_accum: '350.00',
  heart_rate_avg: '152.00', ascent_accum: '40.00', speed_avg: '2.78', time_zone: 'America/Sao_Paulo', manual: false, edited: false, fitness_app_id: 1, cadence_avg: '170', power_avg: '0', ...extra,
});
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } });

function fixture(connectionOverrides: Row = {}) {
  const connections = new Map<string, Row>([
    ['user-a', { userId: 'user-a', wahooUserId: '111', accessTokenEncrypted: 'v1:x', grantedScopes: SCOPES, collectFrom: new Date('2026-10-01T00:00:00Z'), disconnectedAt: null, lastSyncCompletedAt: null, ...connectionOverrides }],
    ['user-b', { userId: 'user-b', wahooUserId: '222', accessTokenEncrypted: 'v1:y', grantedScopes: SCOPES, collectFrom: new Date('2026-10-01T00:00:00Z'), disconnectedAt: null, lastSyncCompletedAt: null }],
  ]);
  const raws = new Map<string, Row>();
  const logs = new Map<string, Row>();
  let revoked = false;
  const key = (w: Row) => `${w.provider_userId_externalId.provider}|${w.provider_userId_externalId.userId}|${w.provider_userId_externalId.externalId}`;
  const prisma: any = {
    wahooConnection: {
      findUnique: jest.fn(async ({ where }: Row) => { const r = connections.get(where.userId); return r ? { ...r } : null; }),
      updateMany: jest.fn(async ({ where, data }: Row) => { const r = connections.get(where.userId); if (!r || (where.disconnectedAt === null && r.disconnectedAt)) return { count: 0 }; Object.assign(r, data); return { count: 1 }; }),
    },
    rawExternalActivity: { findUnique: jest.fn(async ({ where }: Row) => raws.get(key(where)) ?? null) },
    $transaction: jest.fn(async (cb: (tx: Row) => Promise<unknown>) => {
      const tx = {
        $queryRaw: async () => (revoked ? [] : [{ id: 'conn' }]),
        rawExternalActivity: { upsert: async ({ where, create, update }: Row) => { const k = key(where); const row = raws.get(k) ? Object.assign(raws.get(k)!, update) : { id: `raw-${raws.size + 1}`, ...create }; raws.set(k, row); return row; } },
        activityLog: { upsert: async ({ where, create, update }: Row) => { const k = key(where); const row = logs.get(k) ? Object.assign(logs.get(k)!, update) : { id: `log-${logs.size + 1}`, ...create }; logs.set(k, row); return row; } },
      };
      return cb(tx);
    }),
  };
  const wahoo = { getAccessToken: jest.fn(async () => 'access-token-PRIVADO') };
  const link = { classify: jest.fn(async () => 'corresponding') };
  const notifications = { notifyReconciliation: jest.fn(async () => undefined) };
  const identity = { evaluateSafely: jest.fn(async () => undefined) };
  const service = new WahooActivityIngestionService(prisma, wahoo as never, link as never, notifications as never, identity as never);
  return { service, prisma, connections, raws, logs, wahoo, link, notifications, identity, revoke: () => { revoked = true; } };
}

// Roteia a rede por URL; registra cada chamada.
function network(opts: { pages?: Row[][]; summaries?: Record<string, () => unknown>; listStatus?: number; listHeaders?: Record<string, string> }) {
  const calls: Array<{ url: string; auth: string | undefined }> = [];
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    const list = href.match(/\/v1\/workouts\?page=(\d+)&per_page=(\d+)/);
    if (list) {
      if (opts.listStatus && opts.listStatus !== 200) return json(opts.listStatus, {}, opts.listHeaders);
      return json(200, { workouts: (opts.pages ?? [])[Number(list[1]) - 1] ?? [], total: 0, page: Number(list[1]) }, opts.listHeaders);
    }
    const one = href.match(/\/v1\/workouts\/(\d+)\/workout_summary/);
    if (one) { const h = opts.summaries?.[one[1]]; return h ? (h() as never) : json(404, {}); }
    throw new Error(`rede inesperada: ${href}`);
  }) as unknown as typeof fetch;
  return calls;
}

describe('normalizador Wahoo', () => {
  it('modalidade: so corrida e esteira inequivocas; resto e outra (nunca inventa)', () => {
    for (const id of [1, 3, 4, 67]) expect(normalizeWahooModality(id)).toBe('corrida');
    for (const id of [5, 71]) expect(normalizeWahooModality(id)).toBe('esteira');
    for (const id of [0, 6, 9, 42, 56, 255, null, undefined, 'x']) expect(normalizeWahooModality(id)).toBe('outra');
  });

  it('decimais em string e unidades corretas; campo ausente vira null, nunca 0', () => {
    const mapped = mapWahooActivity(workout(1, '2026-10-08T10:34:01.000Z'), summary())!;
    expect(mapped).toMatchObject({ distanceMeters: 5000, durationSec: 1800, caloriesKcal: 350, avgHeartRateBpm: 152, elevationGainMeters: 40, sport: 'corrida', maxHeartRateBpm: null, hasRoute: null });
    const empty = mapWahooActivity(workout(1, '2026-10-08T10:34:01Z'), { duration_total_accum: '600' })!;
    expect(empty).toMatchObject({ distanceMeters: null, durationSec: 600, caloriesKcal: null, avgHeartRateBpm: null, elevationGainMeters: null });
  });

  it('inicio sem fuso explicito e recusado; com Z ou offset e aceito', () => {
    expect(parseWahooStartedAt('2026-10-08T10:34:00')).toBeNull();
    expect(parseWahooStartedAt('nao-e-data')).toBeNull();
    expect(parseWahooStartedAt(123)).toBeNull();
    expect(parseWahooStartedAt('2026-10-08T10:34:01.000Z')!.toISOString()).toBe('2026-10-08T10:34:01.000Z');
    expect(parseWahooStartedAt('2026-10-08T07:34:01-03:00')!.toISOString()).toBe('2026-10-08T10:34:01.000Z');
    expect(mapWahooActivity(workout(1, '2026-10-08T10:34:00'), summary())).toBeNull();
  });

  it('offset do fuso na convencao Polar (local - UTC): Sao Paulo = -180; invalido = null', () => {
    const at = new Date('2026-10-08T10:34:01Z');
    expect(utcOffsetMinutesFor('America/Sao_Paulo', at)).toBe(-180);
    expect(utcOffsetMinutesFor('UTC', at)).toBe(0);
    expect(utcOffsetMinutesFor('Asia/Kolkata', at)).toBe(330);
    expect(utcOffsetMinutesFor('Fuso/Que/Nao/Existe', at)).toBeNull();
    expect(utcOffsetMinutesFor(undefined, at)).toBeNull();
    // Coerente com o horario local da Polar: 07:34 local com offset -180 => 10:34 UTC
    const localAsUtc = Date.UTC(2026, 9, 8, 7, 34, 1);
    expect(new Date(localAsUtc - (utcOffsetMinutesFor('America/Sao_Paulo', at) as number) * 60_000).toISOString()).toBe('2026-10-08T10:34:01.000Z');
  });

  it('resumo vazio (treino agendado) nao e atividade realizada', () => {
    expect(isCompletedSummary(null)).toBe(false);
    expect(isCompletedSummary({})).toBe(false);
    expect(isCompletedSummary({ heart_rate_avg: '150' })).toBe(false);
    expect(isCompletedSummary({ duration_total_accum: '10' })).toBe(true);
  });

  it('metricas proprietarias identificadas; cadencia e potencia NAO viram canonico', () => {
    const metrics = extractWahooProviderMetrics(workout(1, '2026-10-08T10:34:01Z'), summary());
    expect(metrics).toMatchObject({ workoutTypeId: 1, workoutTypeName: 'RUNNING', manual: false, edited: false, fitnessAppId: 1, speedAvgMetersPerSecond: 2.78 });
    expect(JSON.stringify(mapWahooActivity(workout(1, '2026-10-08T10:34:01Z'), summary()))).not.toMatch(/cadence|power/i);
  });
});

describe('sincronizacao de atividades Wahoo', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout'] }); });
  afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); jest.restoreAllMocks(); });

  it('importa a corrida: raw preservado, ActivityLog canonico, identidade fisica, reconciliacao e aviso — uma vez cada', async () => {
    const f = fixture();
    const calls = network({ pages: [[workout(900, '2026-10-08T10:34:01.000Z')]], summaries: { 900: () => json(200, summary()) } });
    await expect(f.service.sync('user-a')).resolves.toEqual({ status: 'synced', imported: 1 });
    expect([...f.raws.keys()]).toEqual(['wahoo|user-a|900']);
    expect(f.raws.get('wahoo|user-a|900')!.payload).toMatchObject({ workout: { id: 900 }, summary: { distance_accum: '5000.00' } });
    expect(f.raws.get('wahoo|user-a|900')!.payloadSchemaVersion).toBe('wahoo-cloud-v1-workout-and-summary');
    const log = f.logs.get('wahoo|user-a|900')!;
    expect(log).toMatchObject({ userId: 'user-a', provider: 'wahoo', externalId: '900', sport: 'corrida', distanceMeters: 5000, durationSec: 1800, avgHeartRateBpm: 152, utcOffsetMinutes: -180, rawActivityId: 'raw-1' });
    expect(log.startedAt.toISOString()).toBe('2026-10-08T10:34:01.000Z');
    expect(f.identity.evaluateSafely).toHaveBeenCalledWith('log-1');
    expect(f.link.classify).toHaveBeenCalledWith('log-1');
    expect(f.notifications.notifyReconciliation).toHaveBeenCalledWith('user-a', 'log-1', 'corresponding');
    expect(f.connections.get('user-a')!.lastSyncCompletedAt).toBeInstanceOf(Date);
    // so' a API da Wahoo, sempre com o token do proprio aluno
    expect(calls.every((c) => c.url.startsWith('https://api.wahooligan.com/'))).toBe(true);
    expect(calls.every((c) => c.auth === 'Bearer access-token-PRIVADO')).toBe(true);
    expect(f.wahoo.getAccessToken).toHaveBeenCalledWith('user-a');
  });

  it('idempotente: repetir o sync nao busca o resumo de novo, nao duplica e nao reclassifica', async () => {
    const f = fixture();
    const summaries = { 900: jest.fn(() => json(200, summary())) };
    network({ pages: [[workout(900, '2026-10-08T10:34:01.000Z')]], summaries });
    await f.service.sync('user-a');
    const second = await f.service.sync('user-a');
    expect(second).toEqual({ status: 'no_new_data', imported: 0 });
    expect(summaries[900]).toHaveBeenCalledTimes(1);
    expect(f.raws.size).toBe(1);
    expect(f.logs.size).toBe(1);
    expect(f.link.classify).toHaveBeenCalledTimes(1);
  });

  it('treino editado na Wahoo (updated_at mais novo) e atualizado no mesmo registro, sem duplicar', async () => {
    const f = fixture();
    network({ pages: [[workout(900, '2026-10-08T10:34:01.000Z')]], summaries: { 900: () => json(200, summary()) } });
    await f.service.sync('user-a');
    network({ pages: [[workout(900, '2026-10-08T10:34:01.000Z', { updated_at: '2026-10-08T18:00:00Z' })]], summaries: { 900: () => json(200, summary({ distance_accum: '5200.00' })) } });
    await expect(f.service.sync('user-a')).resolves.toMatchObject({ imported: 1 });
    expect(f.logs.size).toBe(1);
    expect(f.logs.get('wahoo|user-a|900')!.distanceMeters).toBe(5200);
  });

  it('respeita a janela de coleta: nada anterior a collectFrom e para de paginar; futuro/agendado e resumo vazio sao ignorados', async () => {
    const f = fixture({ collectFrom: new Date('2026-10-05T00:00:00Z') });
    const summaries = { 1: jest.fn(() => json(200, summary())), 2: jest.fn(() => json(200, {})), 3: jest.fn(() => json(200, summary())), 4: jest.fn(() => json(200, summary())) };
    const calls = network({
      pages: [[
        workout(9, '2026-10-20T10:00:00Z'), // futuro (agendado)
        workout(1, '2026-10-08T10:00:00Z'), // ok
        workout(2, '2026-10-07T10:00:00Z'), // resumo vazio
        workout(3, '2026-10-04T10:00:00Z'), // anterior a janela -> para aqui
        workout(4, '2026-10-03T10:00:00Z'),
      ]],
      summaries,
    });
    await expect(f.service.sync('user-a')).resolves.toEqual({ status: 'synced', imported: 1 });
    expect([...f.raws.keys()]).toEqual(['wahoo|user-a|1']);
    expect(summaries[3]).not.toHaveBeenCalled();
    expect(summaries[4]).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.url.includes('/v1/workouts?page=')).length).toBe(1); // nao pediu a pagina 2
  });

  it('sem collectFrom (conexao antiga): usa 7 dias para tras e grava o valor', async () => {
    const f = fixture({ collectFrom: null });
    network({ pages: [[workout(1, '2026-10-08T10:00:00Z'), workout(2, '2026-09-20T10:00:00Z')]], summaries: { 1: () => json(200, summary()), 2: () => json(200, summary()) } });
    await f.service.sync('user-a');
    expect([...f.raws.keys()]).toEqual(['wahoo|user-a|1']);
    expect((f.connections.get('user-a')!.collectFrom as Date).toISOString()).toBe('2026-10-01T20:00:00.000Z');
  });

  it('conexao sem a permissao de leitura (so user_read): pede reautorizacao e NAO chama a rede nem o token', async () => {
    const f = fixture({ grantedScopes: 'user_read' });
    const calls = network({});
    await expect(f.service.sync('user-a')).resolves.toEqual({ status: 'reauthorization_required', imported: 0 });
    expect(calls).toHaveLength(0);
    expect(f.wahoo.getAccessToken).not.toHaveBeenCalled();
  });

  it('403 da Wahoo na listagem tambem vira pedido de reautorizacao', async () => {
    const f = fixture();
    network({ listStatus: 403 });
    await expect(f.service.sync('user-a')).resolves.toEqual({ status: 'reauthorization_required', imported: 0 });
  });

  it('desconectado ou inexistente: nenhuma coleta', async () => {
    const f = fixture({ disconnectedAt: new Date() });
    const calls = network({});
    await expect(f.service.sync('user-a')).rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.sync('ninguem')).rejects.toBeInstanceOf(NotFoundException);
    expect(calls).toHaveLength(0);
  });

  it('revogada NO MEIO do sync: nada e persistido e o resultado e disconnected', async () => {
    const f = fixture();
    network({ pages: [[workout(900, '2026-10-08T10:34:01.000Z')]], summaries: { 900: () => { f.revoke(); return json(200, summary()); } } });
    await expect(f.service.sync('user-a')).resolves.toEqual({ status: 'disconnected', imported: 0 });
    expect(f.raws.size).toBe(0);
    expect(f.logs.size).toBe(0);
    expect(f.link.classify).not.toHaveBeenCalled();
  });

  it('429 da Wahoo para o sync sem confirmar; cabecalho de limite quase zerado tambem', async () => {
    const f = fixture();
    network({ listStatus: 429 });
    await expect(f.service.sync('user-a')).resolves.toEqual({ status: 'rate_limited', imported: 0 });
    expect(f.connections.get('user-a')!.lastSyncCompletedAt).toBeNull();
    network({ pages: [[]], listHeaders: { 'x-ratelimit-remaining': '4000, 900, 1' } });
    await expect(f.service.sync('user-a')).resolves.toEqual({ status: 'rate_limited', imported: 0 });
  });

  it('401 (token invalido) nao e engolido: erro claro para reconectar', async () => {
    const f = fixture();
    network({ listStatus: 401 });
    await expect(f.service.sync('user-a')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('falha parcial: importa o que da, NAO confirma o sync e a proxima rodada retoma o que faltou', async () => {
    const f = fixture();
    let broken = true;
    network({
      pages: [[workout(2, '2026-10-08T12:00:00Z'), workout(1, '2026-10-08T10:00:00Z')]],
      summaries: { 1: () => json(200, summary()), 2: () => (broken ? json(500, {}) : json(200, summary())) },
    });
    await expect(f.service.sync('user-a')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect([...f.raws.keys()]).toEqual(['wahoo|user-a|1']);
    expect(f.connections.get('user-a')!.lastSyncCompletedAt).toBeNull();
    broken = false;
    await expect(f.service.sync('user-a')).resolves.toEqual({ status: 'synced', imported: 1 });
    expect([...f.raws.keys()].sort()).toEqual(['wahoo|user-a|1', 'wahoo|user-a|2']);
  });

  it('teto de resumos novos por sync (protege o limite da API): o resto fica para a proxima rodada', async () => {
    const f = fixture();
    const list = Array.from({ length: 28 }, (_, i) => workout(100 + i, new Date(Date.parse('2026-10-08T18:00:00Z') - i * 3_600_000).toISOString()));
    const summaries: Record<string, () => unknown> = Object.fromEntries(list.map((w) => [String(w.id), () => json(200, summary())]));
    network({ pages: [list], summaries });
    await expect(f.service.sync('user-a')).resolves.toEqual({ status: 'synced', imported: 25 });
    network({ pages: [list], summaries });
    await expect(f.service.sync('user-a')).resolves.toEqual({ status: 'synced', imported: 3 });
    expect(f.raws.size).toBe(28);
  });

  it('dois syncs simultaneos do mesmo aluno: o segundo so informa in_progress', async () => {
    const f = fixture();
    network({ pages: [[workout(900, '2026-10-08T10:34:01.000Z')]], summaries: { 900: () => json(200, summary()) } });
    const [a, b] = await Promise.all([f.service.sync('user-a'), f.service.sync('user-a')]);
    expect([a.status, b.status].sort()).toEqual(['in_progress', 'synced']);
    expect(f.raws.size).toBe(1);
  });

  it('isolamento: os dados gravados pertencem so ao aluno do sync, e o token e o do proprio aluno', async () => {
    const f = fixture();
    network({ pages: [[workout(900, '2026-10-08T10:34:01.000Z')]], summaries: { 900: () => json(200, summary()) } });
    await f.service.sync('user-b');
    expect([...f.raws.keys()]).toEqual(['wahoo|user-b|900']);
    expect(f.wahoo.getAccessToken).toHaveBeenCalledWith('user-b');
    expect(f.connections.get('user-a')!.lastSyncCompletedAt).toBeNull();
  });

  it('o mesmo id de treino em dois alunos gera dois registros independentes', async () => {
    const f = fixture();
    network({ pages: [[workout(900, '2026-10-08T10:34:01.000Z')]], summaries: { 900: () => json(200, summary()) } });
    await f.service.sync('user-a');
    await f.service.sync('user-b');
    expect([...f.raws.keys()].sort()).toEqual(['wahoo|user-a|900', 'wahoo|user-b|900']);
  });

  it('falha em identidade/reconciliacao/aviso nunca desfaz o resumo ja salvo', async () => {
    const f = fixture();
    f.identity.evaluateSafely.mockRejectedValueOnce(new Error('x'));
    f.link.classify.mockRejectedValueOnce(new Error('y'));
    f.notifications.notifyReconciliation.mockRejectedValueOnce(new Error('z'));
    network({ pages: [[workout(900, '2026-10-08T10:34:01.000Z')]], summaries: { 900: () => json(200, summary()) } });
    // evaluateSafely e' "seguro" por contrato; aqui ele e' simulado com falha para provar que o resumo ja estava salvo antes
    await f.service.sync('user-a').catch(() => undefined);
    expect(f.raws.size).toBe(1);
    expect(f.logs.size).toBe(1);
  });
});

describe('webhook Wahoo', () => {
  const TOKEN = 'token-do-webhook-com-mais-de-16-caracteres';
  function webhook(env: Record<string, string | undefined> = { WAHOO_WEBHOOK_TOKEN: TOKEN }, connections: Row[] = [{ userId: 'user-a', wahooUserId: '111', disconnectedAt: null }]) {
    const prisma = { wahooConnection: { findUnique: jest.fn(async ({ where }: Row) => connections.find((c) => c.wahooUserId === where.wahooUserId) ?? null) } };
    const ingestion = { sync: jest.fn(async () => ({ status: 'synced', imported: 1 })) };
    const service = new WahooWebhookService(prisma as never, { get: (n: string) => env[n] } as never, ingestion as never);
    return { service, prisma, ingestion };
  }

  it('token correto autoriza; ausente, errado, vazio ou servidor sem token configurado => 401 (fail-closed)', () => {
    const { service } = webhook();
    expect(() => service.verifyToken({ webhook_token: TOKEN })).not.toThrow();
    for (const body of [{}, null, undefined, { webhook_token: '' }, { webhook_token: 'errado' }, { webhook_token: TOKEN + 'x' }, { webhook_token: 123 }]) {
      expect(() => service.verifyToken(body)).toThrow(UnauthorizedException);
    }
    expect(() => webhook({ WAHOO_WEBHOOK_TOKEN: undefined }).service.verifyToken({ webhook_token: 'qualquer' })).toThrow(UnauthorizedException);
    expect(() => webhook({ WAHOO_WEBHOOK_TOKEN: 'curto' }).service.verifyToken({ webhook_token: 'curto' })).toThrow(UnauthorizedException); // token fraco e recusado
  });

  it('evento workout_summary de aluno conectado dispara o sync do ALUNO DONO (por id Wahoo), sem usar o conteudo do evento', async () => {
    const { service, ingestion } = webhook();
    await service.handleEvent({ event_type: 'workout_summary', user: { id: 111 }, workout_summary: { distance_accum: '999999', file: { url: 'http://malicioso' } } });
    expect(ingestion.sync).toHaveBeenCalledTimes(1);
    expect(ingestion.sync).toHaveBeenCalledWith('user-a');
  });

  it('ignora: outro tipo de evento, usuario desconhecido, conexao revogada, corpo invalido', async () => {
    const { service, ingestion } = webhook(undefined, [{ userId: 'user-a', wahooUserId: '111', disconnectedAt: null }, { userId: 'user-c', wahooUserId: '333', disconnectedAt: new Date() }]);
    await service.handleEvent({ event_type: 'outro', user: { id: 111 } });
    await service.handleEvent({ event_type: 'workout_summary', user: { id: 999 } });
    await service.handleEvent({ event_type: 'workout_summary', user: { id: 333 } });
    await service.handleEvent({ event_type: 'workout_summary', user: {} });
    await service.handleEvent(null);
    await service.handleEvent('texto');
    expect(ingestion.sync).not.toHaveBeenCalled();
  });

  it('sync em andamento: agenda UMA nova tentativa', async () => {
    jest.useFakeTimers();
    const { service, ingestion } = webhook();
    ingestion.sync.mockResolvedValueOnce({ status: 'in_progress', imported: 0 } as never);
    await service.handleEvent({ event_type: 'workout_summary', user: { id: 111 } });
    expect(ingestion.sync).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(61_000);
    expect(ingestion.sync).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('controller: token errado => 401 e NENHUM processamento; token certo => 200 imediato', () => {
    const { service, ingestion } = webhook();
    const controller = new WahooController({} as never, {} as never, service);
    expect(() => controller.webhook({ event_type: 'workout_summary', user: { id: 111 }, webhook_token: 'errado' })).toThrow(UnauthorizedException);
    expect(ingestion.sync).not.toHaveBeenCalled();
    expect(controller.webhook({ event_type: 'workout_summary', user: { id: 111 }, webhook_token: TOKEN })).toEqual({ ok: true });
    const guards = (name: string) => Reflect.getMetadata('__guards__', (WahooController.prototype as any)[name]) as unknown[] | undefined;
    expect(guards('webhook')).toBeUndefined(); // publico: a autenticacao e o token
    expect(guards('sync')?.length).toBeGreaterThan(0);
    expect(guards('deleteData')?.length).toBeGreaterThan(0);
  });
});

describe('rotina de seguranca Wahoo', () => {
  function scheduler(results: Array<{ status: string } | Error>) {
    const prisma = { wahooConnection: { findMany: jest.fn(async () => results.map((_, i) => ({ userId: `u${i}` }))) } };
    let i = 0;
    const ingestion = { sync: jest.fn(async () => { const r = results[i++]; if (r instanceof Error) throw r; return r; }) };
    const service = new WahooSyncFallbackSchedulerService(prisma as never, ingestion as never);
    return { service, prisma, ingestion };
  }

  it('so' + " conexoes ativas com a permissao de leitura e sem sync recente; uma falha nao derruba as demais", async () => {
    const { service, prisma, ingestion } = scheduler([{ status: 'synced' }, new Error('falhou'), { status: 'no_new_data' }]);
    await service.syncStaleConnections(NOW, 0);
    const query = (prisma.wahooConnection.findMany.mock.calls[0] as unknown as [Row])[0];
    expect(query.where.disconnectedAt).toBeNull();
    expect(query.where.grantedScopes).toEqual({ contains: 'workouts_read' });
    expect(query.take).toBeLessThanOrEqual(100);
    expect(ingestion.sync).toHaveBeenCalledTimes(3);
  });

  it('para a rodada no primeiro limite da API (o resto fica para a proxima)', async () => {
    const { service, ingestion } = scheduler([{ status: 'synced' }, { status: 'rate_limited' }, { status: 'synced' }, { status: 'synced' }]);
    await service.syncStaleConnections(NOW, 0);
    expect(ingestion.sync).toHaveBeenCalledTimes(2);
  });

  it('execucao sobreposta e pulada', async () => {
    const { service, ingestion } = scheduler([{ status: 'synced' }]);
    (service as any).isRunning = true;
    await service.syncStaleConnections(NOW, 0);
    expect(ingestion.sync).not.toHaveBeenCalled();
  });
});
