import { ConfigService } from '@nestjs/config';
import { parseZeppWebhook, toInboundDrafts } from '../src/zepp/zepp-webhook';
import { ZeppWebhookController } from '../src/zepp/zepp-webhook.controller';
import { ZEPP_HEALTH_EVENT_TYPES, ZeppHealthEventService } from '../src/zepp/zepp-health-events.service';
import { ZeppActivityEventService } from '../src/zepp/zepp-activity-events.service';
import { ZeppDataDeletionService } from '../src/zepp/zepp-data-deletion.service';
import { ZEPP_CONSENT } from '../src/zepp/zepp-consent';
import { buildZeppConnector } from '../src/zepp/zepp.connector';
import { PROVIDER_DATA_CATEGORIES } from '../src/provider-hub/provider-connector';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';
import { purposeTextHash } from '../src/provider-hub/provider-consent.service';
import { AiDataEligibility, EXTERNAL_AI_APPROVED_PROVIDERS } from '../src/ai-governance/ai-data-eligibility.service';
import { AiEgressGuard } from '../src/ai-governance/ai-egress.guard';
import { isHealthBlockedForAi, runWithAiScope } from '../src/ai-governance/ai-scope';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { VARIABLE_REGISTRY } from '../src/training-intelligence/variable-registry';

// Saude e recuperacao da Zepp (sono, diario, HRV) — 21/10/2026. Dados sinteticos no formato da documentacao oficial (devopen.zepp.com): corpo `text/plain` = array JSON de STRINGS, cada
// uma com a chave `sleeps`, `dailies` ou `hrv`. Nenhum dado real. Garantias testadas: so' o que a Zepp mede e entrega (ausente = nulo, nunca zero nem estimativa), FC de repouso so' do evento
// diario, idempotencia sem `summaryId`, consentimento por categoria (inclusive dentro da trava e na IA) e rastreabilidade.

const sleepRecord = (over: Record<string, unknown> = {}) => ({
  userId: 'zx', summaryId: null, calendarDate: '2026-10-20', startTimeInSeconds: 1792540800, startTimeOffsetInSeconds: -10800, durationInSeconds: 23160, totalNapDurationInSeconds: 1680, unmeasurableSleepInSeconds: 0,
  deepSleepDurationInSeconds: 4380, lightSleepDurationInSeconds: 13080, remSleepInSeconds: 5700, awakeDurationInSeconds: 780,
  sleepLevelsMap: { deep: [{ startTimeInSeconds: 1792543200, endTimeInSeconds: 1792543739 }], light: [{ startTimeInSeconds: 1792540800, endTimeInSeconds: 1792541519 }], rem: [{ startTimeInSeconds: 1792547820, endTimeInSeconds: 1792563960 }], awake: [] },
  validation: 'AUTO_TENTATIVE', timeOffsetSleepRespiration: null, timeOffsetSleepSpo2: null, overallSleepScore: { value: 64, qualifierKey: 'FAIR' }, sleepScores: null,
  naps: [{ napDurationInSeconds: 1680, napStartTimeInSeconds: 1792586220, napValidation: 'DEVICE', napOffsetInSeconds: -10800 }], ...over,
});
const dailyRecord = (over: Record<string, unknown> = {}) => ({ userId: 'zx', summaryId: 'daily-1792454400', calendarDate: '2026-10-20', startTimeInSeconds: 1792454400, startTimeOffsetInSeconds: -10800, durationInSeconds: 86400, steps: 8523, distanceInMeters: 6215, activeKilocalories: 1842, restingHeartRateInBeatsPerMinute: 62, stepsGoal: 10000, ...over });
const hrvRecord = (over: Record<string, unknown> = {}) => ({ userId: 'zx', summaryId: null, calendarDate: '2026-10-20', startTimeInSeconds: 1792540800, durationInSeconds: null, startTimeOffsetInSeconds: -10800, lastNightAvg: 48.5, hrvValues: { '5min': { '1792540800': 51.2 } }, ...over });
const body = (key: string, ...records: unknown[]) => JSON.stringify([JSON.stringify({ [key]: records })]);

describe('webhook: sono, diario e HRV (formato oficial)', () => {
  it('le os tres tipos; so entram os campos que a Zepp informou, sem converter nem completar', () => {
    const sleep = parseZeppWebhook(body('sleeps', sleepRecord())).healthRecords[0] as any;
    expect(sleep).toMatchObject({ kind: 'sleep', userId: 'zx', summaryId: null, calendarDate: '2026-10-20', startTimeSec: 1792540800, startOffsetSec: -10800, durationSec: 23160, deepSleepSec: 4380, lightSleepSec: 13080, remSleepSec: 5700, awakeSec: 780, napTotalSec: 1680, scoreValue: 64, scoreQualifier: 'FAIR', validation: 'AUTO_TENTATIVE' });
    expect(sleep.endTimeSec).toBe(1792563960); // maior fim entre os segmentos informados — nunca estimado
    expect(sleep.naps).toEqual([{ durationSec: 1680, startTimeSec: 1792586220, validation: 'DEVICE', offsetSec: -10800 }]);
    expect(sleep.levels.awake).toBeUndefined(); // etapa sem segmento nao e inventada
    const daily = parseZeppWebhook(body('dailies', dailyRecord())).healthRecords[0] as any;
    expect(daily).toMatchObject({ kind: 'daily', steps: 8523, distanceMeters: 6215, activeKilocalories: 1842, restingHeartRateBpm: 62, stepsGoal: 10000, summaryId: 'daily-1792454400' });
    const hrv = parseZeppWebhook(body('hrv', hrvRecord())).healthRecords[0] as any;
    expect(hrv).toMatchObject({ kind: 'hrv', lastNightAvg: 48.5, durationSec: null });
    expect(hrv.hrvValues).toEqual({ '5min': { '1792540800': 51.2 } });
  });

  it('campo ausente ou fora da faixa fisica vira NULO (nunca zero nem correcao); registro sem identidade ou HRV sem media e ignorado', () => {
    const bare = parseZeppWebhook(body('sleeps', { userId: 'zx', calendarDate: '2026-10-20', startTimeInSeconds: 1792540800, startTimeOffsetInSeconds: 0 })).healthRecords[0] as any;
    expect(bare).toMatchObject({ durationSec: null, deepSleepSec: null, scoreValue: null, endTimeSec: null, levels: null, naps: null });
    const wild = parseZeppWebhook(body('dailies', dailyRecord({ steps: -5, restingHeartRateInBeatsPerMinute: 900, distanceInMeters: 'abc' }))).healthRecords[0] as any;
    expect(wild).toMatchObject({ steps: null, restingHeartRateBpm: null, distanceMeters: null });
    const content = parseZeppWebhook(JSON.stringify([JSON.stringify({ sleeps: [sleepRecord({ calendarDate: 'ontem' }), sleepRecord({ userId: 'x y' }), 5, null] }), JSON.stringify({ hrv: [hrvRecord({ lastNightAvg: null }), hrvRecord({ lastNightAvg: 'x' })] })]));
    expect(content.healthRecords).toHaveLength(0);
    expect(content.ignored).toBe(6);
  });

  it('o evento de SONO nunca fornece FC de repouso: mesmo que o corpo traga o campo, ele nao e lido', () => {
    const sleep = parseZeppWebhook(body('sleeps', sleepRecord({ restingHeartRateInBeatsPerMinute: 55 }))).healthRecords[0] as any;
    expect(sleep).not.toHaveProperty('restingHeartRateBpm');
    expect(JSON.stringify(sleep)).not.toContain('55');
  });

  it('fila: categoria certa por tipo, chave estavel para o MESMO envio e nova para conteudo atualizado, e o payload nao leva userId nem tipo', () => {
    const drafts = (key: string, record: unknown) => toInboundDrafts(parseZeppWebhook(body(key, record)));
    const [s1] = drafts('sleeps', sleepRecord());
    const [s2] = drafts('sleeps', sleepRecord());
    const [s3] = drafts('sleeps', sleepRecord({ durationInSeconds: 24000 })); // resumo ATUALIZADO (mesmo dia e inicio)
    expect(s1).toMatchObject({ category: 'sleep', eventType: 'sleep_summary', externalAccountId: 'zx' });
    expect(s1.dedupeKey).toBe(s2.dedupeKey);
    expect(s3.dedupeKey).not.toBe(s1.dedupeKey);
    expect(s1.dedupeKey).toMatch(/^sleep:zx:2026-10-20:1792540800:[0-9a-f]{16}$/);
    expect(drafts('dailies', dailyRecord())[0]).toMatchObject({ category: 'daily_activity', eventType: 'daily_summary' });
    expect(drafts('hrv', hrvRecord())[0]).toMatchObject({ category: 'hrv', eventType: 'hrv_summary' });
    expect(s1.payload).not.toHaveProperty('userId');
    expect(s1.payload).not.toHaveProperty('kind');
    expect(ZEPP_HEALTH_EVENT_TYPES).toEqual(['sleep_summary', 'daily_summary', 'hrv_summary', 'metric_summary']);
  });
});

describe('receptor do webhook: saude entra pela MESMA URL, 204 rapido, e o teste do portal (sem corpo) nao grava nada', () => {
  const SECRET = 's'.repeat(40);
  function make() {
    const events = { record: jest.fn(async () => ({ created: true, id: 'e1' })) };
    const consent = { resolveActiveUserId: jest.fn(async (_p: string, external: string) => (external === 'zx' ? 'u1' : null)) };
    const controller = new ZeppWebhookController({ get: (k: string) => (k === 'ZEPP_WEBHOOK_SECRET' ? SECRET : undefined) } as any, events as any, consent as any);
    return { controller, events };
  }
  const req = (text: string) => ({ body: text }) as any;
  it('sono, diario e HRV de conta ativa viram eventos; conta desconhecida e ignorada em silencio', async () => {
    const t = make();
    await t.controller.receive(SECRET, req(JSON.stringify([JSON.stringify({ sleeps: [sleepRecord()] }), JSON.stringify({ dailies: [dailyRecord(), dailyRecord({ userId: 'desconhecida' })] }), JSON.stringify({ hrv: [hrvRecord()] })])));
    expect(t.events.record.mock.calls.map((c: any[]) => c[1].eventType)).toEqual(['sleep_summary', 'daily_summary', 'hrv_summary']);
  });
  it('corpo vazio (teste de cadastro do portal) com o segredo certo: 2xx e nada gravado; segredo errado: 404', async () => {
    const t = make();
    await expect(t.controller.receive(SECRET, req(''))).resolves.toBeUndefined();
    expect(t.events.record).not.toHaveBeenCalled();
    await expect(t.controller.receive('errado', req(''))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
function makeHealth(opts: { categories?: string[]; collectFrom?: Date | null; snapshot?: unknown; lockCategories?: string[] | null } = {}) {
  const rows: Record<string, any[]> = { sleep: [], daily: [], hrv: [], metric: [] };
  const upsert = (kind: string) => jest.fn(async ({ where, create, update }: any) => {
    const key = JSON.stringify(where);
    const existing = rows[kind].find((r) => r.key === key);
    if (existing) Object.assign(existing, update); else rows[kind].push({ key, ...create });
  });
  const tx = { wearableSleepSummary: { upsert: upsert('sleep') }, wearableDailySummary: { upsert: upsert('daily') }, wearableHrvSummary: { upsert: upsert('hrv') }, wearableMetricRecord: { upsert: upsert('metric') } };
  const categories = opts.categories ?? ['profile', 'sleep', 'hrv', 'daily_activity', 'resting_heart_rate'];
  const snapshot = opts.snapshot === undefined ? { categories, purposes: [], collectFrom: opts.collectFrom === undefined ? new Date('2026-10-01T00:00:00Z') : opts.collectFrom } : opts.snapshot;
  const consent = {
    snapshot: jest.fn(async () => snapshot),
    writeWhileAuthorized: jest.fn(async (_p: string, _u: string, write: any) => write(tx, { categories: opts.lockCategories === undefined ? categories : (opts.lockCategories ?? []), purposes: [] })),
  };
  const service = new ZeppHealthEventService(consent as any);
  const event = (eventType: string, payload: Record<string, unknown>): any => ({ id: 'e1', provider: 'zepp', eventType, userId: 'u1', externalAccountId: 'zx', payload, attempt: 1 });
  const payloadOf = (key: string, record: unknown) => { const [draft] = toInboundDrafts(parseZeppWebhook(body(key, record))); return { type: draft.eventType, payload: draft.payload }; };
  return { service, consent, rows, event, payloadOf };
}

describe('processamento de saude e recuperacao (consentimento por categoria, idempotencia, sem inventar)', () => {
  it('grava o sono com os valores da Zepp (nulos continuam nulos) e regrava o MESMO resumo sem duplicar', async () => {
    const t = makeHealth();
    const { type, payload } = t.payloadOf('sleeps', sleepRecord({ deepSleepDurationInSeconds: null }));
    expect(await t.service.handle(t.event(type, payload))).toEqual({ status: 'done' });
    expect(t.rows.sleep).toHaveLength(1);
    expect(t.rows.sleep[0]).toMatchObject({ userId: 'u1', provider: 'zepp', calendarDate: '2026-10-20', startTimeSec: 1792540800, startOffsetSec: -10800, durationSec: 23160, deepSleepSec: null, remSleepSec: 5700, scoreValue: 64, endTimeSec: 1792563960, providerSummaryId: null });
    const updated = t.payloadOf('sleeps', sleepRecord({ durationInSeconds: 24000 }));
    await t.service.handle(t.event(updated.type, updated.payload));
    expect(t.rows.sleep).toHaveLength(1); // mesma identidade (aluno + dia + inicio): atualiza
    expect(t.rows.sleep[0].durationSec).toBe(24000);
  });

  it('diario: FC de repouso so e guardada com a categoria PROPRIA; sem ela o campo fica nulo e o resto do dia e guardado', async () => {
    const full = makeHealth();
    const d = full.payloadOf('dailies', dailyRecord());
    await full.service.handle(full.event(d.type, d.payload));
    expect(full.rows.daily[0]).toMatchObject({ steps: 8523, distanceMeters: 6215, activeKilocalories: 1842, restingHeartRateBpm: 62, stepsGoal: 10000 });
    const noResting = makeHealth({ categories: ['profile', 'daily_activity'] });
    await noResting.service.handle(noResting.event(d.type, d.payload));
    expect(noResting.rows.daily[0]).toMatchObject({ steps: 8523, restingHeartRateBpm: null });
  });

  it('HRV: guarda a media da noite como a Zepp informou (sem converter unidade)', async () => {
    const t = makeHealth();
    const h = t.payloadOf('hrv', hrvRecord());
    await t.service.handle(t.event(h.type, h.payload));
    expect(t.rows.hrv[0]).toMatchObject({ lastNightAvg: 48.5, hrvValues: { '5min': { '1792540800': 51.2 } } });
  });

  it('sem a categoria autorizada, antes do periodo autorizado, no futuro, conexao encerrada ou categoria retirada no meio do processamento: nada e gravado', async () => {
    const s = t0('sleeps', sleepRecord());
    function t0(key: string, record: unknown) { return makeHealth().payloadOf(key, record); }
    const noSleep = makeHealth({ categories: ['profile', 'hrv'] });
    expect(await noSleep.service.handle(noSleep.event(s.type, s.payload))).toMatchObject({ status: 'discard', reason: 'categoria nao autorizada pelo aluno' });
    const before = makeHealth({ collectFrom: new Date('2026-10-22T00:00:00Z') });
    expect(await before.service.handle(before.event(s.type, s.payload))).toMatchObject({ status: 'discard', reason: 'anterior ao periodo autorizado' });
    const future = makeHealth().payloadOf('sleeps', sleepRecord({ startTimeInSeconds: Math.floor(Date.now() / 1000) + 5 * 86400 }));
    const fut = makeHealth({ collectFrom: null });
    expect(await fut.service.handle(fut.event(future.type, future.payload))).toMatchObject({ status: 'discard', reason: 'data de inicio no futuro' });
    const closed = makeHealth({ snapshot: null });
    expect(await closed.service.handle(closed.event(s.type, s.payload))).toMatchObject({ status: 'discard', reason: 'conexao encerrada' });
    const retired = makeHealth({ lockCategories: ['profile'] }); // retirada DEPOIS da checagem e ANTES da gravacao
    expect(await retired.service.handle(retired.event(s.type, s.payload))).toMatchObject({ status: 'discard' });
    for (const t of [noSleep, before, fut, closed, retired]) expect(t.rows.sleep).toHaveLength(0);
  });

  it('evento invalido ou de tipo desconhecido e descartado', async () => {
    const t = makeHealth();
    expect(await t.service.handle(t.event('sleep_summary', { calendarDate: 'x' }))).toMatchObject({ status: 'discard' });
    expect(await t.service.handle(t.event('cardio_summary', { calendarDate: '2026-10-20', startTimeSec: 1792540800, startOffsetSec: 0 }))).toMatchObject({ status: 'discard' });
    expect(await t.service.handle({ ...t.event('sleep_summary', {}), userId: null })).toMatchObject({ status: 'discard' });
  });

  it('o processador de eventos da Zepp encaminha sono/diario/HRV ao servico de saude (e descarta se ele nao existir)', async () => {
    const health = { handle: jest.fn(async () => ({ status: 'done' as const })) };
    const router = new ZeppActivityEventService({} as any, {} as any, {} as any, {} as any, undefined, health as any);
    for (const type of ZEPP_HEALTH_EVENT_TYPES) expect(await router.handle({ id: 'e', provider: 'zepp', eventType: type, userId: 'u1', externalAccountId: 'zx', payload: {}, attempt: 1 })).toEqual({ status: 'done' });
    expect(health.handle).toHaveBeenCalledTimes(4);
    const alone = new ZeppActivityEventService({} as any, {} as any, {} as any, {} as any);
    expect(await alone.handle({ id: 'e', provider: 'zepp', eventType: 'sleep_summary', userId: 'u1', externalAccountId: 'zx', payload: {}, attempt: 1 })).toMatchObject({ status: 'discard' });
  });

  it('excluir os dados da Zepp apaga tambem os resumos de saude do provedor (e so deste aluno)', async () => {
    const calls: Array<[string, unknown]> = [];
    const del = (name: string) => ({ deleteMany: jest.fn(async (args: unknown) => { calls.push([name, args]); return { count: 1 }; }) });
    const prisma: any = { wearableSleepSummary: del('sleep'), wearableDailySummary: del('daily'), wearableHrvSummary: del('hrv'), wearableMetricRecord: del('metric'), workoutDelivery: del('delivery'), providerInboundEvent: del('events') };
    await new ZeppDataDeletionService(prisma).deleteUserData({ userId: 'u1' });
    for (const name of ['sleep', 'daily', 'hrv', 'metric']) expect(calls.find(([n]) => n === name)![1]).toEqual({ where: { provider: 'zepp', userId: 'u1' } });
  });
});

describe('consentimento: grupos de saude (autorizacao propria, independente, simples)', () => {
  it('sono, saude diaria e HRV sao grupos opcionais e independentes das atividades; cada categoria e do vocabulario e o conector a declara', () => {
    const byId = Object.fromEntries(ZEPP_CONSENT.groups.map((g) => [g.id, g]));
    expect(byId.sleep).toMatchObject({ required: false, categories: ['sleep'] });
    expect(byId.daily).toMatchObject({ required: false, categories: ['daily_activity', 'resting_heart_rate'] });
    expect(byId.hrv).toMatchObject({ required: false, categories: ['hrv'] });
    for (const id of ['sleep', 'daily', 'hrv']) expect(byId[id].requires).toBeUndefined();
    const connector = buildZeppConnector({ get: () => undefined } as unknown as ConfigService);
    for (const group of ZEPP_CONSENT.groups) for (const category of group.categories) { expect(PROVIDER_DATA_CATEGORIES).toContain(category); expect(connector.categories).toContain(category); }
    expect(ZEPP_CONSENT.version).toBe('2.1');
  });

  it('o Atlas continua sendo autorizacao propria, externa e opcional (tela v1.1 cita sono, HRV e saude diaria)', () => {
    const atlas = ZEPP_CONSENT.optionalPurposes.find((p) => p.id === 'ai_external')!;
    expect(atlas).toMatchObject({ external: true, changeableAfterConnect: true });
    expect(atlas.screen!.version).toBe('1.1');
    expect(atlas.screen!.paragraphs.join(' ')).toMatch(/sono, HRV, frequência cardíaca de repouso e saúde diária/);
    expect(ZEPP_CONSENT.purposes).not.toContain('ai_external');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('IA: saude e recuperacao so entram com a categoria E o Atlas autorizados', () => {
  const atlas = ZEPP_CONSENT.optionalPurposes.find((p) => p.id === 'ai_external')!;
  const record = { ai_external: { version: atlas.screen!.version, textHash: purposeTextHash(atlas), grantedAt: '2026-10-21T12:00:00.000Z' } };
  function eligibility(grantedCategories: string[], grantedPurposes: string[], env: Record<string, string> = { ZEPP_EXTERNAL_AI_ENABLED: 'true' }) {
    const registry = new ConnectorRegistry();
    registry.register(buildZeppConnector({ get: () => undefined } as unknown as ConfigService));
    const prisma: any = {
      providerConnection: { findUnique: async () => ({ disconnectedAt: null, grantedCategories, grantedPurposes, purposeConsents: record }) },
      activityLog: { findMany: async () => [] },
    };
    return new AiDataEligibility(prisma, registry, { get: (k: string) => env[k] } as unknown as ConfigService);
  }

  it('o escopo bloqueia, por categoria, o que o aluno nao autorizou (e tudo se o Atlas nao foi autorizado ou a variavel esta desligada)', async () => {
    expect(EXTERNAL_AI_APPROVED_PROVIDERS).toContain('zepp');
    const partial = await eligibility(['profile', 'activity', 'sleep'], ['ai_external']).scopeFor('u1', 'external_ai');
    expect((partial.blockedHealth ?? []).filter((p: string) => /^zepp:(sleep|hrv|daily_activity|resting_heart_rate)$/.test(p))).toEqual(['zepp:daily_activity', 'zepp:hrv', 'zepp:resting_heart_rate']); // sono liberado; HRV e diario nao
    const all = await eligibility(['profile', 'activity', 'sleep', 'hrv', 'daily_activity', 'resting_heart_rate'], ['ai_external']).scopeFor('u1', 'external_ai');
    expect((all.blockedHealth ?? []).filter((p: string) => /^zepp:(sleep|hrv|daily_activity|resting_heart_rate)$/.test(p))).toEqual([]);
    const noAtlas = await eligibility(['profile', 'activity', 'sleep', 'hrv', 'daily_activity', 'resting_heart_rate'], []).scopeFor('u1', 'external_ai');
    expect((noAtlas.blockedHealth ?? []).filter((p: string) => /^zepp:(sleep|hrv|daily_activity|resting_heart_rate)$/.test(p))).toEqual(['zepp:daily_activity', 'zepp:hrv', 'zepp:resting_heart_rate', 'zepp:sleep']);
    const off = await eligibility(['profile', 'sleep'], ['ai_external'], {}).scopeFor('u1', 'external_ai');
    expect((off.blockedHealth ?? []).filter((p: string) => /^zepp:(sleep|hrv|daily_activity|resting_heart_rate)$/.test(p))).toContain('zepp:sleep');
    expect(off.blocked).toContain('zepp');
  });

  const scopeWith = (over: Record<string, unknown>) => ({ userId: 'u1', destination: 'external_ai' as const, blocked: [] as string[], computedAt: Date.now(), ...over });

  it('fora de escopo (telas) nada muda; dentro, par bloqueado, provedor bloqueado ou escopo sem avaliacao de saude (fail-closed) bloqueiam', async () => {
    expect(isHealthBlockedForAi('zepp', 'sleep')).toBe(false);
    await runWithAiScope(scopeWith({ blockedHealth: ['zepp:hrv'] }) as any, async () => {
      expect(isHealthBlockedForAi('zepp', 'hrv')).toBe(true);
      expect(isHealthBlockedForAi('zepp', 'sleep')).toBe(false);
    });
    await runWithAiScope(scopeWith({ blocked: ['zepp'], blockedHealth: [] }) as any, async () => expect(isHealthBlockedForAi('zepp', 'sleep')).toBe(true));
    await runWithAiScope(scopeWith({}) as any, async () => expect(isHealthBlockedForAi('zepp', 'sleep')).toBe(true));
  });

  it('o guarda de saida aborta a chamada se uma categoria de saude foi retirada no meio da geracao', async () => {
    const before = scopeWith({ blockedHealth: [] });
    const guard = new AiEgressGuard({ providerConnectionEvent: { create: async () => ({}) } } as any, { scopeFor: async () => ({ ...before, blockedHealth: ['zepp:sleep'] }) } as any);
    await runWithAiScope(before as any, async () => { await expect(guard.assertDeviceData('prescricao')).rejects.toMatchObject({ reason: 'consent_changed', providers: ['zepp:sleep'] }); });
    const same = new AiEgressGuard({ providerConnectionEvent: { create: async () => ({}) } } as any, { scopeFor: async () => before } as any);
    await runWithAiScope(before as any, async () => { await expect(same.assertDeviceData('prescricao')).resolves.toBeUndefined(); });
  });
});

describe('Atlas: variaveis de saude e recuperacao (observacoes rastreaveis, sem inventar)', () => {
  const sleepRow = { id: 'sl1', userId: 'u1', provider: 'zepp', calendarDate: '2026-10-20', startTimeSec: 1792540800, durationSec: 23160, deepSleepSec: 4380, lightSleepSec: null, remSleepSec: 5700, awakeSec: 780, napTotalSec: null, scoreValue: 64 };
  const dailyRow = { id: 'dl1', userId: 'u1', provider: 'zepp', calendarDate: '2026-10-20', startTimeSec: 1792454400, steps: 8523, activeKilocalories: 1842, restingHeartRateBpm: 62 };
  const hrvRow = { id: 'hv1', userId: 'u1', provider: 'zepp', calendarDate: '2026-10-20', startTimeSec: 1792540800, lastNightAvg: 48.5 };
  const reader = () => {
    const r = Object.create(ObservationReaderService.prototype) as any;
    r.prisma = { wearableSleepSummary: { findMany: async () => [sleepRow] }, wearableDailySummary: { findMany: async () => [dailyRow] }, wearableHrvSummary: { findMany: async () => [hrvRow] } };
    return r;
  };
  const read = (id: string) => reader().readWearableHealthVariable('u1', VARIABLE_REGISTRY[id]);

  it('as variaveis existem no registro como fonte "wearable_health", sem imputacao', () => {
    for (const id of ['wearable.sleepDurationMin', 'wearable.sleepDeepMin', 'wearable.sleepLightMin', 'wearable.sleepRemMin', 'wearable.sleepAwakeMin', 'wearable.napTotalMin', 'wearable.sleepScore', 'wearable.hrvLastNightAvg', 'wearable.restingHeartRateBpm', 'wearable.dailySteps', 'wearable.dailyActiveKcal']) {
      expect(VARIABLE_REGISTRY[id]).toMatchObject({ source: 'wearable_health', missingPolicy: 'never_impute' });
    }
    expect(VARIABLE_REGISTRY['wearable.sleepDurationMin'].domain).toBe('sleep');
    expect(VARIABLE_REGISTRY['wearable.hrvLastNightAvg'].domain).toBe('physical_state');
  });

  it('minutos = segundos / 60 SEM arredondar; campo nulo nao gera observacao (nunca zero); contexto leva provedor, resumo e dia', async () => {
    const duration = await read('wearable.sleepDurationMin');
    expect(duration).toHaveLength(1);
    expect(duration[0].value).toBe(23160 / 60);
    expect(duration[0]).toMatchObject({ source: 'wearable_health', context: { provider: 'zepp', wearableRecordId: 'sl1', calendarDate: '2026-10-20' } });
    expect(await read('wearable.sleepLightMin')).toEqual([]); // a Zepp nao informou
    expect(await read('wearable.napTotalMin')).toEqual([]);
    expect((await read('wearable.sleepScore'))[0].value).toBe(64);
  });

  it('FC de repouso vem so do resumo DIARIO; HRV e passos tambem; cada leitura usa a categoria certa na IA', async () => {
    expect((await read('wearable.restingHeartRateBpm'))[0].value).toBe(62);
    expect((await read('wearable.dailySteps'))[0].value).toBe(8523);
    expect((await read('wearable.hrvLastNightAvg'))[0].value).toBe(48.5);
    await runWithAiScope({ userId: 'u1', destination: 'external_ai', blocked: [], blockedHealth: ['zepp:resting_heart_rate', 'zepp:hrv'], computedAt: Date.now() }, async () => {
      expect(await read('wearable.restingHeartRateBpm')).toEqual([]);
      expect(await read('wearable.hrvLastNightAvg')).toEqual([]);
      expect(await read('wearable.sleepScore')).toHaveLength(1); // sono segue liberado
      expect(await read('wearable.dailySteps')).toHaveLength(1);
    });
    await runWithAiScope({ userId: 'u1', destination: 'external_ai', blocked: ['zepp'], blockedHealth: [], computedAt: Date.now() }, async () => {
      expect(await read('wearable.sleepScore')).toEqual([]);
      expect(await read('wearable.dailySteps')).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Campos preservados e receptores prontos para as categorias que a Zepp ja' preve ("Upcoming"): SpO2, temperatura da pele, composicao corporal, nutricao, carga de estilo de vida.
const pulseOx = { userId: 'zx', summaryId: 'pulseOx-1792540800', calendarDate: '2026-10-21', startTimeInSeconds: 1792540800, startTimeOffsetInSeconds: -10800, durationInSeconds: 0, timeOffsetPulseOxValues: { '0': 97 }, onDemand: true };
const skinTemp = { userId: 'zx', summaryId: 'skinTemp-1792540800', calendarDate: '2026-10-21', avgDeviationCelsius: -0.3, durationInSeconds: 0, startTimeInSeconds: 1792540800, startTimeOffsetInSeconds: -10800 };
const bodyComps = { userId: 'zx', summaryId: 'bc-1', measurementTimeInSeconds: 1792540800, measurementTimeOffsetInSeconds: -10800, weightInGrams: 70500, bodyMassIndex: 22.4, bodyFatInPercent: 14.2 };
const nutrition = { userId: 'zx', summaryId: 'nu-1', calendarDate: '2026-10-21', startTimeInSeconds: 1792540800, startTimeOffsetInSeconds: -10800, nutritionItems: [{ recordId: 'r1', startTimeInSeconds: 1792540800, foodName: 'Banana', energy: 89, carbohydrates: 23, measuredAmount: 100, measurementUnit: { code: 1, label: 'gram' } }] };
const hybridCharge = { userId: 'zx', summaryId: 'hc-1', calendarDate: '2026-10-21', startTimeInSeconds: 1792540800, durationInSeconds: 3600, startTimeOffsetInSeconds: -10800, lifeloadItems: [{ recordId: 'l1', startTimeInSeconds: 1792540800, endTimeInSeconds: 1792544400, category: { code: 1, label: 'Work' }, item: { code: 2, label: 'Meeting' }, lifeload: { code: 3, label: 'High' } }] };

describe('receptores prontos para as categorias previstas pela Zepp (campos originais preservados, nada inventado)', () => {
  it('SpO2, temperatura da pele, composicao corporal, nutricao e carga de estilo de vida sao lidos com os nomes e unidades ORIGINAIS e entram na fila na categoria certa', () => {
    const cases: Array<[string, unknown, string, string]> = [
      ['pulseOx', pulseOx, 'pulse_ox', 'timeOffsetPulseOxValues'],
      ['skinTemp', skinTemp, 'skin_temperature', 'avgDeviationCelsius'],
      ['bodyComps', bodyComps, 'body_composition', 'weightInGrams'],
      ['nutrition', nutrition, 'nutrition', 'nutritionItems'],
      ['hybridCharge', hybridCharge, 'lifestyle_load', 'lifeloadItems'],
    ];
    for (const [key, record, kind, field] of cases) {
      const content = parseZeppWebhook(body(key, record));
      expect(content.metricRecords).toHaveLength(1);
      const [draft] = toInboundDrafts(content);
      expect(draft).toMatchObject({ category: kind, eventType: 'metric_summary', externalAccountId: 'zx' });
      expect(draft.payload).toMatchObject({ metricKind: kind, providerSummaryId: (record as any).summaryId, identityKey: (record as any).summaryId });
      expect(Object.keys((draft.payload as any).values)).toContain(field); // campo original preservado
      expect((draft.payload as any).values).not.toHaveProperty('userId');
    }
    expect((parseZeppWebhook(body('bodyComps', bodyComps)).metricRecords[0] as any).values).toMatchObject({ weightInGrams: 70500, bodyMassIndex: 22.4, bodyFatInPercent: 14.2 }); // gramas, kg/m2 e % como a Zepp envia
    expect(parseZeppWebhook(body('bodyComps', bodyComps)).metricRecords[0]).toMatchObject({ calendarDate: null, startTimeSec: 1792540800, startOffsetSec: -10800 }); // sem data de calendario: nao e inventada
  });

  it('sem summaryId a identidade e tipo + inicio; registro sem usuario ou sem horario e ignorado', () => {
    const noId = parseZeppWebhook(body('pulseOx', { ...pulseOx, summaryId: undefined })).metricRecords[0];
    expect(noId.identityKey).toBe('pulse_ox:1792540800');
    expect(noId.providerSummaryId).toBeNull();
    const bad = parseZeppWebhook(body('skinTemp', { ...skinTemp, userId: 'x y' }, { ...skinTemp, startTimeInSeconds: 'x' }));
    expect(bad.metricRecords).toHaveLength(0);
    expect(bad.ignored).toBe(2);
  });

  it('so grava com a categoria autorizada pelo aluno (hoje nenhum grupo de consentimento a oferece); autorizada, grava os campos originais e regrava o mesmo resumo sem duplicar', async () => {
    const denied = makeHealth();
    const draft = toInboundDrafts(parseZeppWebhook(body('pulseOx', pulseOx)))[0];
    expect(await denied.service.handle(denied.event('metric_summary', draft.payload))).toMatchObject({ status: 'discard', reason: 'categoria nao autorizada pelo aluno' });
    expect(denied.rows.metric).toHaveLength(0);
    const granted = makeHealth({ categories: ['profile', 'pulse_ox', 'nutrition'] });
    expect(await granted.service.handle(granted.event('metric_summary', draft.payload))).toEqual({ status: 'done' });
    await granted.service.handle(granted.event('metric_summary', draft.payload));
    expect(granted.rows.metric).toHaveLength(1);
    expect(granted.rows.metric[0]).toMatchObject({ userId: 'u1', provider: 'zepp', metricKind: 'pulse_ox', identityKey: 'pulseOx-1792540800', values: { timeOffsetPulseOxValues: { '0': 97 }, onDemand: true } });
    const food = toInboundDrafts(parseZeppWebhook(body('nutrition', nutrition)))[0];
    await granted.service.handle(granted.event('metric_summary', food.payload));
    expect(granted.rows.metric[1].values.nutritionItems[0]).toMatchObject({ foodName: 'Banana', energy: 89, measurementUnit: { code: 1, label: 'gram' } });
    expect(await granted.service.handle(granted.event('metric_summary', { ...draft.payload as object, metricKind: 'mood' }))).toMatchObject({ status: 'discard' }); // tipo desconhecido
  });

  it('o evento de sono preserva pontuacoes detalhadas e os deslocamentos de respiracao e SpO2 que a Zepp enviar (nada util e descartado)', async () => {
    const record = sleepRecord({ sleepScores: { deep: { value: 80 }, rem: { value: 55 } }, timeOffsetSleepRespiration: 120, timeOffsetSleepSpo2: 300 });
    const parsed = parseZeppWebhook(body('sleeps', record)).healthRecords[0] as any;
    expect(parsed).toMatchObject({ sleepScores: { deep: { value: 80 }, rem: { value: 55 } }, respirationOffsetSec: 120, spo2OffsetSec: 300 });
    const t = makeHealth();
    const { type, payload } = t.payloadOf('sleeps', record);
    await t.service.handle(t.event(type, payload));
    expect(t.rows.sleep[0]).toMatchObject({ sleepScores: { deep: { value: 80 }, rem: { value: 55 } }, respirationOffsetSec: 120, spo2OffsetSec: 300 });
    const plain = parseZeppWebhook(body('sleeps', sleepRecord())).healthRecords[0] as any;
    expect(plain).toMatchObject({ sleepScores: null, respirationOffsetSec: null, spo2OffsetSec: null }); // ausente => nulo
  });

  it('o conector declara as categorias previstas e o receptor nao exige grupo de consentimento para existir (o grupo e acrescentado quando houver texto)', () => {
    const connector = buildZeppConnector({ get: () => undefined } as unknown as ConfigService);
    for (const category of ['pulse_ox', 'skin_temperature', 'body_composition', 'nutrition', 'lifestyle_load']) {
      expect(PROVIDER_DATA_CATEGORIES).toContain(category);
      expect(connector.categories).toContain(category);
      expect(ZEPP_CONSENT.groups.flatMap((g) => g.categories as readonly string[])).not.toContain(category); // nenhuma autorizacao oferecida ainda: nada e gravado
    }
  });
});
