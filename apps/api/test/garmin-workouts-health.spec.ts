import { buildCanonicalWorkout } from '../src/training-plans/canonical-workout';
import { translateToGarminWorkout, garminWorkoutName, GARMIN_WORKOUT_DESCRIPTION } from '../src/garmin/garmin-workout-spec';
import { GarminTrainingClient, GarminTrainingError, GARMIN_TRAINING_BASE, GARMIN_WORKOUT_CREATE_URL } from '../src/garmin/garmin-training-client';
import { GarminWorkoutPublisherService, GARMIN_WORKOUT_PROVIDER, GARMIN_WATCH_DELIVERY_PURPOSE } from '../src/garmin/garmin-workout-publisher.service';
import { WorkoutDeliveryService } from '../src/workout-delivery/workout-delivery.service';
import { parseGarminHealthPush, requiredCategoryOf, toHealthDrafts } from '../src/garmin/garmin-health';
import { GarminHealthEventService } from '../src/garmin/garmin-health-events.service';
import { GarminActivityEventService } from '../src/garmin/garmin-activity-events.service';
import { GarminDataDeletionService } from '../src/garmin/garmin-data-deletion.service';
import { GARMIN_CONSENT } from '../src/garmin/garmin-consent';
import { EXTERNAL_AI_APPROVED_PROVIDERS } from '../src/ai-governance/ai-data-eligibility.service';
import { INTEGRATION_PROVIDERS } from '../src/integrations/integrations-catalog';

// 08/11/2026 — Garmin, lotes 2b e 3: saude por push (Health API 2.1) e envio de treinos (Training API V2 2.0). Formatos conferidos nos PDFs da pasta "Documentação Garmin".
const continuous = { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 8, distanceUnit: 'km', paceRange: '5:30/km a 5:45/km' }] };
const timeBased = { type: 'run', blocks: [{ durationType: 'time', durationMin: 30, paceRange: '6:00/km a 6:20/km' }] };
const interval = { type: 'run', blocks: [{ repeatCount: 4, steps: [
  { durationType: 'distance', distanceValue: 400, distanceUnit: 'm', paceRange: '4:00/km' },
  { durationType: 'distance', distanceValue: 200, distanceUnit: 'm', pausaType: 'ativa', paceRange: '6:30/km a 7:00/km' },
] }] };
const canonical = (structure: unknown) => buildCanonicalWorkout({ id: 's1', modality: 'corrida', structure });
const ctx = { distanceKm: 8 as number | null, scheduledDate: '2026-10-22' };

describe('tradutor Garmin (CanonicalWorkout -> treino da Training API V2)', () => {
  it('corrida continua: um passo ACTIVE por distancia em metros, ritmo como VELOCIDADE em m/s e nome "Corrida 8 km · 22/10"', () => {
    const result = translateToGarminWorkout(canonical(continuous), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workout).toMatchObject({ workoutName: 'Corrida 8 km · 22/10', description: GARMIN_WORKOUT_DESCRIPTION, sport: 'RUNNING', workoutProvider: 'Panzeri Run', workoutSourceId: 'panzeri-run' });
    expect(result.workout.workoutProvider.length).toBeLessThanOrEqual(20);
    const step = result.workout.segments[0].steps[0] as any;
    expect(step).toMatchObject({ type: 'WorkoutStep', stepOrder: 1, intensity: 'ACTIVE', durationType: 'DISTANCE', durationValue: 8000, durationValueType: 'METER', targetType: 'PACE' });
    expect(step.targetValueHigh).toBeCloseTo(1000 / 330, 3); // pace rapido = velocidade alta
    expect(step.targetValueLow).toBeCloseTo(1000 / 345, 3);
    expect(step.targetValueLow).toBeLessThan(step.targetValueHigh);
  });
  it('por tempo: segundos inteiros, sem durationValueType', () => {
    const result = translateToGarminWorkout(canonical(timeBased), ctx);
    expect(result.ok && result.workout.segments[0].steps[0]).toMatchObject({ durationType: 'TIME', durationValue: 1800, durationValueType: null });
  });
  it('intervalado: grupo WorkoutRepeatStep com stepOrder sequencial no treino inteiro; trabalho = INTERVAL, recuperacao ativa = RECOVERY', () => {
    const result = translateToGarminWorkout(canonical(interval), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const group = result.workout.segments[0].steps[0] as any;
    expect(group).toMatchObject({ type: 'WorkoutRepeatStep', stepOrder: 1, repeatType: 'REPEAT_UNTIL_STEPS_CMPLT', repeatValue: 4 });
    expect(group.steps.map((s: any) => [s.stepOrder, s.intensity, s.durationValue])).toEqual([[2, 'INTERVAL', 400], [3, 'RECOVERY', 200]]);
    expect(group.steps[0].targetValueLow).toBeCloseTo(1000 / 240, 3);
    expect(group.steps[0].targetValueHigh).toBeCloseTo(1000 / 240, 3); // pace unico
  });
  it('recuperacao parada (sem ritmo) nao leva alvo; objetivo aberto vira OPEN sem valor', () => {
    const passive = translateToGarminWorkout(canonical({ type: 'run', blocks: [{ repeatCount: 3, steps: [
      { durationType: 'distance', distanceValue: 300, distanceUnit: 'm', paceRange: '4:30/km' },
      { durationType: 'time', durationMin: 1, pausaType: 'passiva' },
    ] }] }), ctx);
    expect(passive.ok).toBe(true);
    if (!passive.ok) return;
    const recovery = (passive.workout.segments[0].steps[0] as any).steps[1];
    expect(recovery).toMatchObject({ intensity: 'RECOVERY', durationType: 'TIME', durationValue: 60, targetType: 'OPEN', targetValueLow: null, targetValueHigh: null });
  });
  it('recusas explicitas: ritmo fora de 120-1800 s/km, repeticoes acima de 99, canonico incompleto, modalidade que nao e corrida, data invalida', () => {
    const fast = translateToGarminWorkout(canonical({ type: 'run', blocks: [{ durationType: 'distance', distanceValue: 1, distanceUnit: 'km', paceRange: '1:30/km' }] }), ctx);
    expect(!fast.ok && fast.refusals.map((r) => r.code)).toContain('pace_out_of_range');
    const many = translateToGarminWorkout(canonical({ type: 'run', blocks: [{ repeatCount: 100, steps: [{ durationType: 'distance', distanceValue: 100, distanceUnit: 'm', paceRange: '4:00/km' }] }] }), ctx);
    expect(!many.ok && many.refusals.map((r) => r.code)).toContain('repeat_count_invalid');
    const strength = translateToGarminWorkout({ ...canonical(continuous), modality: 'forca' }, ctx);
    expect(!strength.ok && strength.refusals.map((r) => r.code)).toContain('modality_not_running');
    const incomplete = translateToGarminWorkout({ ...canonical(continuous), complete: false, losses: [{ code: 'x', message: 'perda', path: 'items[0]' }] }, ctx);
    expect(!incomplete.ok && incomplete.refusals.map((r) => r.code)).toContain('canonical_x');
    expect(translateToGarminWorkout(canonical(continuous), { ...ctx, scheduledDate: '22/10/2026' }).ok).toBe(false);
  });
  it('esteira = corrida: modalidade "esteira" tambem e traduzida', () => {
    expect(translateToGarminWorkout({ ...canonical(continuous), modality: 'esteira' }, ctx).ok).toBe(true);
  });
  it('o hash e do CONTEUDO: mesma prescricao = mesmo hash; mudar so o dia nao muda o hash; mudar ritmo muda; nome sem dado pessoal', () => {
    const a = translateToGarminWorkout(canonical(continuous), ctx);
    const b = translateToGarminWorkout(canonical(continuous), ctx);
    const otherDay = translateToGarminWorkout(canonical(continuous), { ...ctx, scheduledDate: '2026-10-23' });
    const faster = translateToGarminWorkout(canonical({ type: 'run', blocks: [{ durationType: 'distance', distanceValue: 8, distanceUnit: 'km', paceRange: '5:20/km a 5:35/km' }] }), ctx);
    expect(a.ok && b.ok && otherDay.ok && faster.ok).toBe(true);
    if (!(a.ok && b.ok && otherDay.ok && faster.ok)) return;
    expect(a.specHash).toBe(b.specHash);
    expect(otherDay.workout.workoutName).not.toBe(a.workout.workoutName); // o nome leva a data...
    expect(garminWorkoutName(null, '2026-10-22')).toBe('Corrida · 22/10');
    expect(faster.specHash).not.toBe(a.specHash);
  });
});

describe('cliente da Training API (rede simulada)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const reply = (status: number, body?: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
  const workout = { workoutName: 'x' } as any;

  it('cria o treino em /workoutportal/workout/v2 e devolve workoutId e ownerId', async () => {
    let seen: any;
    global.fetch = jest.fn(async (url: any, init: any) => { seen = { url: String(url), init }; return reply(200, { workoutId: 123, ownerId: 9 }); }) as any;
    expect(await new GarminTrainingClient().createWorkout('tk', workout)).toEqual({ workoutId: '123', ownerId: '9' });
    expect(seen.url).toBe(GARMIN_WORKOUT_CREATE_URL);
    expect(seen.init.method).toBe('POST');
    expect(seen.init.headers.Authorization).toBe('Bearer tk');
  });
  it('atualiza com o treino COMPLETO (workoutId e ownerId) e apaga treino e agendamento', async () => {
    const calls: any[] = [];
    global.fetch = jest.fn(async (url: any, init: any) => { calls.push({ url: String(url), method: init.method, body: init.body }); return reply(204); }) as any;
    const c = new GarminTrainingClient();
    await c.updateWorkout('tk', '123', '9', workout);
    await c.deleteWorkout('tk', '123');
    await c.updateSchedule('tk', '77', '123', '2026-10-23');
    await c.deleteSchedule('tk', '77');
    expect(calls.map((x) => `${x.method} ${x.url.replace(GARMIN_TRAINING_BASE, '')}`)).toEqual(['PUT /workout/v2/123', 'DELETE /workout/v2/123', 'PUT /schedule/77', 'DELETE /schedule/77']);
    expect(JSON.parse(calls[0].body)).toMatchObject({ workoutId: 123, ownerId: 9 });
    expect(JSON.parse(calls[2].body)).toEqual({ scheduleId: 77, workoutId: 123, date: '2026-10-23' });
  });
  it('agendamento sem scheduleId na resposta: procura pelo treino e pela data', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => (++n === 1 ? reply(200, {}) : reply(200, [{ scheduleId: 5, workoutId: 999 }, { scheduleId: 6, workoutId: 123 }]))) as any;
    expect(await new GarminTrainingClient().createSchedule('tk', '123', '2026-10-22')).toEqual({ scheduleId: '6' });
  });
  it('codigos da Garmin viram tipos de erro: 401 auth, 412 permissao, 429 limite, 404 nao encontrado, 400 pedido invalido, rede', async () => {
    const kind = async (status: number) => { global.fetch = jest.fn(async () => reply(status)) as any; try { await new GarminTrainingClient().deleteWorkout('tk', '1'); } catch (e) { return (e as GarminTrainingError).kind; } return 'ok'; };
    expect(await kind(401)).toBe('auth');
    expect(await kind(412)).toBe('permission');
    expect(await kind(403)).toBe('permission');
    expect(await kind(429)).toBe('rate_limit');
    expect(await kind(404)).toBe('not_found');
    expect(await kind(400)).toBe('bad_request');
    expect(await kind(503)).toBe('server');
    global.fetch = jest.fn(async () => { throw new Error('rede'); }) as any;
    await expect(new GarminTrainingClient().deleteWorkout('tk', '1')).rejects.toMatchObject({ kind: 'network' });
  });
});

type Row = Record<string, any>;
function makePublisher(options: { enabled?: string; connected?: boolean; authorized?: boolean; today?: string; client?: Partial<Record<string, jest.Mock>> } = {}) {
  const sessions: Row[] = [];
  const deliveries: Row[] = [];
  const prisma: any = {
    trainingSession: { findMany: async ({ where }: any) => sessions.filter((s) => s.userId === where.userId && s.scheduledDate >= where.scheduledDate.gte && s.scheduledDate <= where.scheduledDate.lte && s.plan.status === 'active').sort((a, b) => a.scheduledDate - b.scheduledDate || a.id.localeCompare(b.id)), findUnique: async ({ where }: any) => sessions.find((s) => s.id === where.id) ?? null },
    workoutDelivery: {
      create: async ({ data }: any) => { const row = { id: `d${deliveries.length + 1}`, requestedAt: new Date(2026, 9, 20, 0, 0, deliveries.length), sentAt: null, ...data }; deliveries.push(row); return row; },
      findUnique: async ({ where }: any) => deliveries.find((d) => d.id === where.id) ?? null,
      update: async ({ where, data }: any) => { const row = deliveries.find((d) => d.id === where.id)!; Object.assign(row, data); return row; },
      findMany: async ({ where }: any) => deliveries
        .filter((d) => (!where.provider || d.provider === where.provider) && (!where.status || (typeof where.status === 'string' ? d.status === where.status : where.status.in.includes(d.status))) && (!where.trainingSession || sessions.find((s) => s.id === d.trainingSessionId)?.userId === where.trainingSession.userId))
        .sort((a, b) => b.requestedAt - a.requestedAt),
    },
  };
  let wid = 100;
  let sid = 500;
  const calls: string[] = [];
  const record = (name: string, fn: (...a: any[]) => any) => jest.fn(async (...args: any[]) => { calls.push(`${name} ${args.slice(1).filter((x) => typeof x !== 'object').join(' ')}`.trim()); return fn(...args); });
  const client: any = {
    createWorkout: record('createWorkout', () => ({ workoutId: String(++wid), ownerId: '9' })),
    updateWorkout: record('updateWorkout', () => undefined),
    deleteWorkout: record('deleteWorkout', () => undefined),
    createSchedule: record('createSchedule', () => ({ scheduleId: String(++sid) })),
    updateSchedule: record('updateSchedule', () => undefined),
    deleteSchedule: record('deleteSchedule', () => undefined),
    ...options.client,
  };
  const state = { connected: options.connected ?? true, authorized: options.authorized ?? true };
  const consent = { isAllowed: jest.fn(async (_p: string, _u: string, _c: string, purpose?: string) => (purpose === GARMIN_WATCH_DELIVERY_PURPOSE ? state.connected && state.authorized : state.connected)) };
  const connections = { getAccessToken: jest.fn(async () => 'token-secreto') };
  const config = { get: (key: string) => (key === 'GARMIN_WORKOUT_PUBLISH_ENABLED' ? options.enabled : undefined) };
  const service = new GarminWorkoutPublisherService(prisma, new WorkoutDeliveryService(prisma), connections as never, consent as never, client, config as never);
  service.today = () => options.today ?? '2026-10-20';
  const addSession = (id: string, date: string, structure: unknown = continuous, extra: Row = {}) => { const row = { id, userId: 'u1', scheduledDate: new Date(`${date}T00:00:00Z`), modality: 'corrida', origin: null, title: `Treino ${id}`, distanceKm: null, structure, plan: { status: 'active' }, completion: null, executionLinks: [], ...extra }; sessions.push(row); return row; };
  return { service, sessions, deliveries, calls, client, state, addSession };
}

describe('publicador Garmin (criar, atualizar e apagar)', () => {
  it('ligado por padrao; so desliga com GARMIN_WORKOUT_PUBLISH_ENABLED=false', async () => {
    expect(makePublisher({ enabled: undefined }).service.isPublishingEnabled()).toBe(true);
    expect(makePublisher({ enabled: 'true' }).service.isPublishingEnabled()).toBe(true);
    const off = makePublisher({ enabled: 'false' });
    off.addSession('a', '2026-10-21');
    expect(await off.service.reconcile('u1')).toEqual({ status: 'disabled' });
    expect(off.calls).toHaveLength(0);
  });
  it('sem conexao ou sem a autorizacao de envio: nada e criado', async () => {
    const off = makePublisher({ connected: false });
    off.addSession('a', '2026-10-21');
    expect(await off.service.reconcile('u1')).toEqual({ status: 'not_connected' });
    const noGrant = makePublisher({ authorized: false });
    noGrant.addSession('a', '2026-10-21');
    expect(await noGrant.service.reconcile('u1')).toEqual({ status: 'not_authorized' });
    expect(off.calls.concat(noGrant.calls)).toHaveLength(0);
  });
  it('cria treino + agendamento para cada corrida estruturada dos proximos 7 dias e NAO reenvia se nada mudou', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    t.addSession('b', '2026-10-23', interval);
    t.addSession('fora', '2026-10-28'); // alem da janela de 7 dias
    t.addSession('forca', '2026-10-22', continuous, { modality: 'forca' });
    t.addSession('extra', '2026-10-24', continuous, { origin: 'student_extra' });
    const first = await t.service.reconcile('u1');
    expect(first).toMatchObject({ status: 'published', created: 2, updated: 0, removed: 0, workouts: 2 });
    expect(t.calls.filter((c) => c.startsWith('createWorkout'))).toHaveLength(2);
    expect(t.calls.filter((c) => c.startsWith('createSchedule'))).toEqual(['createSchedule 101 2026-10-21', 'createSchedule 102 2026-10-23']);
    expect(t.deliveries.filter((d) => d.status === 'sent')).toHaveLength(2);
    expect(t.deliveries[0]).toMatchObject({ provider: GARMIN_WORKOUT_PROVIDER, externalWorkoutId: '101' });
    expect(t.deliveries[0].providerMetadata).toMatchObject({ scheduleId: '501', ownerId: '9', scheduledDate: '2026-10-21' });
    t.calls.length = 0;
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'unchanged', workouts: 2 });
    expect(t.calls).toHaveLength(0);
    expect(t.deliveries.filter((d) => d.status === 'sent')).toHaveLength(2);
  });
  it('mesmo dia com estrutura alterada: ATUALIZA o mesmo treino (sem criar outro e sem mexer no agendamento)', async () => {
    const t = makePublisher();
    const session = t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    t.calls.length = 0;
    session.structure = { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 8, distanceUnit: 'km', paceRange: '5:20/km a 5:35/km' }] };
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'published', created: 0, updated: 1 });
    expect(t.calls).toEqual(['updateWorkout 101 9']);
    const sent = t.deliveries.filter((d) => d.status === 'sent');
    expect(sent).toHaveLength(1);
    expect(sent[0].externalWorkoutId).toBe('101');
  });
  it('treino que mudou de dia: atualiza o AGENDAMENTO (nao cria treino novo)', async () => {
    const t = makePublisher();
    const session = t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    t.calls.length = 0;
    session.scheduledDate = new Date('2026-10-24T00:00:00Z');
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'published', created: 0, updated: 1 });
    // o nome do treino leva a data ("Corrida · 24/10"), entao o treino tambem e atualizado
    expect(t.calls).toEqual(['updateWorkout 101 9', 'updateSchedule 501 101 2026-10-24']);
    expect(t.deliveries.filter((d) => d.status === 'sent')[0].providerMetadata).toMatchObject({ scheduledDate: '2026-10-24', scheduleId: '501' });
  });
  it('treino que saiu do programa: APAGA agendamento e treino na Garmin (treino ja realizado nao e apagado)', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    t.addSession('b', '2026-10-22');
    await t.service.reconcile('u1');
    t.calls.length = 0;
    t.sessions[0].plan = { status: 'archived' }; // 'a' saiu do programa (plano arquivado; a sessao e a entrega continuam no banco)
    t.sessions[1].completion = { status: 'done' }; // 'b' ja foi realizado
    const result = await t.service.reconcile('u1');
    expect(result).toMatchObject({ status: 'published', removed: 1 });
    expect(t.calls).toEqual(['deleteSchedule 501', 'deleteWorkout 101']);
    expect(t.deliveries.find((d) => d.trainingSessionId === 'a')!.status).toBe('canceled');
    expect(t.deliveries.find((d) => d.trainingSessionId === 'b')!.status).toBe('sent');
  });
  it('autorizacao retirada com a conta conectada: APAGA tudo o que foi enviado', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    t.calls.length = 0;
    t.state.authorized = false;
    expect(await t.service.reconcile('u1')).toEqual({ status: 'not_authorized' });
    expect(t.calls).toEqual(['deleteSchedule 501', 'deleteWorkout 101']);
    expect(t.deliveries[0].status).toBe('canceled');
    expect(t.deliveries[0].providerMetadata.removalPending).toBeUndefined();
  });
  it('conta desconectada (sem token): nao finge que apagou — fica "retirada pendente"', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    t.calls.length = 0;
    t.state.connected = false;
    expect(await t.service.reconcile('u1')).toEqual({ status: 'not_connected' });
    expect(t.calls).toHaveLength(0);
    expect(t.deliveries[0].status).toBe('canceled');
    expect(t.deliveries[0].providerMetadata).toMatchObject({ removalPending: true, removalReason: 'conta_desconectada' });
  });
  it('falha ao apagar na Garmin: fica "retirada pendente" (nunca diz que apagou)', async () => {
    const t = makePublisher({ client: { deleteSchedule: jest.fn(async () => { throw new GarminTrainingError('server', 'falhou'); }) } });
    t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    t.state.authorized = false;
    await t.service.reconcile('u1');
    expect(t.deliveries[0].providerMetadata).toMatchObject({ removalPending: true, removalReason: 'autorizacao_retirada' });
  });
  it('a aluna apagou o treino no Garmin Connect (404 ao atualizar): o treino e recriado', async () => {
    const t = makePublisher({ client: { updateWorkout: jest.fn(async () => { throw new GarminTrainingError('not_found', 'nao existe', 404); }) } });
    const session = t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    session.structure = { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 9, distanceUnit: 'km', paceRange: '5:30/km a 5:45/km' }] };
    const result = await t.service.reconcile('u1');
    expect(result).toMatchObject({ status: 'published', created: 1 });
    expect(t.calls.filter((c) => c.startsWith('createWorkout'))).toHaveLength(2);
    expect(t.deliveries.filter((d) => d.status === 'sent')).toHaveLength(1);
  });
  it('limite (429) interrompe a rodada com falha tipada; permissao (412) tambem; pedido invalido de UM treino nao impede os demais', async () => {
    const limited = makePublisher({ client: { createWorkout: jest.fn(async () => { throw new GarminTrainingError('rate_limit', 'limite', 429); }) } });
    limited.addSession('a', '2026-10-21');
    limited.addSession('b', '2026-10-22');
    expect(await limited.service.reconcile('u1')).toMatchObject({ status: 'failed', kind: 'rate_limit' });
    expect(limited.deliveries).toHaveLength(1); // parou no primeiro
    expect(limited.deliveries[0].status).toBe('failed');
    const noPermission = makePublisher({ client: { createWorkout: jest.fn(async () => { throw new GarminTrainingError('permission', 'sem permissao', 412); }) } });
    noPermission.addSession('a', '2026-10-21');
    expect(await noPermission.service.reconcile('u1')).toMatchObject({ status: 'failed', kind: 'permission' });
    let n = 0;
    const partial = makePublisher({ client: { createWorkout: jest.fn(async () => { if (++n === 1) throw new GarminTrainingError('bad_request', 'invalido', 400); return { workoutId: '900', ownerId: '9' }; }) } });
    partial.addSession('a', '2026-10-21');
    partial.addSession('b', '2026-10-22');
    expect(await partial.service.reconcile('u1')).toMatchObject({ status: 'published', created: 1 });
  });
  it('status: janela de 7 dias, elegiveis, aceitos pela Garmin e se esta em dia', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    expect(await t.service.status('u1')).toMatchObject({ publishingEnabled: true, connected: true, watchDeliveryAuthorized: true, window: { startDate: '2026-10-20', endDate: '2026-10-26' }, eligible: 1, acceptedByGarmin: 0, inSync: false });
    await t.service.reconcile('u1');
    expect(await t.service.status('u1')).toMatchObject({ acceptedByGarmin: 1, inSync: true, removalPending: 0 });
  });
});

describe('saude da Garmin (leitura do push)', () => {
  const U = 'garmin-user-1';
  const START = 1_700_000_000;
  it('dia: passos, distancia, calorias, FC de repouso, meta + metrica de estresse/Body Battery do dia', () => {
    const { records } = parseGarminHealthPush({ dailies: [{ userId: U, summaryId: 'd1', calendarDate: '2026-11-07', startTimeInSeconds: START, startTimeOffsetInSeconds: -10800, durationInSeconds: 86400, steps: 9000, distanceInMeters: 7000.5, activeKilocalories: 420, restingHeartRateInBeatsPerMinute: 52, stepsGoal: 8000, averageStressLevel: 30, maxStressLevel: 80, bodyBatteryChargedValue: 60, bodyBatteryDrainedValue: 55, timeOffsetHeartRateSamples: { 15: 70 } }] });
    expect(records.map((r) => [r.eventType, r.metricKind])).toEqual([['daily_summary', undefined], ['metric_summary', 'lifestyle_load']]);
    expect(records[0].fields).toMatchObject({ steps: 9000, distanceMeters: 7000.5, activeKilocalories: 420, restingHeartRateBpm: 52, stepsGoal: 8000 });
    expect(records[1]).toMatchObject({ identityKey: 'daily:2026-11-07' });
    expect(records[1].fields).toMatchObject({ averageStressLevel: 30, bodyBatteryChargedValue: 60 });
    expect(JSON.stringify(records)).not.toContain('timeOffsetHeartRateSamples'); // amostras de FC do dia nao entram
  });
  it('sono: etapas, pontuacao, validacao, fim da noite pelo mapa de etapas — sem o SpO2 e a respiracao do sono', () => {
    const { records } = parseGarminHealthPush({ sleeps: [{ userId: U, summaryId: 's1', calendarDate: '2026-11-07', startTimeInSeconds: START, startTimeOffsetInSeconds: -10800, durationInSeconds: 28000, deepSleepDurationInSeconds: 5000, lightSleepDurationInSeconds: 14000, remSleepInSeconds: 6000, awakeDurationInSeconds: 3000, unmeasurableSleepInSeconds: 0, validation: 'ENHANCED_FINAL', overallSleepScore: { value: 87, qualifierKey: 'GOOD' }, sleepLevelsMap: { deep: [{ startTimeInSeconds: START, endTimeInSeconds: START + 3000 }], light: [{ startTimeInSeconds: START + 3000, endTimeInSeconds: START + 9000 }] }, timeOffsetSleepSpo2: { 0: 95 }, timeOffsetSleepRespiration: { 60: 14 } }] });
    expect(records[0]).toMatchObject({ eventType: 'sleep_summary', calendarDate: '2026-11-07' });
    expect(records[0].fields).toMatchObject({ durationSec: 28000, deepSleepSec: 5000, remSleepSec: 6000, scoreValue: 87, scoreQualifier: 'GOOD', validation: 'ENHANCED_FINAL', endTimeSec: START + 9000 });
    expect(JSON.stringify(records)).not.toMatch(/Spo2|Respiration/i);
  });
  it('HRV, VO2 maximo (ancora no meio-dia do dia) e composicao corporal', () => {
    const { records } = parseGarminHealthPush({
      hrv: [{ userId: U, summaryId: 'h1', calendarDate: '2026-11-07', startTimeInSeconds: START, startTimeOffsetInSeconds: 0, durationInSeconds: 3600, lastNightAvg: 44, lastNight5MinHigh: 72, hrvValues: { 300: 32, 600: 24 } }],
      userMetrics: [{ userId: U, summaryId: 'm1', calendarDate: '2026-11-07', vo2Max: 48, fitnessAge: 32, enhanced: true }],
      bodyComps: [{ userId: U, summaryId: 'b1', measurementTimeInSeconds: START, measurementTimeOffsetInSeconds: 0, weightInGrams: 75450, bodyFatInPercent: 17.1, bodyMassIndex: 23.2 }],
    });
    expect(records.map((r) => r.eventType + ':' + (r.metricKind ?? ''))).toEqual(['hrv_summary:', 'metric_summary:vo2_max', 'metric_summary:body_composition']);
    expect(records[0].fields).toMatchObject({ lastNightAvg: 44, hrvValues: { '300': 32, '600': 24 } });
    expect(records[1]).toMatchObject({ identityKey: 'vo2:2026-11-07', startTimeSec: Math.floor(Date.parse('2026-11-07T12:00:00Z') / 1000) });
    expect(records[2].fields).toMatchObject({ weightInGrams: 75450, bodyFatInPercent: 17.1 });
  });
  it('estresse a cada 3 min + Body Battery: so pares validos', () => {
    const { records } = parseGarminHealthPush({ stressDetails: [{ userId: U, summaryId: 'x1', calendarDate: '2026-11-07', startTimeInSeconds: START, startTimeOffsetInSeconds: 0, durationInSeconds: 540, timeOffsetStressLevelValues: { 0: 18, 180: -2, 360: 999, abc: 5 }, timeOffsetBodyBatteryValues: { 0: 55, 180: 56 } }] });
    expect(records[0]).toMatchObject({ metricKind: 'lifestyle_load', identityKey: 'stress:x1' });
    expect(records[0].fields.timeOffsetStressLevelValues).toEqual({ '0': 18, '180': -2 });
    expect(records[0].fields.timeOffsetBodyBatteryValues).toEqual({ '0': 55, '180': 56 });
  });
  it('lixo e tipos nao tratados sao ignorados sem quebrar; epocas/oxigenio/pressao nao viram dado', () => {
    const result = parseGarminHealthPush({ dailies: [{ summaryId: 'sem-usuario' }, null], epochs: [{ userId: U }], pulseox: [{ userId: U }], bloodPressures: [{ userId: U }] });
    expect(result.records).toEqual([]);
    expect(result.ignored).toBe(2);
    expect(parseGarminHealthPush(null).records).toEqual([]);
  });
  it('cada tipo exige a categoria certa e os rascunhos saem com chave idempotente', () => {
    const { records } = parseGarminHealthPush({
      dailies: [{ userId: U, summaryId: 'd1', calendarDate: '2026-11-07', startTimeInSeconds: START, steps: 1 }],
      hrv: [{ userId: U, summaryId: 'h1', calendarDate: '2026-11-07', startTimeInSeconds: START, lastNightAvg: 40 }],
    });
    expect(records.map((r) => requiredCategoryOf(r))).toEqual(['daily_activity', 'hrv']);
    const drafts = toHealthDrafts(records);
    expect(drafts.map((d) => d.category)).toEqual(['daily_activity', 'hrv']);
    expect(drafts.every((d) => d.externalAccountId === U && d.dedupeKey.length <= 200)).toBe(true);
    expect(toHealthDrafts(parseGarminHealthPush({ hrv: [{ userId: U, summaryId: 'h1', calendarDate: '2026-11-07', startTimeInSeconds: START, lastNightAvg: 40 }] }).records)[0].dedupeKey).toBe(drafts[1].dedupeKey);
  });
});

describe('gravacao da saude (GarminHealthEventService)', () => {
  const U = 'garmin-user-1';
  const START = Math.floor(Date.now() / 1000) - 3600;
  function build(categories: string[], authorized = true) {
    const writes: Record<string, any[]> = { sleep: [], hrv: [], daily: [], metric: [] };
    const tx: any = {
      wearableSleepSummary: { upsert: jest.fn(async (a: any) => { writes.sleep.push(a); }) },
      wearableHrvSummary: { upsert: jest.fn(async (a: any) => { writes.hrv.push(a); }) },
      wearableDailySummary: { upsert: jest.fn(async (a: any) => { writes.daily.push(a); }) },
      wearableMetricRecord: { upsert: jest.fn(async (a: any) => { writes.metric.push(a); }) },
    };
    const consent: any = { snapshot: jest.fn(async () => ({ categories, collectFrom: null })), writeWhileAuthorized: jest.fn(async (_p: string, _u: string, fn: any) => (authorized ? fn(tx, { categories }) : null)) };
    return { service: new GarminHealthEventService(consent), writes };
  }
  const event = (type: string, payload: unknown) => ({ id: 'e', provider: 'garmin', eventType: type, userId: 'u1', externalAccountId: U, attempt: 1, payload }) as any;
  const first = (body: unknown) => parseGarminHealthPush(body).records[0];

  it('sono e HRV: grava na tabela certa e e idempotente por dia + inicio', async () => {
    const t = build(['sleep', 'hrv']);
    const sleep = first({ sleeps: [{ userId: U, summaryId: 's1', calendarDate: '2026-11-07', startTimeInSeconds: START, startTimeOffsetInSeconds: 0, durationInSeconds: 100, overallSleepScore: { value: 80, qualifierKey: 'GOOD' } }] });
    expect(await t.service.handle(event('sleep_summary', sleep))).toEqual({ status: 'done' });
    expect(t.writes.sleep[0].create).toMatchObject({ provider: 'garmin', calendarDate: '2026-11-07', startTimeSec: START, scoreValue: 80, durationSec: 100 });
    const hrv = first({ hrv: [{ userId: U, summaryId: 'h1', calendarDate: '2026-11-07', startTimeInSeconds: START, lastNightAvg: 44 }] });
    expect(await t.service.handle(event('hrv_summary', hrv))).toEqual({ status: 'done' });
    expect(t.writes.hrv[0].create).toMatchObject({ lastNightAvg: 44 });
  });
  it('a FC de repouso e categoria PROPRIA: sem resting_heart_rate o campo nao e guardado', async () => {
    const daily = first({ dailies: [{ userId: U, summaryId: 'd1', calendarDate: '2026-11-07', startTimeInSeconds: START, startTimeOffsetInSeconds: 0, steps: 5000, restingHeartRateInBeatsPerMinute: 55 }] });
    const without = build(['daily_activity']);
    await without.service.handle(event('daily_summary', daily));
    expect(without.writes.daily[0].create).toMatchObject({ steps: 5000, restingHeartRateBpm: null });
    const withRhr = build(['daily_activity', 'resting_heart_rate']);
    await withRhr.service.handle(event('daily_summary', daily));
    expect(withRhr.writes.daily[0].create).toMatchObject({ restingHeartRateBpm: 55 });
  });
  it('metricas (estresse/Body Battery, VO2, composicao) vao para o receptor generico com a chave de identidade', async () => {
    const t = build(['lifestyle_load', 'vo2_max', 'body_composition']);
    const vo2 = first({ userMetrics: [{ userId: U, summaryId: 'm1', calendarDate: '2026-11-07', vo2Max: 48 }] });
    expect(await t.service.handle(event('metric_summary', vo2))).toEqual({ status: 'done' });
    expect(t.writes.metric[0].create).toMatchObject({ provider: 'garmin', metricKind: 'vo2_max', identityKey: 'vo2:2026-11-07', values: { kind: 'user_metrics', vo2Max: 48 } });
  });
  it('descarta: sem conta, categoria nao autorizada, conexao encerrada, retirada no meio, futuro, anterior ao periodo', async () => {
    const hrv = first({ hrv: [{ userId: U, summaryId: 'h1', calendarDate: '2026-11-07', startTimeInSeconds: START, lastNightAvg: 44 }] });
    const t = build(['sleep']);
    expect((await t.service.handle({ ...event('hrv_summary', hrv), userId: null })).status).toBe('discard');
    expect((await t.service.handle(event('hrv_summary', hrv))).status).toBe('discard'); // sem a categoria hrv
    expect((await build(['hrv'], false).service.handle(event('hrv_summary', hrv))).status).toBe('discard'); // retirada durante o processamento
    const future = { ...hrv, startTimeSec: Math.floor(Date.now() / 1000) + 5 * 86400 };
    expect((await build(['hrv']).service.handle(event('hrv_summary', future))).status).toBe('discard');
    expect((await t.service.handle(event('hrv_summary', { eventType: 'hrv_summary' }))).status).toBe('discard');
    const noConnection: any = { snapshot: jest.fn(async () => null), writeWhileAuthorized: jest.fn() };
    expect((await new GarminHealthEventService(noConnection).handle(event('hrv_summary', hrv))).status).toBe('discard');
  });
  it('o processador de atividade encaminha eventos de saude ao de saude', async () => {
    const health: any = { handle: jest.fn(async () => ({ status: 'done' })) };
    const service = new GarminActivityEventService({} as any, {} as any, health);
    expect(await service.handle(event('sleep_summary', {}))).toEqual({ status: 'done' });
    expect(health.handle).toHaveBeenCalled();
    expect((await new GarminActivityEventService({} as any, {} as any).handle(event('sleep_summary', {}))).status).toBe('discard');
  });
});

describe('exclusao, IA e catalogo', () => {
  it('a exclusao de dados da Garmin apaga treinos enviados e TODA a saude importada, so do usuario e do provedor', async () => {
    const calls: Array<[string, any]> = [];
    const del = (name: string) => ({ deleteMany: jest.fn(async (args: any) => { calls.push([name, args.where]); }) });
    const prisma: any = { workoutDelivery: del('workoutDelivery'), wearableSleepSummary: del('sleep'), wearableHrvSummary: del('hrv'), wearableDailySummary: del('daily'), wearableMetricRecord: del('metric') };
    await new GarminDataDeletionService(prisma).deleteUserData({ userId: 'u1' });
    expect(calls.map((c) => c[0])).toEqual(['workoutDelivery', 'sleep', 'hrv', 'daily', 'metric']);
    for (const [name, where] of calls) {
      if (name === 'workoutDelivery') expect(where).toEqual({ provider: GARMIN_WORKOUT_PROVIDER, trainingSession: { userId: 'u1' } });
      else expect(where).toEqual({ provider: 'garmin', userId: 'u1' });
    }
  });
  it('a Garmin esta liberada para a IA externa (segunda trava: GARMIN_EXTERNAL_AI_ENABLED) e o texto do Atlas diz que nao treina modelos', () => {
    expect(EXTERNAL_AI_APPROVED_PROVIDERS).toContain('garmin');
    expect(JSON.stringify(GARMIN_CONSENT)).toContain('treinar, avaliar ou melhorar modelos');
  });
  it('autorizacao: todos os grupos de saude estao no texto (VO2 e composicao corporal inclusive), sem GPS e sem ciclo', () => {
    const categories = GARMIN_CONSENT.groups.flatMap((g) => g.categories);
    for (const c of ['activity', 'activity_sensors', 'sleep', 'hrv', 'daily_activity', 'resting_heart_rate', 'lifestyle_load', 'vo2_max', 'body_composition']) expect(categories).toContain(c);
    expect(categories).not.toContain('activity_route');
    expect(categories).not.toContain('menstrual_cycle');
    const watch = GARMIN_CONSENT.optionalPurposes.find((p) => p.id === 'watch_delivery')!;
    expect(watch.screen!.paragraphs.join(' ')).toContain('apaga os que saírem do programa');
  });
  it('catalogo: Garmin disponivel, recebe atividades e envia treinos, exige as variaveis GARMIN_*', () => {
    const garmin = INTEGRATION_PROVIDERS.find((p) => p.id === 'garmin')!;
    expect(garmin.availability).toBe('available');
    expect(garmin.capabilities).toEqual({ receiveActivities: true, sendWorkouts: true });
    expect(garmin.requiresEnv).toEqual(['GARMIN_CLIENT_ID', 'GARMIN_CLIENT_SECRET', 'GARMIN_REDIRECT_URI', 'GARMIN_TOKEN_ENCRYPTION_KEY']);
    expect(garmin.profile.dataGroups).not.toContain('route');
  });
});

describe('cartao da Garmin no Panzeri Run (estatico)', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const card = readFileSync(join(__dirname, '..', '..', 'mobile', 'src', 'garmin', 'GarminIntegration.tsx'), 'utf8');
  const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
  it('sem percurso GPS e sem importacao de historico (o Starter nao traz historico); com todos os grupos de saude', () => {
    expect(card).not.toMatch(/'route'|history_backfill|Percurso GPS|HISTORY/);
    for (const id of ["'stress'", "'vo2'", "'body'", "'sleep'", "'daily'", "'hrv'"]) expect(card).toContain(id);
    expect(card).toContain("'/garmin/connect'");
    expect(card).toContain('/garmin/workouts/sync');
  });
  it('esta ligado nas duas telas (Dispositivos e integracoes, Privacidade e dados)', () => {
    expect(app).toContain("garmin: () => <GarminIntegration");
    expect(app).toContain('<GarminIntegration accessToken={accessToken} apiUrl={API_URL} variant="manage"');
  });
  it('linguagem do projeto: sem "app" e sem "plano de treino" nos textos', () => {
    expect(card).not.toMatch(/plano de treino/i);
    expect(card).not.toMatch(/(?<![A-Za-z-])app da Garmin|aplicativo da Garmin/);
  });
});
