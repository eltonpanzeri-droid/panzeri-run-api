import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { buildSyntheticFit } from './helpers/synthetic-fit';
import { readZeppFit } from '../src/zepp/zepp-fit';
import { parseZeppWebhook, toInboundDrafts } from '../src/zepp/zepp-webhook';
import { ZeppActivityIngestionService } from '../src/zepp/zepp-activity-ingestion.service';
import { BACKFILL_EVENT, FIT_RECOVERY_EVENT_PREFIX, ZeppBackfillService, BackfillHttpResult } from '../src/zepp/zepp-backfill.service';
import { ZeppActivityEventService } from '../src/zepp/zepp-activity-events.service';
import { ZEPP_EXECUTED_WORKOUT_ID_FIELD } from '../src/zepp/zepp-workout-profile';
import { buildZeppConnector } from '../src/zepp/zepp.connector';
import { AiDataEligibility, EXTERNAL_AI_APPROVED_PROVIDERS } from '../src/ai-governance/ai-data-eligibility.service';
import { aiActivityWhere, runWithAiScope } from '../src/ai-governance/ai-scope';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';
import { purposeTextHash } from '../src/provider-hub/provider-consent.service';
import { ZEPP_CONSENT } from '../src/zepp/zepp-consent';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { VARIABLE_REGISTRY } from '../src/training-intelligence/variable-registry';

const CALLBACK = 'https://api-open.zepp.com/api/activity/file?id=10010727180&token=550e8400-e29b-41d4-a716-446655440000';
const record = (over: Record<string, unknown> = {}) => ({ userId: 'zx', summaryId: '10010727180-file', fileType: 'FIT', callbackURL: CALLBACK, activityType: 'OUTDOOR_RUN', deviceName: 'Amazfit', startTimeInSeconds: 1760778000, activityId: 10010727180, manual: false, ...over });
const body = (...records: unknown[]) => JSON.stringify([JSON.stringify({ activityFiles: records })]);

describe('vinculo prescrito x executado SEM depender do workoutId publicado (confirmado pela Zepp em 21/10/2026)', () => {
  it('o evento e o FIT nao trazem o workoutId: o campo e permanentemente nulo e o parser nunca extrai identificador de treino publicado', () => {
    expect(ZEPP_EXECUTED_WORKOUT_ID_FIELD).toBeNull();
    const content = parseZeppWebhook(body(record({ workoutId: 123456, publishedWorkoutId: 'x' })));
    expect(content.activityFiles[0]).not.toHaveProperty('publishedWorkoutId');
    expect(toInboundDrafts(content)[0].payload).not.toHaveProperty('publishedWorkoutId');
    expect(JSON.stringify(toInboundDrafts(content)[0].payload)).not.toContain('123456');
  });

  it('o vinculo exato por identificador nao existe mais (nenhum codigo gera confianca "exact" nem matchMethod zepp_workout_id)', () => {
    const dir = join(__dirname, '..', 'src', 'zepp');
    const files = require('node:fs').readdirSync(dir).filter((f: string) => f.endsWith('.ts'));
    expect(files).not.toContain('zepp-exact-link.service.ts');
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text).not.toMatch(/matchMethod:s*.zepp_workout_id./);
      expect(text).not.toMatch(/confidence:\s*'exact'/);
    }
  });

  it('a ingestao so classifica pelo mecanismo existente (data, modalidade, horario, caracteristicas): vinculo automatico = inferido, nunca certeza', async () => {
    const tx: any = {
      rawExternalActivity: { upsert: async () => ({ id: 'raw1' }) },
      activityLog: { upsert: async () => ({ id: 'log1' }) },
      activityTimeSeriesPoint: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    };
    const consent = { writeWhileAuthorized: async (_p: string, _u: string, write: any) => write(tx, { categories: ['profile', 'activity'], purposes: [] }) };
    const link = { classify: jest.fn(async () => 'corresponding'), linkManually: jest.fn(), reconcileAffectedByIdentity: async () => undefined };
    const service = new ZeppActivityIngestionService({} as any, consent as any, link as any, { notifyReconciliation: async () => undefined } as any, { evaluateSafely: async () => undefined } as any);
    const fit = await readZeppFit(buildSyntheticFit({ seconds: 10 }));
    const meta = { summaryId: 's', activityId: null, activityType: null, deviceName: null, source: 'webhook' as const };
    expect(await service.ingest('u1', meta, fit)).toMatchObject({ written: true, classification: 'corresponding' });
    expect(link.classify).toHaveBeenCalledTimes(1);
    expect(link.linkManually).not.toHaveBeenCalled(); // nenhum vinculo por identificador fora do mecanismo de classificacao
  });

  it('idempotencia da fila: o mesmo arquivo (mesmo link) e o mesmo evento; um link NOVO para o mesmo summaryId (reentrega do Backfill) e um evento novo', () => {
    const key = (callback: string) => toInboundDrafts(parseZeppWebhook(body(record({ callbackURL: callback }))))[0].dedupeKey;
    const a = 'https://api-open.zepp.com/api/activity/file?id=1&token=aaaa';
    const b = 'https://api-open.zepp.com/api/activity/file?id=1&token=bbbb';
    expect(key(a)).toBe(key(a));
    expect(key(a)).not.toBe(key(b));
    expect(key(a)).toMatch(/^activity:10010727180-file:[0-9a-f]{16}$/);
    expect(key(a)).not.toContain('aaaa'); // o token do link nunca vai para a chave
  });
});

describe('importacao FIT: link expirado ou nao reutilizavel e recuperado pelo Backfill API', () => {
  const NOW = new Date('2026-10-21T12:00:00Z');
  const START = Math.floor(new Date('2026-10-21T08:00:00Z').getTime() / 1000);
  function makeRecovery(opts: { enabled?: boolean; snapshot?: any; done?: boolean; result?: BackfillHttpResult } = {}) {
    const snapshot = opts.snapshot === undefined ? { categories: ['profile', 'activity'], purposes: [], collectFrom: new Date('2026-10-01T00:00:00Z') } : opts.snapshot;
    const consent = { snapshot: jest.fn(async () => snapshot) };
    const recorded: any[] = [];
    const connections = {
      hasEvent: jest.fn(async (_p: string, _u: string, type: string) => opts.done === true || recorded.some((r) => r.type === type)),
      recordEvent: jest.fn(async (_p: string, userId: string, type: string, details: any) => { recorded.push({ userId, type, details }); }),
      getAccessToken: jest.fn(async () => 'token-secreto'),
    };
    const client = { request: jest.fn(async (): Promise<BackfillHttpResult> => opts.result ?? { ok: true, requestId: 'rec-1' }) };
    const config = { get: (k: string) => (k === 'ZEPP_BACKFILL_ENABLED' ? ((opts.enabled ?? true) ? 'true' : 'false') : undefined) } as unknown as ConfigService;
    return { service: new ZeppBackfillService(consent as any, connections as any, client as any, config), connections, client, recorded };
  }

  it('pede ao Backfill uma janela ESTREITA em torno da atividade, uma unica vez por atividade, e so depois do aceite grava a marca', async () => {
    const t = makeRecovery();
    expect(await t.service.requestRecovery('u1', { summaryId: 'abc-file', startTimeInSeconds: START }, NOW)).toEqual({ status: 'requested' });
    const [, startSec, endSec] = t.client.request.mock.calls[0] as unknown as [string, number, number];
    expect(startSec).toBe(START - 60);
    expect(endSec).toBe(Math.floor(NOW.getTime() / 1000)); // 12 h depois do inicio passaria de agora: limitado a agora
    const older = makeRecovery();
    const OLD = START - 3 * 86400;
    await older.service.requestRecovery("u1", { summaryId: "old-file", startTimeInSeconds: OLD }, NOW);
    const [, oStart, oEnd] = older.client.request.mock.calls[0] as unknown as [string, number, number];
    expect([oStart, oEnd]).toEqual([OLD - 60, OLD + 12 * 3600]); // atividade antiga: janela de 12 h depois do inicio
    expect(endSec - startSec).toBeLessThan(2_592_000);
    expect(t.recorded).toEqual([{ userId: 'u1', type: FIT_RECOVERY_EVENT_PREFIX + 'abc-file', details: expect.objectContaining({ requestId: 'rec-1' }) }]);
    expect(await t.service.requestRecovery('u1', { summaryId: 'abc-file', startTimeInSeconds: START }, NOW)).toEqual({ status: 'already_requested' });
    expect(t.client.request).toHaveBeenCalledTimes(1); // o link recuperado que expire de novo nao gera laco
  });

  it('respeita as autorizacoes: desligado, sem conexao, sem a categoria Atividades ou atividade anterior ao periodo autorizado => nada e pedido', async () => {
    expect(await makeRecovery({ enabled: false }).service.requestRecovery('u1', { summaryId: 'a', startTimeInSeconds: START }, NOW)).toEqual({ status: 'disabled' });
    expect(await makeRecovery({ snapshot: null }).service.requestRecovery('u1', { summaryId: 'a', startTimeInSeconds: START }, NOW)).toEqual({ status: 'not_connected' });
    const noActivity = makeRecovery({ snapshot: { categories: ['profile'], purposes: [], collectFrom: null } });
    expect(await noActivity.service.requestRecovery('u1', { summaryId: 'a', startTimeInSeconds: START }, NOW)).toEqual({ status: 'not_authorized' });
    const before = makeRecovery({ snapshot: { categories: ['profile', 'activity'], purposes: [], collectFrom: new Date('2026-10-21T10:00:00Z') } });
    expect(await before.service.requestRecovery('u1', { summaryId: 'a', startTimeInSeconds: START }, NOW)).toEqual({ status: 'not_authorized' });
    for (const t of [noActivity, before]) expect(t.client.request).not.toHaveBeenCalled();
  });

  it('nao exige a finalidade opcional de historico: recupera atividade NOVA ja autorizada (periodo >= collectFrom)', async () => {
    const t = makeRecovery({ snapshot: { categories: ['profile', 'activity'], purposes: [], collectFrom: new Date('2026-10-21T00:00:00Z') } });
    expect(await t.service.requestRecovery('u1', { summaryId: 'a', startTimeInSeconds: START }, NOW)).toEqual({ status: 'requested' });
  });

  it('429 e falhas NAO marcam como feito (a fila tenta de novo); simultaneo no mesmo aluno responde in_progress', async () => {
    const limited = makeRecovery({ result: { ok: false, kind: 'rate_limited', httpStatus: 429 } });
    expect(await limited.service.requestRecovery('u1', { summaryId: 'a', startTimeInSeconds: START }, NOW)).toEqual({ status: 'rate_limited' });
    expect(limited.recorded).toHaveLength(0);
    const failed = makeRecovery({ result: { ok: false, kind: 'network', httpStatus: null } });
    expect(await failed.service.requestRecovery('u1', { summaryId: 'a', startTimeInSeconds: START }, NOW)).toMatchObject({ status: 'failed', kind: 'network' });
    expect(failed.recorded).toHaveLength(0);
    const slow = makeRecovery();
    const [x, y] = await Promise.all([slow.service.requestRecovery('u1', { summaryId: 'a', startTimeInSeconds: START }, NOW), slow.service.requestRecovery('u1', { summaryId: 'b', startTimeInSeconds: START }, NOW)]);
    expect([x.status, y.status].sort()).toEqual(['in_progress', 'requested']);
  });

  function makeEvents(download: any, recovery: any) {
    const consent = { snapshot: async () => ({ categories: ['profile', 'activity'], purposes: [], collectFrom: new Date('2026-10-01T00:00:00Z') }) };
    const connections = { getAccessToken: async () => 'tok', handleRemoteRevocation: async () => 'closed' };
    const downloader = { download: jest.fn(async () => download) };
    const ingestion = { ingest: jest.fn() };
    const backfill = { requestRecovery: jest.fn(async () => recovery) };
    const service = new ZeppActivityEventService(consent as any, connections as any, downloader as any, ingestion as any, backfill as any);
    const event: any = { id: 'e1', userId: 'u1', eventType: 'activity_file', payload: { summaryId: 'abc-file', callbackURL: CALLBACK, startTimeInSeconds: START, manual: false } };
    return { service, event, backfill, ingestion };
  }

  it('link expirado (410) ou inexistente (404): pede a recuperacao ao Backfill com o summaryId e o horario da atividade; nunca grava nada do evento antigo', async () => {
    for (const kind of ['expired', 'not_found']) {
      const t = makeEvents({ ok: false, kind, httpStatus: kind === 'expired' ? 410 : 404 }, { status: 'requested' });
      const outcome = await t.service.handle(t.event);
      expect(outcome).toMatchObject({ status: 'discard' });
      expect((outcome as any).reason).toContain('recuperacao pelo Backfill solicitada');
      expect(t.backfill.requestRecovery).toHaveBeenCalledWith('u1', { summaryId: 'abc-file', startTimeInSeconds: START });
      expect(t.ingestion.ingest).not.toHaveBeenCalled();
    }
  });

  it('recuperacao adiada (429/ocupado) volta para a fila; sem autorizacao ou Backfill desligado, descarta sem pedir nada', async () => {
    for (const status of ['rate_limited', 'in_progress']) {
      const t = makeEvents({ ok: false, kind: 'expired', httpStatus: 410 }, { status });
      expect(await t.service.handle(t.event)).toMatchObject({ status: 'retry' });
    }
    for (const status of ['disabled', 'not_authorized', 'not_connected', 'already_requested']) {
      const t = makeEvents({ ok: false, kind: 'expired', httpStatus: 410 }, { status });
      expect(await t.service.handle(t.event)).toMatchObject({ status: 'discard' });
    }
    const failedNetwork = makeEvents({ ok: false, kind: 'expired', httpStatus: 410 }, { status: 'failed', kind: 'network', httpStatus: null });
    expect(await failedNetwork.service.handle(failedNetwork.event)).toMatchObject({ status: 'retry' });
    const failedAuth = makeEvents({ ok: false, kind: 'expired', httpStatus: 410 }, { status: 'failed', kind: 'auth', httpStatus: 401 });
    expect(await failedAuth.service.handle(failedAuth.event)).toMatchObject({ status: 'discard' });
  });
});

describe('backfill inicial de 30 dias (so com autorizacao do aluno)', () => {
  const NOW = new Date('2026-10-20T12:00:00Z');
  function make(opts: { enabled?: boolean; snapshot?: any; requested?: boolean; result?: BackfillHttpResult; tokenFails?: boolean } = {}) {
    const snapshot = opts.snapshot === undefined ? { categories: ['profile', 'activity'], purposes: ['history_backfill'], collectFrom: new Date('2026-09-20T12:00:00Z') } : opts.snapshot;
    const consent = { snapshot: jest.fn(async () => snapshot), userIdsWithPurpose: jest.fn(async () => ['u1', 'u2']) };
    const recorded: any[] = [];
    const connections = {
      hasEvent: jest.fn(async (_p: string, userId: string) => opts.requested === true || recorded.some((r) => r.userId === userId)),
      recordEvent: jest.fn(async (_p: string, userId: string, type: string, details: any) => { recorded.push({ userId, type, details }); }),
      getAccessToken: jest.fn(async () => { if (opts.tokenFails) throw new Error('sem token'); return 'token-secreto'; }),
    };
    const client = { request: jest.fn(async (): Promise<BackfillHttpResult> => opts.result ?? { ok: true, requestId: 'req-1' }) };
    const config = { get: (k: string) => (k === 'ZEPP_BACKFILL_ENABLED' ? ((opts.enabled ?? true) ? 'true' : 'false') : undefined) } as unknown as ConfigService;
    return { service: new ZeppBackfillService(consent as any, connections as any, client as any, config), consent, connections, client, recorded };
  }

  it('desligado, sem conexao, sem a finalidade `history_backfill` ou sem a categoria "Atividades": nada e pedido', async () => {
    expect(await make({ enabled: false }).service.request('u1', NOW)).toEqual({ status: 'disabled' });
    expect(await make({ snapshot: null }).service.request('u1', NOW)).toEqual({ status: 'not_connected' });
    for (const snapshot of [{ categories: ['profile', 'activity'], purposes: [], collectFrom: null }, { categories: ['profile'], purposes: ['history_backfill'], collectFrom: null }]) {
      const t = make({ snapshot });
      expect(await t.service.request('u1', NOW)).toEqual({ status: 'not_authorized' });
      expect(t.client.request).not.toHaveBeenCalled();
    }
  });

  it('pede UMA vez, ate 30 dias, nunca antes do periodo autorizado, guarda o requestId e nao repete', async () => {
    const t = make();
    expect(await t.service.request('u1', NOW)).toEqual({ status: 'requested', requestId: 'req-1' });
    const [token, startSec, endSec] = t.client.request.mock.calls[0] as unknown as [string, number, number];
    expect(token).toBe('token-secreto');
    expect(endSec).toBe(Math.floor(NOW.getTime() / 1000));
    expect(endSec - startSec).toBeLessThanOrEqual(2_592_000); // limite da Zepp
    expect(startSec).toBeGreaterThanOrEqual(Math.floor(new Date('2026-09-20T12:00:00Z').getTime() / 1000)); // collectFrom
    expect(t.recorded).toEqual([{ userId: 'u1', type: BACKFILL_EVENT, details: expect.objectContaining({ requestId: 'req-1' }) }]);
    expect(await t.service.request('u1', NOW)).toEqual({ status: 'already_requested' });
    expect(t.client.request).toHaveBeenCalledTimes(1);
  });

  it('collectFrom ausente (ou muito antigo): usa os ultimos 30 dias, nunca mais que isso', async () => {
    const t = make({ snapshot: { categories: ['profile', 'activity'], purposes: ['history_backfill'], collectFrom: new Date('2025-01-01T00:00:00Z') } });
    await t.service.request('u1', NOW);
    const [, startSec, endSec] = t.client.request.mock.calls[0] as unknown as [string, number, number];
    expect(endSec - startSec).toBeLessThanOrEqual(2_592_000);
    expect(endSec - startSec).toBeGreaterThan(2_592_000 - 3600);
  });

  it('429 / falhas NAO marcam como feito (tenta de novo depois); teto interno por hora e protecao contra pedidos simultaneos', async () => {
    const limited = make({ result: { ok: false, kind: 'rate_limited', httpStatus: 429 } });
    expect(await limited.service.request('u1', NOW)).toEqual({ status: 'rate_limited' });
    expect(limited.recorded).toHaveLength(0);
    const failed = make({ result: { ok: false, kind: 'server', httpStatus: 500 } });
    expect(await failed.service.request('u1', NOW)).toMatchObject({ status: 'failed', kind: 'server' });
    expect(failed.recorded).toHaveLength(0);
    expect(await make({ tokenFails: true }).service.request('u1', NOW)).toMatchObject({ status: 'failed', kind: 'auth' });

    const budget = make({ result: { ok: false, kind: 'server', httpStatus: 500 } });
    for (let i = 0; i < 40; i += 1) await budget.service.request(`u${i}`, NOW);
    expect(await budget.service.request('u99', NOW)).toEqual({ status: 'rate_limited' }); // 41o pedido na mesma hora: nem chega a Zepp
    expect(budget.client.request).toHaveBeenCalledTimes(40);

    const slow = make();
    const [a, b] = await Promise.all([slow.service.request('u1', NOW), slow.service.request('u1', NOW)]);
    expect([a.status, b.status].sort()).toEqual(['in_progress', 'requested']);
  });

  it('o contrato generico de busca ativa devolve ok/rate_limited/not_connected', async () => {
    expect(await make().service.sync({ userId: 'u1' })).toEqual({ status: 'ok' });
    expect(await make({ snapshot: null }).service.sync({ userId: 'u1' })).toEqual({ status: 'not_connected' });
    expect(await make({ result: { ok: false, kind: 'rate_limited', httpStatus: 429 } }).service.sync({ userId: 'u1' })).toEqual({ status: 'rate_limited' });
  });

  it('a rotina automatica so pede para quem concedeu a finalidade e para ao primeiro 429', async () => {
    const t = make();
    await t.service.requestPending();
    expect(t.consent.userIdsWithPurpose).toHaveBeenCalledWith('zepp', 'history_backfill');
    expect(t.client.request).toHaveBeenCalledTimes(2);
    const off = make({ enabled: false });
    await off.service.requestPending();
    expect(off.consent.userIdsWithPurpose).not.toHaveBeenCalled();
  });
});

describe('caminho ate o Atlas com dados sinteticos (elegibilidade e procedencia do Lote 1)', () => {
  const approved = EXTERNAL_AI_APPROVED_PROVIDERS as string[];
  afterEach(() => { const i = approved.indexOf('zepp'); if (i >= 0) approved.splice(i, 1); });

  // Autorizacao registrada sobre o texto VIGENTE da tela do Atlas (versao + hash), como a API grava ao conceder.
  const atlas = ZEPP_CONSENT.optionalPurposes.find((p) => p.id === 'ai_external')!;
  const currentRecord = { ai_external: { version: atlas.screen!.version, textHash: purposeTextHash(atlas), grantedAt: '2026-10-20T12:00:00.000Z' } };
  function setup(grantedPurposes: string[], env: Record<string, string> = {}, purposeConsents: unknown = currentRecord) {
    const registry = new ConnectorRegistry();
    registry.register(buildZeppConnector({ get: () => undefined } as unknown as ConfigService));
    const prisma: any = {
      providerConnection: { findUnique: async () => ({ disconnectedAt: null, grantedCategories: ['profile', 'activity', 'activity_sensors'], grantedPurposes, purposeConsents }) },
      activityLog: { findMany: async () => [{ provider: 'zepp' }] },
    };
    return new AiDataEligibility(prisma, registry, { get: (k: string) => env[k] } as unknown as ConfigService);
  }

  it('dado REAL da Zepp continua bloqueado para a IA externa: constante vazia mesmo com finalidade concedida e variavel ligada', async () => {
    expect(EXTERNAL_AI_APPROVED_PROVIDERS).toEqual([]);
    const eligibility = setup(['history', 'ai_external'], { ZEPP_EXTERNAL_AI_ENABLED: 'true' });
    expect(await eligibility.decide('u1', 'zepp', { category: 'activity', destination: 'external_ai' })).toEqual({ allowed: false, reason: 'provider_locked' });
    expect((await eligibility.scopeFor('u1', 'external_ai')).blocked).toEqual(['zepp']);
  });

  it('com a trava hipoteticamente aberta (so no teste) o dado e liberado APENAS com a finalidade `ai_external` concedida', async () => {
    approved.push('zepp');
    const env = { ZEPP_EXTERNAL_AI_ENABLED: 'true' };
    expect((await setup(['history'], env).decide('u1', 'zepp', { category: 'activity', destination: 'external_ai' })).reason).toBe('purpose_not_granted');
    expect(await setup(['history', 'ai_external'], env).decide('u1', 'zepp', { category: 'activity', destination: 'external_ai' })).toEqual({ allowed: true, reason: 'allowed' });
  });

  it('autorizacao dada sobre um texto que depois mudou (ou sem registro de versao) NAO vale: exige nova autorizacao', async () => {
    approved.push('zepp');
    const env = { ZEPP_EXTERNAL_AI_ENABLED: 'true' };
    const outdated = { ai_external: { ...currentRecord.ai_external, version: '0.9' } };
    const changedHash = { ai_external: { ...currentRecord.ai_external, textHash: 'a'.repeat(64) } };
    for (const records of [outdated, changedHash, null, {}]) {
      expect((await setup(['history', 'ai_external'], env, records).decide('u1', 'zepp', { category: 'activity', destination: 'external_ai' })).reason).toBe('purpose_not_granted');
    }
  });

  it('dentro do escopo de IA a leitura de atividades exclui o provedor bloqueado (o Atlas nunca le dado Zepp sem autorizacao)', async () => {
    expect(aiActivityWhere()).toEqual({});
    await runWithAiScope({ userId: 'u1', destination: 'external_ai', blocked: ['zepp'], computedAt: Date.now() }, async () => {
      expect(aiActivityWhere()).toEqual({ provider: { notIn: ['zepp'] } });
    });
  });

  it('potencia e ganho de elevacao viram observacoes do Atlas (corrida, so quando existem; nunca zero inventado) e carregam o provedor', async () => {
    expect(VARIABLE_REGISTRY['activity.powerAvgWatts']).toMatchObject({ source: 'activity_objective', missingPolicy: 'never_impute' });
    expect(VARIABLE_REGISTRY['activity.elevationGainMeters']).toMatchObject({ source: 'activity_objective', missingPolicy: 'never_impute' });
    const logs = [
      { id: 'a', userId: 'u1', provider: 'zepp', sport: 'corrida', startedAt: new Date('2026-10-18T09:00:00Z'), distanceMeters: 8000, durationSec: 2400, cadenceAvg: null, powerAvgWatts: 210, elevationGainMeters: 25, physicalIdentityStatus: null },
      { id: 'b', userId: 'u1', provider: 'zepp', sport: 'corrida', startedAt: new Date('2026-10-19T09:00:00Z'), distanceMeters: 5000, durationSec: 1500, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: 0, physicalIdentityStatus: null },
      { id: 'c', userId: 'u1', provider: 'zepp', sport: 'esteira', startedAt: new Date('2026-10-19T10:00:00Z'), distanceMeters: 5000, durationSec: 1500, cadenceAvg: null, powerAvgWatts: 300, elevationGainMeters: 5, physicalIdentityStatus: null },
    ];
    const prisma: any = { activityLog: { findMany: async () => logs } };
    const reader = Object.create(ObservationReaderService.prototype) as any;
    reader.prisma = prisma;
    const read = (id: string) => reader.readActivityObjectiveVariable('u1', VARIABLE_REGISTRY[id]);
    const power = await read('activity.powerAvgWatts');
    expect(power.map((o: any) => [o.context.activityLogId, o.value, o.context.provider])).toEqual([['a', 210, 'zepp']]);
    const elevation = await read('activity.elevationGainMeters');
    expect(elevation.map((o: any) => [o.context.activityLogId, o.value])).toEqual([['a', 25], ['b', 0]]); // 0 e valor valido; esteira nao e' corrida de rua
  });
});

describe('o Panzeri Run segue com TODAS as integracoes existentes intactas', () => {
  it('Polar, Wahoo, Strava, Apple Health e Health Connect nao referenciam nada novo da Zepp', () => {
    for (const dir of ['polar', 'wahoo', 'strava', 'apple-health', 'health-connect']) {
      const base = join(__dirname, '..', 'src', dir);
      for (const file of require('node:fs').readdirSync(base).filter((f: string) => f.endsWith('.ts'))) {
        expect(readFileSync(join(base, file), 'utf8')).not.toMatch(/zepp/i);
      }
    }
  });
});
