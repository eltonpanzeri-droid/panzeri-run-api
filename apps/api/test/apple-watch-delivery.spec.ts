import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { WorkoutDeliveryService } from '../src/workout-delivery/workout-delivery.service';
import { AppleWatchDeliveryService, APPLE_WORKOUTKIT_PROVIDER } from '../src/workout-delivery/apple-watch-delivery.service';
import { appleWorkoutEligibility } from '../src/workout-delivery/apple-workout-eligibility';
import {
  appleWatchAvailability, sendResultMessage, sendSessionToAppleWatch, sessionDateToLocalNoon, AppleWatchApi, AppleWatchNative,
} from '../../mobile/src/appleWatchDelivery/sendSessionToAppleWatch';
import { AppleCustomWorkoutSpecJson, NativeCustomWorkoutValidation } from '../../mobile/src/appleWatchDelivery/customWorkoutBridge';

// Apple Etapa 7 — TrainingSession real -> CanonicalWorkout -> AppleCustomWorkoutSpec -> WorkoutDelivery -> (Swift) CustomWorkout -> WorkoutScheduler.
// Servico + orquestracao do app, com banco em memoria e WorkoutKit/Swift SIMULADOS (o Swift so' roda no iPhone). Nenhum PhysicalEvent/ActivityLog
// pode ser criado pelo envio; agendamento aceito nao e' execucao; 'delivered_to_device' nunca e' registrado.
const FUTURE_DATE = '2099-01-10';
const noop = {} as never;
const plans = new TrainingPlansService(noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop) as unknown as {
  runPrescription: (durationMin: number, modality: string, decision: { parts: unknown[] }) => Record<string, unknown> & { distanceKm: number };
};
const continua = (distanceKm: number, min: number, max = min) => ({ kind: 'continua', distanceKm, paceSecondsPerKmMin: min, paceSecondsPerKmMax: max });
const intervalada = (repeatCount: number, stimulus: [string, number, number], recovery: [string, number, number]) => ({
  kind: 'intervalada', repeatCount,
  stimulusLabel: stimulus[0], stimulusStepKm: stimulus[1], stimulusPaceSecondsPerKm: stimulus[2],
  recoveryLabel: recovery[0], recoveryStepKm: recovery[1], recoveryPaceSecondsPerKm: recovery[2],
});
// Estruturas REAIS (geradas pelo runPrescription): continuo de 34 km e treino estruturado de 10,8 km = 2 km + 5 x (1 km forte + 0,4 km leve) + 1,8 km.
const long34 = () => plans.runPrescription(180, 'corrida', { parts: [continua(34, 360)] });
const structured108 = (repeatCount = 5, pace = 300) =>
  plans.runPrescription(70, 'corrida', { parts: [continua(2, 360), intervalada(repeatCount, ['Forte', 1, pace], ['Leve', 0.4, 420]), continua(1.8, 380, 400)] });

function sessionRow(structure: Record<string, unknown> & { distanceKm: number }, overrides: Record<string, unknown> = {}) {
  return { id: 's1', userId: 'u1', modality: 'corrida', origin: 'agent', scheduledDate: new Date(`${FUTURE_DATE}T00:00:00Z`), distanceKm: structure.distanceKm, structure, completion: null, ...overrides } as Record<string, any>;
}

describe('appleWorkoutEligibility — o tradutor Apple e a unica fonte de verdade do que e enviavel', () => {
  const input = (structure: Record<string, unknown> & { distanceKm: number }, overrides: Record<string, unknown> = {}) =>
    ({ id: 's1', modality: 'corrida', origin: 'agent', scheduledDate: new Date(`${FUTURE_DATE}T00:00:00Z`), distanceKm: structure.distanceKm, structure, ...overrides }) as Parameters<typeof appleWorkoutEligibility>[0];
  const TODAY = '2026-10-07';

  it('continuo de 34 km: elegivel, 1 x [work 34000 m]', () => {
    const result = appleWorkoutEligibility(input(long34()), TODAY);
    expect(result).toMatchObject({ eligible: true, distanceKm: 34, scheduledDate: FUTURE_DATE });
    if (result.eligible) expect(result.spec.blocks).toEqual([{ iterations: 1, steps: [{ purpose: 'work', goal: { type: 'distance', meters: 34000 } }] }]);
  });

  it('estruturado de 10,8 km (continuo + 5 x intervalado + continuo): elegivel, ordem e repeticao preservadas', () => {
    const result = appleWorkoutEligibility(input(structured108()), TODAY);
    expect(result).toMatchObject({ eligible: true, distanceKm: 10.8 });
    if (!result.eligible) throw new Error('deveria ser elegivel');
    expect(result.spec.blocks).toEqual([
      { iterations: 1, steps: [{ purpose: 'work', goal: { type: 'distance', meters: 2000 } }] },
      { iterations: 5, steps: [{ purpose: 'work', goal: { type: 'distance', meters: 1000 } }, { purpose: 'recovery', goal: { type: 'distance', meters: 400 } }] },
      { iterations: 1, steps: [{ purpose: 'work', goal: { type: 'distance', meters: 1800 } }] },
    ]);
    expect(result.canonicalWorkout.schema).toBe('panzeri.canonical-workout');
    // nenhum alerta/pace no que sera enviado
    expect(JSON.stringify(result.spec)).not.toMatch(/pace|alert|speed|tolerance|band/i);
  });

  it.each([
    ['por tempo (Admin)', { type: 'run', blocks: [{ durationType: 'time', durationMin: 30 }] }, null, 'goal_time_not_supported_yet'],
    ['pausa passiva', { type: 'run', blocks: [{ repeatCount: 3, steps: [{ durationType: 'distance', distanceValue: 400, distanceUnit: 'm' }, { pausaType: 'passiva', durationType: 'time', durationMin: 1 }] }] }, null, 'goal_time_not_supported_yet'],
    ['meta ausente', { type: 'run', blocks: [{ durationType: 'distance' }] }, null, 'canonical_goal_distance_invalid'],
    ['distancia acima do limite', { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 120, distanceUnit: 'km' }] }, 120, 'distance_out_of_range'],
  ])('%s -> envio indisponivel, com o motivo do tradutor', (_name, structure, distanceKm, reason) => {
    expect(appleWorkoutEligibility(input({ ...(structure as object), distanceKm: distanceKm as number } as never, { distanceKm }), TODAY)).toEqual({ eligible: false, reason });
  });

  it.each([
    ['esteira', { modality: 'esteira' }, 'modalidade_nao_suportada'],
    ['forca', { modality: 'forca', structure: { type: 'strength' } }, 'modalidade_nao_suportada'],
    ['sessao extra (device_extra)', { origin: 'device_extra' }, 'sessao_extra'],
    ['data passada', { scheduledDate: new Date('2020-01-01T00:00:00Z') }, 'data_passada'],
    ['ja registrada pelo aluno', { completionStatus: 'done' }, 'sessao_ja_registrada'],
    ['distancia da sessao diverge da estrutura', { distanceKm: 8 }, 'distancia_inconsistente'],
  ])('%s -> envio indisponivel', (_name, overrides, reason) => {
    expect(appleWorkoutEligibility(input(long34(), overrides as Record<string, unknown>), TODAY)).toEqual({ eligible: false, reason });
  });

  it('modalidade pela representacao canonica: "RUNNING" legado ainda e corrida', () => {
    expect(appleWorkoutEligibility(input(long34(), { modality: 'RUNNING' }), TODAY).eligible).toBe(true);
  });
});

function build(sessionRows: Array<Record<string, any>>, store?: { deliveries: Map<string, any>; sessions: Map<string, any> }) {
  let seq = 0;
  const sessions = store?.sessions ?? new Map<string, any>(sessionRows.map((row) => [row.id, row]));
  const deliveries = store?.deliveries ?? new Map<string, any>();
  const activityLog = { create: jest.fn(), update: jest.fn(), upsert: jest.fn() };
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]) => row[key] === value);
  const prisma: Record<string, any> = {
    activityLog,
    trainingSession: {
      findFirst: jest.fn(async ({ where }: any) => { const row = sessions.get(where.id); return row && row.userId === where.userId ? { ...row } : null; }),
      findUnique: jest.fn(async ({ where }: any) => sessions.get(where.id) ?? null),
    },
    workoutDelivery: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `d-${deliveries.size + 1}-${++seq}`, requestedAt: new Date(Date.now() + deliveries.size), sentAt: null, deliveredAt: null, failedAt: null, canceledAt: null, errorMessage: null, externalWorkoutId: null, providerMetadata: null, ...data }; deliveries.set(row.id, row); return row; }),
      findMany: jest.fn(async ({ where }: any) => [...deliveries.values()].filter((d) => matches(d, where)).sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())),
      findUnique: jest.fn(async ({ where, include }: any) => { const row = deliveries.get(where.id); if (!row) return null; return include?.trainingSession ? { ...row, trainingSession: { userId: sessions.get(row.trainingSessionId)?.userId } } : { ...row }; }),
      update: jest.fn(async ({ where, data }: any) => { const row = { ...deliveries.get(where.id), ...data }; deliveries.set(where.id, row); return row; }),
    },
  };
  // Trava por sessao simulada: transacoes serializadas (como o advisory lock do Postgres).
  let chain: Promise<unknown> = Promise.resolve();
  prisma.$transaction = jest.fn((fn: (tx: unknown) => Promise<unknown>) => {
    const run = chain.then(() => fn({ ...prisma, $executeRaw: jest.fn(async () => 1) }));
    chain = run.catch(() => undefined);
    return run;
  });
  const service = new AppleWatchDeliveryService(prisma as unknown as PrismaService, new WorkoutDeliveryService(prisma as unknown as PrismaService));
  return { service, prisma, deliveries, sessions, activityLog };
}
const setStructure = (store: ReturnType<typeof build>, structure: Record<string, unknown> & { distanceKm: number }, extra: Record<string, unknown> = {}) =>
  Object.assign(store.sessions.get('s1'), { structure, distanceKm: structure.distanceKm, ...extra });

describe('AppleWatchDeliveryService — identidade persistente, snapshot e estados (WorkoutDelivery)', () => {
  it('prepare cria UMA entrega ligada a TrainingSession; guarda o CanonicalWorkout enviado + o spec Apple + hash; UUID persistido; nada de ActivityLog', async () => {
    const f = build([sessionRow(structured108())]);
    const result = (await f.service.prepare('u1', 's1')) as any;
    expect(result).toMatchObject({ eligible: true, distanceKm: 10.8, scheduledDate: FUTURE_DATE });
    expect(f.deliveries.size).toBe(1);
    const row = [...f.deliveries.values()][0];
    expect(row).toMatchObject({ trainingSessionId: 's1', provider: APPLE_WORKOUTKIT_PROVIDER, status: 'pending', deliveredAt: null });
    expect(row.externalWorkoutId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row.canonicalWorkout).toMatchObject({ schema: 'panzeri.canonical-workout', trainingSessionId: 's1', derived: { totalDistanceMeters: 10800 } });
    expect(row.providerMetadata).toMatchObject({ channel: 'workoutkit', workoutKitType: 'CustomWorkout', workoutPlanId: row.externalWorkoutId, scheduledDate: FUTURE_DATE, schedulingEvidence: 'none' });
    expect(row.providerMetadata.specHash).toBe(row.providerMetadata.appleSpec.specHash);
    expect(row.providerMetadata.appleSpec.blocks).toHaveLength(3);
    expect(result.spec).toEqual(row.providerMetadata.appleSpec); // o app recebe exatamente o snapshot gravado
    expect(f.activityLog.create).not.toHaveBeenCalled(); // enviar nao cria PhysicalEvent/ActivityLog
  });

  it('segundo toque (inclusive simultaneo) devolve a MESMA entrega e o MESMO planId; fechar/reabrir tambem', async () => {
    const f = build([sessionRow(structured108())]);
    const [a, b] = await Promise.all([f.service.prepare('u1', 's1'), f.service.prepare('u1', 's1')]);
    const c = await f.service.prepare('u1', 's1');
    expect(f.deliveries.size).toBe(1);
    expect((a as any).delivery.planId).toBe((b as any).delivery.planId);
    expect((c as any).delivery.planId).toBe((a as any).delivery.planId);
    const reopened = build([], { deliveries: f.deliveries, sessions: f.sessions });
    expect(((await reopened.service.prepare('u1', 's1')) as any).delivery.planId).toBe((a as any).delivery.planId);
    expect(f.deliveries.size).toBe(1);
  });

  it('sessao incompativel: envio indisponivel e nenhuma entrega criada; sessao de outro aluno: nao encontrada', async () => {
    const f = build([sessionRow({ type: 'run', blocks: [{ durationType: 'time', durationMin: 30 }], distanceKm: 0 } as never, { distanceKm: null })]);
    expect(await f.service.prepare('u1', 's1')).toEqual({ eligible: false, reason: 'goal_time_not_supported_yet' });
    expect(await f.service.eligibility('u1', 's1')).toEqual({ eligible: false, reason: 'goal_time_not_supported_yet' });
    expect(f.deliveries.size).toBe(0);
    await expect(build([sessionRow(long34())]).service.prepare('outro', 's1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('confirmSent registra SO\' "sent" (nunca delivered_to_device), mantem planId e e idempotente; falha nao rebaixa um envio', async () => {
    const f = build([sessionRow(long34())]);
    const prepared = (await f.service.prepare('u1', 's1')) as any;
    expect(await f.service.confirmSent('u1', prepared.delivery.id)).toMatchObject({ status: 'sent', planId: prepared.delivery.planId });
    const row = f.deliveries.get(prepared.delivery.id);
    expect(row).toMatchObject({ status: 'sent', deliveredAt: null, externalWorkoutId: prepared.delivery.planId });
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(row.providerMetadata.schedulingEvidence).toBe('listed_in_workoutkit_scheduled');
    expect(row.providerMetadata.appleSpec).toBeTruthy(); // o snapshot enviado continua gravado depois do 'sent'
    expect((await f.service.confirmSent('u1', prepared.delivery.id)).status).toBe('sent');
    expect((await f.service.reportFailure('u1', prepared.delivery.id, 'x')).status).toBe('sent');
  });

  it('falha registrada com o erro nativo real nao conta como envio; a nova tentativa reserva nova identidade (a anterior nunca foi agendada)', async () => {
    const f = build([sessionRow(long34())]);
    const first = (await f.service.prepare('u1', 's1')) as any;
    expect((await f.service.reportFailure('u1', first.delivery.id, 'E_NOT_AUTHORIZED: WorkoutKit nao autorizado (estado: denied).')).status).toBe('failed');
    expect(f.deliveries.get(first.delivery.id)).toMatchObject({ status: 'failed', errorMessage: 'E_NOT_AUTHORIZED: WorkoutKit nao autorizado (estado: denied).' });
    const second = (await f.service.prepare('u1', 's1')) as any;
    expect(second.delivery.id).not.toBe(first.delivery.id);
    expect(f.deliveries.size).toBe(2);
  });

  it('prescricao alterada ANTES do envio: a reserva pendente e refeita (novo hash, novo planId) e a antiga e cancelada', async () => {
    const f = build([sessionRow(structured108(5))]);
    const first = (await f.service.prepare('u1', 's1')) as any;
    setStructure(f, structured108(6)); // repeatCount 5 -> 6
    const second = (await f.service.prepare('u1', 's1')) as any;
    expect(second.delivery.id).not.toBe(first.delivery.id);
    expect(second.delivery.planId).not.toBe(first.delivery.planId);
    expect(f.deliveries.get(first.delivery.id).status).toBe('canceled');
    expect(second.spec.blocks[1].iterations).toBe(6);
    expect(second.spec.specHash).not.toBe(first.spec.specHash);
  });

  it('mudar so o PACE (que nao e enviado) nao desatualiza a entrega: mesmo hash, mesma entrega', async () => {
    const f = build([sessionRow(structured108(5, 300))]);
    const first = (await f.service.prepare('u1', 's1')) as any;
    setStructure(f, structured108(5, 270));
    const second = (await f.service.prepare('u1', 's1')) as any;
    expect(second.delivery.id).toBe(first.delivery.id);
    expect(second.delivery.outdated).toBe(false);
    expect(f.deliveries.size).toBe(1);
  });

  it('prescricao alterada DEPOIS do envio: a entrega enviada continua, e sinalizada como desatualizada (hash ou data diferentes), sem reenvio automatico', async () => {
    const f = build([sessionRow(structured108(5))]);
    const prepared = (await f.service.prepare('u1', 's1')) as any;
    await f.service.confirmSent('u1', prepared.delivery.id);
    setStructure(f, structured108(6));
    const byStructure = (await f.service.eligibility('u1', 's1')) as any;
    expect(byStructure.delivery).toMatchObject({ id: prepared.delivery.id, status: 'sent', outdated: true });
    setStructure(f, structured108(5), { scheduledDate: new Date('2099-01-12T00:00:00Z') });
    expect(((await f.service.eligibility('u1', 's1')) as any).delivery).toMatchObject({ status: 'sent', outdated: true });
    setStructure(f, structured108(5));
    Object.assign(f.sessions.get('s1'), { scheduledDate: new Date(`${FUTURE_DATE}T00:00:00Z`) });
    expect(((await f.service.eligibility('u1', 's1')) as any).delivery).toMatchObject({ status: 'sent', outdated: false });
    expect(f.deliveries.size).toBe(1);
  });

  it('entrega antiga (SingleGoalWorkout, sem spec/hash): pendente e refeita no novo formato; enviada e marcada desatualizada e nao e reenviada', async () => {
    const legacySnapshot = { version: 1, kind: 'run', modality: 'corrida', goal: { type: 'distance', distanceKm: 34 }, scheduledDate: FUTURE_DATE, trainingSessionId: 's1' };
    const pending = build([sessionRow(long34())]);
    pending.deliveries.set('old', { id: 'old', trainingSessionId: 's1', provider: APPLE_WORKOUTKIT_PROVIDER, status: 'pending', externalWorkoutId: 'old-plan', canonicalWorkout: legacySnapshot, providerMetadata: { channel: 'workoutkit', workoutPlanId: 'old-plan' }, requestedAt: new Date(), sentAt: null, deliveredAt: null, failedAt: null, canceledAt: null, errorMessage: null });
    const prepared = (await pending.service.prepare('u1', 's1')) as any;
    expect(pending.deliveries.get('old').status).toBe('canceled');
    expect(prepared.delivery.id).not.toBe('old');
    expect(prepared.spec.blocks).toHaveLength(1);

    const sent = build([sessionRow(long34())]);
    sent.deliveries.set('old', { id: 'old', trainingSessionId: 's1', provider: APPLE_WORKOUTKIT_PROVIDER, status: 'sent', externalWorkoutId: 'old-plan', canonicalWorkout: legacySnapshot, providerMetadata: { channel: 'workoutkit', workoutPlanId: 'old-plan' }, requestedAt: new Date(), sentAt: new Date(), deliveredAt: null, failedAt: null, canceledAt: null, errorMessage: null });
    const view = (await sent.service.prepare('u1', 's1')) as any;
    expect(view.delivery).toMatchObject({ id: 'old', status: 'sent', outdated: true });
    expect(view.spec).toBeNull();
    expect(sent.deliveries.size).toBe(1);
  });
});

describe('sendSessionToAppleWatch — orquestracao (app) com WorkoutKit e Swift simulados', () => {
  type Scenario = { sessions?: Array<Record<string, any>>; shared?: ReturnType<typeof build>; device?: { scheduled: Array<{ planId: string }> } };
  function world(structure: (Record<string, unknown> & { distanceKm: number }) | null, scenario: Scenario = {}) {
    const base = scenario.shared ?? build([sessionRow(structure as never)]);
    const device = scenario.device ?? { scheduled: [] };
    const calls: string[] = [];
    const scheduleCalls: Array<{ planId: string; specJson: string; date: Date }> = [];
    const behavior = {
      validation: null as null | NativeCustomWorkoutValidation,
      authorization: 'authorized',
      scheduleError: null as null | Error,
      scheduleRefusesSpec: false,
      ignoreSchedule: false,
    };
    const api: AppleWatchApi = {
      prepare: (id) => base.service.prepare('u1', id) as never,
      confirmSent: (deliveryId) => base.service.confirmSent('u1', deliveryId),
      reportFailure: (deliveryId, message) => base.service.reportFailure('u1', deliveryId, message),
    };
    const native: AppleWatchNative = {
      isSupported: true,
      // Simula o Swift: constroi mecanicamente (bloco -> IntervalBlock, work/recovery, metros) e devolve o eco.
      validateCustomWorkoutSpec: (json) => {
        calls.push('validate');
        if (behavior.validation) return behavior.validation;
        const spec = JSON.parse(json) as AppleCustomWorkoutSpecJson;
        const blocks = spec.blocks.map((b) => ({ iterations: b.iterations, steps: b.steps.map((s) => ({ purpose: s.purpose as string, meters: s.goal.meters })) }));
        return { valid: true, errors: [], summary: { activity: 'running', location: 'outdoor', blocks, totalMeters: blocks.reduce((t, b) => t + b.iterations * b.steps.reduce((x, s) => x + s.meters, 0), 0), serializedBytes: 256 } };
      },
      requestAuthorization: async () => { calls.push('authorize'); return behavior.authorization; },
      listScheduled: async () => { calls.push('list'); return [...device.scheduled]; },
      scheduleCustomWorkout: async (planId, specJson, date) => {
        calls.push('schedule');
        scheduleCalls.push({ planId, specJson, date });
        if (behavior.scheduleError) throw behavior.scheduleError;
        if (behavior.scheduleRefusesSpec) return { scheduled: false, errors: [{ code: 'E_SPEC_INVALID_DISTANCE', message: 'Distancia invalida (0 m).', path: 'blocks[0].steps[0].goal.meters' }] };
        if (!behavior.ignoreSchedule) device.scheduled.push({ planId });
        return { scheduled: true };
      },
    };
    return { base, api, native, device, calls, scheduleCalls, behavior };
  }
  const specOf = (json: string) => JSON.parse(json) as AppleCustomWorkoutSpecJson;
  const lastDelivery = (w: ReturnType<typeof world>) => [...w.base.deliveries.values()].sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())[0];

  it('1. continuo de 34 km: o spec da entrega vai ao Swift, a data e a do dia (meio-dia local) e a entrega fica SO\' "sent" depois da releitura', async () => {
    const w = world(long34());
    const result = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(result).toMatchObject({ ok: true, state: 'scheduled' });
    expect(w.scheduleCalls).toHaveLength(1);
    expect(specOf(w.scheduleCalls[0].specJson).blocks).toEqual([{ iterations: 1, steps: [{ purpose: 'work', goal: { type: 'distance', meters: 34000 } }] }]);
    const date = w.scheduleCalls[0].date;
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2099, 0, 10, 12]);
    const delivery = lastDelivery(w);
    expect(delivery).toMatchObject({ status: 'sent', externalWorkoutId: w.scheduleCalls[0].planId, deliveredAt: null, trainingSessionId: 's1' });
    expect(w.scheduleCalls[0].specJson).toBe(JSON.stringify(delivery.providerMetadata.appleSpec)); // o que foi agendado e' o snapshot gravado
    expect(w.base.activityLog.create).not.toHaveBeenCalled();
  });

  it('2. estruturado de 10,8 km: 3 blocos em ordem (2000 m -> 5 x [1000 work, 400 recovery] -> 1800 m), validado no aparelho ANTES de autorizar/agendar, sent so\' apos a releitura', async () => {
    const w = world(structured108());
    const result = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(result).toMatchObject({ ok: true, state: 'scheduled' });
    expect(specOf(w.scheduleCalls[0].specJson).blocks.map((b) => [b.iterations, b.steps.map((s) => `${s.purpose}:${s.goal.meters}`)])).toEqual([
      [1, ['work:2000']], [5, ['work:1000', 'recovery:400']], [1, ['work:1800']],
    ]);
    // ordem: lista (ja agendado?) -> validacao nativa -> autorizacao -> agendamento -> releitura
    expect(w.calls).toEqual(['list', 'validate', 'authorize', 'schedule', 'list']);
    expect(lastDelivery(w)).toMatchObject({ status: 'sent', deliveredAt: null });
  });

  it('3. segundo toque: nao cria segundo workout nem segunda entrega', async () => {
    const w = world(structured108());
    await sendSessionToAppleWatch('s1', w.api, w.native);
    const second = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(second).toMatchObject({ ok: true, state: 'already_scheduled' });
    expect(w.scheduleCalls).toHaveLength(1);
    expect(w.device.scheduled).toHaveLength(1);
    expect(w.base.deliveries.size).toBe(1);
  });

  it('fechar/reabrir: mesma identidade; se o aparelho perdeu o plano, reagenda com o MESMO planId e o MESMO spec', async () => {
    const w1 = world(structured108());
    await sendSessionToAppleWatch('s1', w1.api, w1.native);
    const { planId, specJson } = w1.scheduleCalls[0];
    const w2 = world(null, { shared: build([], { deliveries: w1.base.deliveries, sessions: w1.base.sessions }), device: w1.device });
    expect(await sendSessionToAppleWatch('s1', w2.api, w2.native)).toMatchObject({ ok: true, state: 'already_scheduled', planId });
    expect(w2.scheduleCalls).toHaveLength(0);
    w1.device.scheduled.length = 0; // removido no app Treino
    const w3 = world(null, { shared: build([], { deliveries: w1.base.deliveries, sessions: w1.base.sessions }), device: w1.device });
    expect(await sendSessionToAppleWatch('s1', w3.api, w3.native)).toMatchObject({ ok: true, state: 'scheduled', planId });
    expect(w3.scheduleCalls[0]).toMatchObject({ planId, specJson });
    expect(w1.base.deliveries.size).toBe(1);
  });

  it('4a. prescricao alterada DEPOIS de enviada: nao reenvia automaticamente (prescricao_alterada) e nada e agendado', async () => {
    const w = world(structured108(5));
    await sendSessionToAppleWatch('s1', w.api, w.native);
    w.device.scheduled.length = 0;
    setStructure(w.base, structured108(6));
    const result = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(result).toMatchObject({ ok: false, reason: 'prescricao_alterada' });
    expect(w.scheduleCalls).toHaveLength(1); // so' o envio original
    expect(sendResultMessage(result)).toBe('A prescrição mudou depois do envio anterior.');
  });

  it('4b. prescricao alterada ANTES de agendar (reserva pendente): a entrega e refeita e o NOVO spec e o que vai ao WorkoutKit', async () => {
    const w = world(structured108(5));
    const reserved = (await w.base.service.prepare('u1', 's1')) as any; // reserva criada, nada agendado
    setStructure(w.base, structured108(6));
    const result = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(result).toMatchObject({ ok: true, state: 'scheduled' });
    expect(w.base.deliveries.get(reserved.delivery.id).status).toBe('canceled');
    expect(w.scheduleCalls[0].planId).not.toBe(reserved.delivery.planId);
    expect(specOf(w.scheduleCalls[0].specJson).blocks[1].iterations).toBe(6);
  });

  it('5a. erro do WorkoutKit/agendamento: nao registra sucesso; o erro nativo real (codigo + mensagem) fica na entrega e e mostrado no card', async () => {
    const w = world(structured108());
    w.behavior.scheduleError = Object.assign(new Error('WorkoutKit nao autorizado (estado: denied).'), { code: 'E_NOT_AUTHORIZED' });
    const result = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(result).toMatchObject({ ok: false, reason: 'falha_workoutkit' });
    expect(lastDelivery(w)).toMatchObject({ status: 'failed', sentAt: null, deliveredAt: null, errorMessage: 'E_NOT_AUTHORIZED: WorkoutKit nao autorizado (estado: denied).' });
    const text = sendResultMessage(result);
    expect(text).toContain('Não foi possível agendar no Apple Watch.');
    expect(text).toContain('E_NOT_AUTHORIZED');
    expect(text).toContain('estado: denied');
  });

  it('5b. autorizacao negada antes de agendar: falha com o estado real, sem chamar o agendamento', async () => {
    const w = world(long34());
    w.behavior.authorization = 'denied';
    const result = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(result).toMatchObject({ ok: false, reason: 'falha_workoutkit' });
    expect(w.scheduleCalls).toHaveLength(0);
    expect(lastDelivery(w)).toMatchObject({ status: 'failed', errorMessage: 'WorkoutKit nao autorizado (denied).' });
  });

  it('5c. o aparelho recusa a estrutura na validacao nativa: nada e autorizado nem agendado; codigos nativos preservados na entrega e no card', async () => {
    const w = world(structured108());
    w.behavior.validation = { valid: false, errors: [{ code: 'E_WORKOUTKIT_GOAL_UNSUPPORTED', message: 'O sistema nao suporta a meta de 400 m para corrida ao ar livre.', path: 'blocks[1].steps[0].goal' }] };
    const result = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(result).toMatchObject({ ok: false, reason: 'validacao_nativa' });
    expect(w.calls).toEqual(['list', 'validate']); // sem autorizacao e sem agendamento
    expect(lastDelivery(w).errorMessage).toContain('E_WORKOUTKIT_GOAL_UNSUPPORTED @ blocks[1].steps[0].goal');
    expect(sendResultMessage(result)).toContain('E_WORKOUTKIT_GOAL_UNSUPPORTED');
  });

  it('5d. spec recusado no agendamento (scheduled=false) e agendamento nao confirmado na lista: ambos viram falha, nunca "sent"', async () => {
    const refused = world(long34());
    refused.behavior.scheduleRefusesSpec = true;
    expect(await sendSessionToAppleWatch('s1', refused.api, refused.native)).toMatchObject({ ok: false, reason: 'falha_workoutkit' });
    expect(lastDelivery(refused)).toMatchObject({ status: 'failed', sentAt: null });
    expect(lastDelivery(refused).errorMessage).toContain('E_SPEC_INVALID_DISTANCE');
    const unconfirmed = world(long34());
    unconfirmed.behavior.ignoreSchedule = true;
    expect(await sendSessionToAppleWatch('s1', unconfirmed.api, unconfirmed.native)).toMatchObject({ ok: false, reason: 'agendamento_nao_confirmado' });
    expect(lastDelivery(unconfirmed)).toMatchObject({ status: 'failed', sentAt: null });
  });

  it('sessao que o tradutor recusa (passo por tempo): nada e agendado nem criado; fora do app nativo: indisponivel', async () => {
    const w = world({ type: 'run', blocks: [{ durationType: 'time', durationMin: 40 }], distanceKm: 0 } as never);
    Object.assign(w.base.sessions.get('s1'), { distanceKm: null });
    expect(await sendSessionToAppleWatch('s1', w.api, w.native)).toMatchObject({ ok: false, reason: 'goal_time_not_supported_yet' });
    expect(w.calls).toEqual([]);
    expect(w.base.deliveries.size).toBe(0);
    const off = world(long34());
    expect(await sendSessionToAppleWatch('s1', off.api, { ...off.native, isSupported: false })).toMatchObject({ ok: false, reason: 'nao_suportado' });
    expect(off.base.deliveries.size).toBe(0);
  });

  it('sessionDateToLocalNoon: dia da sessao ao meio-dia local (nao desloca o dia)', () => {
    const date = sessionDateToLocalNoon('2026-12-31');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 11, 31, 12]);
  });
});

describe('appleWatchAvailability — o que o card mostra antes do toque (falha nao e silenciosa)', () => {
  const eligible = { eligible: true as const, distanceKm: 10.8, scheduledDate: FUTURE_DATE, delivery: null };
  it('elegivel (continuo, varias partes ou intervalado): botao', () => {
    expect(appleWatchAvailability(eligible)).toEqual({ show: 'button' });
  });
  it('corrida que o tradutor recusa por motivo compreensivel: mostra o motivo em uma linha', () => {
    for (const reason of ['goal_time_not_supported_yet', 'passive_recovery_not_supported_yet', 'distance_out_of_range', 'distancia_inconsistente', 'canonical_goal_distance_invalid']) {
      expect(appleWatchAvailability({ eligible: false, reason })).toMatchObject({ show: 'note' });
    }
    expect((appleWatchAvailability({ eligible: false, reason: 'goal_time_not_supported_yet' }) as { note: string }).note).toContain('por tempo');
  });
  it('falha na consulta avisa que nao conseguiu verificar (com o codigo); casos esperados e sessoes sem botao ficam sem mensagem', () => {
    expect((appleWatchAvailability({ error: 'HTTP 500' }) as { note: string }).note).toContain('HTTP 500');
    for (const reason of ['modalidade_nao_suportada', 'sessao_extra', 'estrutura_nao_suportada', 'data_passada', 'sessao_ja_registrada']) {
      expect(appleWatchAvailability({ eligible: false, reason })).toEqual({ show: 'nothing' });
    }
    expect(appleWatchAvailability(null)).toEqual({ show: 'nothing' });
  });
});
