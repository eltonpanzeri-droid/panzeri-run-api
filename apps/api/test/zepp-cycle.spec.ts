import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { buildSyntheticFit } from './helpers/synthetic-fit';
import { readZeppFit } from '../src/zepp/zepp-fit';
import { parseZeppWebhook, toInboundDrafts } from '../src/zepp/zepp-webhook';
import { ZeppExactLinkService } from '../src/zepp/zepp-exact-link.service';
import { ZeppActivityIngestionService } from '../src/zepp/zepp-activity-ingestion.service';
import { BACKFILL_EVENT, ZeppBackfillService, BackfillHttpResult } from '../src/zepp/zepp-backfill.service';
import { ZEPP_EXECUTED_WORKOUT_ID_FIELD } from '../src/zepp/zepp-workout-profile';
import { ZEPP_WORKOUT_PROVIDER } from '../src/zepp/zepp-workout-publisher.service';
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

describe('vinculo exato com o treino publicado (so quando a Zepp confirmar o campo)', () => {
  it('hoje o campo NAO esta confirmado: o parser ignora qualquer id e nenhum vinculo exato e tentado', () => {
    expect(ZEPP_EXECUTED_WORKOUT_ID_FIELD).toBeNull();
    const content = parseZeppWebhook(body(record({ workoutId: 123456 })), { publishedWorkoutIdField: ZEPP_EXECUTED_WORKOUT_ID_FIELD });
    expect(content.activityFiles[0].publishedWorkoutId).toBeNull();
    expect(toInboundDrafts(content)[0].payload).not.toHaveProperty('publishedWorkoutId');
  });

  it('com o campo hipoteticamente confirmado, o id viaja no evento (e so ele; campo invalido e ignorado)', () => {
    const ok = parseZeppWebhook(body(record({ workoutId: 123456 })), { publishedWorkoutIdField: 'workoutId' });
    expect(ok.activityFiles[0].publishedWorkoutId).toBe('123456');
    expect(toInboundDrafts(ok)[0].payload).toMatchObject({ publishedWorkoutId: '123456' });
    expect(parseZeppWebhook(body(record({ workoutId: 1 })), { publishedWorkoutIdField: 'a.b; DROP' }).activityFiles[0].publishedWorkoutId).toBeNull();
    expect(parseZeppWebhook(body(record({ workoutId: { x: 1 } })), { publishedWorkoutIdField: 'workoutId' }).activityFiles[0].publishedWorkoutId).toBeNull();
  });

  function makeLink(opts: { activity?: any; delivery?: any; session?: any } = {}) {
    const activity = opts.activity === undefined ? { id: 'a1', userId: 'u1', executionClassification: null, physicalIdentityStatus: 'unique' } : opts.activity;
    const prisma: any = {
      activityLog: { findUnique: jest.fn(async () => activity) },
      workoutDelivery: { findFirst: jest.fn(async () => (opts.delivery === undefined ? { trainingSessionId: 's1' } : opts.delivery)) },
      trainingSession: { findFirst: jest.fn(async () => (opts.session === undefined ? { id: 's1', executionLinks: [] } : opts.session)) },
    };
    const links = { linkManually: jest.fn(async () => ({ id: 'l1' })) };
    return { service: new ZeppExactLinkService(prisma, links as any), prisma, links };
  }

  it('vincula com o treino cujo workoutId foi publicado (automatico, metodo zepp_workout_id) so dentro do proprio aluno e de entregas aceitas pela Zepp', async () => {
    const t = makeLink();
    expect(await t.service.tryLink('u1', 'a1', '123456')).toBe('linked');
    expect(t.links.linkManually).toHaveBeenCalledWith(expect.objectContaining({ trainingSessionId: 's1', activityLogId: 'a1', origin: 'automatic', matchMethod: 'zepp_workout_id', confidence: 'exact' }));
    const where = t.prisma.workoutDelivery.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ provider: ZEPP_WORKOUT_PROVIDER, externalWorkoutId: '123456', status: { in: ['sent', 'canceled'] }, trainingSession: { userId: 'u1' } });
  });

  it('nao sobrescreve nada: atividade ja decidida, treino ja vinculado a outra atividade, identidade com varias observacoes, id desconhecido, atividade de outro aluno', async () => {
    expect(await makeLink({ activity: { id: 'a1', userId: 'u1', executionClassification: 'alternative', physicalIdentityStatus: 'unique' } }).service.tryLink('u1', 'a1', '1')).toBe('already_decided');
    expect(await makeLink({ session: { id: 's1', executionLinks: [{ id: 'x' }] } }).service.tryLink('u1', 'a1', '1')).toBe('session_taken');
    for (const status of ['matched', 'ambiguous']) {
      const t = makeLink({ activity: { id: 'a1', userId: 'u1', executionClassification: null, physicalIdentityStatus: status } });
      expect(await t.service.tryLink('u1', 'a1', '1')).toBe('identity_pending');
      expect(t.links.linkManually).not.toHaveBeenCalled();
    }
    expect(await makeLink({ delivery: null }).service.tryLink('u1', 'a1', '999')).toBe('no_delivery');
    expect(await makeLink({ activity: { id: 'a1', userId: 'outro', executionClassification: null } }).service.tryLink('u1', 'a1', '1')).toBe('not_found');
  });

  it('a ingestao so tenta o vinculo exato quando o evento traz o id, ANTES de classificar, e uma falha nao derruba a gravacao', async () => {
    const order: string[] = [];
    const tx: any = {
      rawExternalActivity: { upsert: async () => ({ id: 'raw1' }) },
      activityLog: { upsert: async () => ({ id: 'log1' }) },
      activityTimeSeriesPoint: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    };
    const consent = { writeWhileAuthorized: async (_p: string, _u: string, write: any) => write(tx, { categories: ['profile', 'activity'], purposes: [] }) };
    const link = { classify: jest.fn(async () => { order.push('classify'); return 'corresponding'; }), reconcileAffectedByIdentity: async () => undefined };
    const exact = { tryLink: jest.fn(async () => { order.push('exact'); throw new Error('falha'); }) };
    const service = new ZeppActivityIngestionService({} as any, consent as any, link as any, { notifyReconciliation: async () => undefined } as any, { evaluateSafely: async () => undefined } as any, exact as any);
    const fit = await readZeppFit(buildSyntheticFit({ seconds: 10 }));
    const meta = { summaryId: 's', activityId: null, activityType: null, deviceName: null, source: 'webhook' as const };
    expect(await service.ingest('u1', { ...meta, publishedWorkoutId: '123456' }, fit)).toMatchObject({ written: true, classification: 'corresponding' });
    expect(order).toEqual(['exact', 'classify']);
    order.length = 0;
    await service.ingest('u1', meta, fit);
    expect(order).toEqual(['classify']); // sem id no evento: nenhum vinculo exato
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
