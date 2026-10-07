import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkoutDeliveryService } from '../src/workout-delivery/workout-delivery.service';
import { AppleWatchDeliveryService, APPLE_WORKOUTKIT_PROVIDER } from '../src/workout-delivery/apple-watch-delivery.service';
import { appleRunEligibility } from '../src/workout-delivery/apple-run-workout';
import { sendSessionToAppleWatch, sessionDateToLocalNoon, AppleWatchApi, AppleWatchNative } from '../../mobile/src/appleWatchDelivery/sendSessionToAppleWatch';

// Apple Watch via WorkoutKit — primeiro envio real (so' corrida continua externa por distancia). Servico + orquestracao do app, com banco em
// memoria e WorkoutKit simulado. Nenhum PhysicalEvent/ActivityLog pode ser criado pelo envio; agendamento aceito nao e' execucao.
const FUTURE_DATE = '2099-01-10';
const runStructure = (km: number) => ({ type: 'run', blocks: [{ label: 'Principal', durationType: 'distance', distanceValue: km, distanceUnit: 'km', paceRange: '6:00/km a 6:00/km' }], distanceKm: km });

function sessionRow(overrides: Record<string, unknown> = {}) {
  return { id: 's1', userId: 'u1', modality: 'corrida', origin: 'agent', scheduledDate: new Date(`${FUTURE_DATE}T00:00:00Z`), distanceKm: 5, structure: runStructure(5), completion: null, ...overrides } as Record<string, any>;
}

describe('apple-run-workout — elegibilidade (so\' corrida continua externa por distancia)', () => {
  const input = (overrides: Record<string, unknown> = {}) => ({ id: 's1', modality: 'corrida', origin: 'agent', scheduledDate: new Date(`${FUTURE_DATE}T00:00:00Z`), distanceKm: 5, structure: runStructure(5), ...overrides }) as Parameters<typeof appleRunEligibility>[0];
  const TODAY = '2026-10-07';

  it('sessao continua externa de 5 km e conversivel; distancia e data reais vao no workout canonico', () => {
    const result = appleRunEligibility(input(), TODAY);
    expect(result).toMatchObject({ eligible: true, distanceKm: 5, scheduledDate: FUTURE_DATE });
    if (result.eligible) expect(result.canonicalWorkout).toMatchObject({ kind: 'run', pacing: 'continuous', location: 'outdoor', goal: { type: 'distance', distanceKm: 5 }, trainingSessionId: 's1' });
  });

  it.each([
    ['intervalado', { structure: { type: 'run', blocks: [{ repeatCount: 6, steps: [{}] }] } }, 'intervalado'],
    ['varias partes (caminhada/corrida mista)', { structure: { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 2 }, { durationType: 'distance', distanceValue: 3 }] } }, 'varias_partes'],
    ['por tempo', { structure: { type: 'run', blocks: [{ durationType: 'time', durationMin: 30 }] }, distanceKm: null }, 'por_tempo'],
    ['esteira', { modality: 'esteira' }, 'modalidade_nao_suportada'],
    ['forca', { modality: 'forca', structure: { type: 'strength' } }, 'modalidade_nao_suportada'],
    ['sessao extra (device_extra)', { origin: 'device_extra' }, 'sessao_extra'],
    ['data passada', { scheduledDate: new Date('2020-01-01T00:00:00Z') }, 'data_passada'],
    ['ja registrada pelo aluno', { completionStatus: 'done' }, 'sessao_ja_registrada'],
    ['distancia da estrutura diverge da gravada', { distanceKm: 8 }, 'distancia_inconsistente'],
    ['sem distancia', { structure: { type: 'run', blocks: [{ durationType: 'distance' }] }, distanceKm: null }, 'distancia_invalida'],
  ])('%s -> envio indisponivel', (_name, overrides, reason) => {
    expect(appleRunEligibility(input(overrides as Record<string, unknown>), TODAY)).toEqual({ eligible: false, reason });
  });

  it('modalidade pela representacao canonica: "RUNNING" legado ainda e corrida', () => {
    expect(appleRunEligibility(input({ modality: 'RUNNING' }), TODAY).eligible).toBe(true);
  });
});

function build(sessionOverrides: Record<string, unknown> = {}, store?: { deliveries: Map<string, any>; sessions: Map<string, any> }) {
  let seq = 0;
  const sessions = store?.sessions ?? new Map<string, any>([['s1', sessionRow(sessionOverrides)]]);
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

describe('AppleWatchDeliveryService — identidade persistente da entrega (WorkoutDelivery)', () => {
  it('prepare cria UMA entrega ligada a TrainingSession, com UUID persistido (externalWorkoutId + metadata) e snapshot canonico; nada de ActivityLog', async () => {
    const { service, deliveries, activityLog } = build();
    const result = await service.prepare('u1', 's1');
    expect(result).toMatchObject({ eligible: true, distanceKm: 5, scheduledDate: FUTURE_DATE });
    expect(deliveries.size).toBe(1);
    const row = [...deliveries.values()][0];
    expect(row).toMatchObject({ trainingSessionId: 's1', provider: APPLE_WORKOUTKIT_PROVIDER, status: 'pending', deliveredAt: null });
    expect(row.externalWorkoutId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row.providerMetadata.workoutPlanId).toBe(row.externalWorkoutId);
    expect(row.canonicalWorkout).toMatchObject({ goal: { distanceKm: 5 }, scheduledDate: FUTURE_DATE, trainingSessionId: 's1' });
    expect(activityLog.create).not.toHaveBeenCalled(); // enviar nao cria PhysicalEvent/ActivityLog
  });

  it('segundo toque (inclusive simultaneo) devolve a MESMA entrega e o MESMO planId: nunca uma segunda entrega', async () => {
    const { service, deliveries } = build();
    const [a, b] = await Promise.all([service.prepare('u1', 's1'), service.prepare('u1', 's1')]);
    const c = await service.prepare('u1', 's1');
    expect(deliveries.size).toBe(1);
    expect((a as any).delivery.planId).toBe((b as any).delivery.planId);
    expect((c as any).delivery.planId).toBe((a as any).delivery.planId);
  });

  it('fechar/reabrir o app (novo servico, mesmo banco): a identidade da entrega permanece', async () => {
    const first = build();
    const original = await first.service.prepare('u1', 's1');
    const reopened = build({}, { deliveries: first.deliveries, sessions: first.sessions });
    const again = await reopened.service.prepare('u1', 's1');
    expect((again as any).delivery.planId).toBe((original as any).delivery.planId);
    expect(first.deliveries.size).toBe(1);
  });

  it('sessao incompativel: envio indisponivel, nenhuma entrega criada', async () => {
    const { service, deliveries } = build({ structure: { type: 'run', blocks: [{ repeatCount: 4, steps: [{}] }] } });
    expect(await service.prepare('u1', 's1')).toEqual({ eligible: false, reason: 'intervalado' });
    expect(await service.eligibility('u1', 's1')).toEqual({ eligible: false, reason: 'intervalado' });
    expect(deliveries.size).toBe(0);
  });

  it('sessao de outro aluno: nao encontrada', async () => {
    const { service } = build();
    await expect(service.prepare('outro', 's1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('confirmSent registra SO\' "sent" (nunca delivered_to_device), mantem planId e e idempotente; falha nao rebaixa um envio', async () => {
    const { service, deliveries } = build();
    const prepared = (await service.prepare('u1', 's1')) as any;
    const sent = await service.confirmSent('u1', prepared.delivery.id);
    expect(sent).toMatchObject({ status: 'sent', planId: prepared.delivery.planId });
    const row = deliveries.get(prepared.delivery.id);
    expect(row).toMatchObject({ status: 'sent', deliveredAt: null, externalWorkoutId: prepared.delivery.planId });
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(row.providerMetadata.schedulingEvidence).toBe('listed_in_workoutkit_scheduled');
    expect((await service.confirmSent('u1', prepared.delivery.id)).status).toBe('sent');
    expect((await service.reportFailure('u1', prepared.delivery.id, 'x')).status).toBe('sent');
  });

  it('falha registrada nao conta como envio; depois da falha uma nova tentativa reserva nova identidade (a anterior nunca foi agendada)', async () => {
    const { service, deliveries } = build();
    const first = (await service.prepare('u1', 's1')) as any;
    expect((await service.reportFailure('u1', first.delivery.id, 'WorkoutKit nao autorizado')).status).toBe('failed');
    expect(deliveries.get(first.delivery.id)).toMatchObject({ status: 'failed', errorMessage: 'WorkoutKit nao autorizado' });
    const second = (await service.prepare('u1', 's1')) as any;
    expect(second.delivery.id).not.toBe(first.delivery.id);
    expect(deliveries.size).toBe(2);
  });

  it('prescricao alterada: reserva pendente e refeita; entrega ja enviada continua e e sinalizada como desatualizada', async () => {
    const pending = build();
    const first = (await pending.service.prepare('u1', 's1')) as any;
    Object.assign(pending.sessions.get('s1'), { distanceKm: 8, structure: runStructure(8) });
    const second = (await pending.service.prepare('u1', 's1')) as any;
    expect(second.delivery.id).not.toBe(first.delivery.id);
    expect(pending.deliveries.get(first.delivery.id).status).toBe('canceled');
    expect(second.distanceKm).toBe(8);

    const sentOne = build();
    const prepared = (await sentOne.service.prepare('u1', 's1')) as any;
    await sentOne.service.confirmSent('u1', prepared.delivery.id);
    Object.assign(sentOne.sessions.get('s1'), { distanceKm: 8, structure: runStructure(8) });
    const view = (await sentOne.service.eligibility('u1', 's1')) as any;
    expect(view.delivery).toMatchObject({ id: prepared.delivery.id, status: 'sent', outdated: true });
    expect(sentOne.deliveries.size).toBe(1);
  });
});

describe('sendSessionToAppleWatch — orquestracao (app) com WorkoutKit simulado', () => {
  function world(sessionOverrides: Record<string, unknown> = {}, shared?: ReturnType<typeof build>, deviceState?: { scheduled: Array<{ planId: string }> }) {
    const base = shared ?? build(sessionOverrides);
    const device = deviceState ?? { scheduled: [] };
    const scheduleCalls: Array<{ planId: string; distanceKm: number; date: Date }> = [];
    const behavior = { failSchedule: false, ignoreSchedule: false };
    const api: AppleWatchApi = {
      prepare: (id) => base.service.prepare('u1', id) as never,
      confirmSent: (deliveryId) => base.service.confirmSent('u1', deliveryId),
      reportFailure: (deliveryId, message) => base.service.reportFailure('u1', deliveryId, message),
    };
    const native: AppleWatchNative = {
      isSupported: true,
      requestAuthorization: async () => 'authorized',
      listScheduled: async () => [...device.scheduled],
      scheduleRun: async (planId, distanceKm, date) => {
        scheduleCalls.push({ planId, distanceKm, date });
        if (behavior.failSchedule) throw new Error('E_NOT_AUTHORIZED');
        if (!behavior.ignoreSchedule) device.scheduled.push({ planId });
      },
    };
    return { base, api, native, device, scheduleCalls, behavior };
  }

  it('sessao de 5 km: a distancia e a data reais da sessao chegam ao WorkoutKit e o envio registra SO\' "sent"', async () => {
    const w = world();
    const result = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(result).toMatchObject({ ok: true, state: 'scheduled' });
    expect(w.scheduleCalls).toHaveLength(1);
    expect(w.scheduleCalls[0].distanceKm).toBe(5);
    expect([w.scheduleCalls[0].date.getFullYear(), w.scheduleCalls[0].date.getMonth(), w.scheduleCalls[0].date.getDate()]).toEqual([2099, 0, 10]);
    const delivery = [...w.base.deliveries.values()][0];
    expect(delivery).toMatchObject({ status: 'sent', externalWorkoutId: w.scheduleCalls[0].planId, deliveredAt: null, trainingSessionId: 's1' });
    expect(w.base.activityLog.create).not.toHaveBeenCalled();
  });

  it('segundo toque nao cria segundo workout nem segunda entrega', async () => {
    const w = world();
    await sendSessionToAppleWatch('s1', w.api, w.native);
    const second = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(second).toMatchObject({ ok: true, state: 'already_scheduled' });
    expect(w.scheduleCalls).toHaveLength(1);
    expect(w.device.scheduled).toHaveLength(1);
    expect(w.base.deliveries.size).toBe(1);
  });

  it('fechar/reabrir o app: mesma identidade; se o aparelho perdeu o plano, reagenda com o MESMO planId', async () => {
    const w1 = world();
    await sendSessionToAppleWatch('s1', w1.api, w1.native);
    const planId = w1.scheduleCalls[0].planId;
    // reabre: servico/app novos sobre o mesmo banco e o mesmo aparelho
    const w2 = world({}, build({}, { deliveries: w1.base.deliveries, sessions: w1.base.sessions }), w1.device);
    expect(await sendSessionToAppleWatch('s1', w2.api, w2.native)).toMatchObject({ ok: true, state: 'already_scheduled', planId });
    expect(w2.scheduleCalls).toHaveLength(0);
    // o plano some do aparelho (removido no Treino): reagenda, mesma identidade
    w1.device.scheduled.length = 0;
    const w3 = world({}, build({}, { deliveries: w1.base.deliveries, sessions: w1.base.sessions }), w1.device);
    expect(await sendSessionToAppleWatch('s1', w3.api, w3.native)).toMatchObject({ ok: true, state: 'scheduled', planId });
    expect(w3.scheduleCalls[0].planId).toBe(planId);
    expect(w1.base.deliveries.size).toBe(1);
  });

  it('falha no WorkoutKit: nao registra envio como sucesso (entrega fica failed)', async () => {
    const w = world();
    w.behavior.failSchedule = true;
    const result = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(result).toMatchObject({ ok: false, reason: 'falha_workoutkit' });
    const delivery = [...w.base.deliveries.values()][0];
    expect(delivery).toMatchObject({ status: 'failed', sentAt: null, deliveredAt: null });
  });

  it('agendamento nao confirmado na lista do WorkoutKit: nao e registrado como enviado', async () => {
    const w = world();
    w.behavior.ignoreSchedule = true;
    const result = await sendSessionToAppleWatch('s1', w.api, w.native);
    expect(result).toMatchObject({ ok: false, reason: 'agendamento_nao_confirmado' });
    expect([...w.base.deliveries.values()][0]).toMatchObject({ status: 'failed', sentAt: null });
  });

  it('sessao incompativel: nada e agendado nem criado', async () => {
    const w = world({ structure: { type: 'run', blocks: [{ durationType: 'time', durationMin: 40 }] }, distanceKm: null });
    expect(await sendSessionToAppleWatch('s1', w.api, w.native)).toMatchObject({ ok: false, reason: 'por_tempo' });
    expect(w.scheduleCalls).toHaveLength(0);
    expect(w.base.deliveries.size).toBe(0);
  });

  it('fora do app nativo iOS: indisponivel, sem chamadas', async () => {
    const w = world();
    expect(await sendSessionToAppleWatch('s1', w.api, { ...w.native, isSupported: false })).toMatchObject({ ok: false, reason: 'nao_suportado' });
    expect(w.base.deliveries.size).toBe(0);
  });

  it('sessionDateToLocalNoon: dia da sessao ao meio-dia local (nao desloca o dia)', () => {
    const date = sessionDateToLocalNoon('2026-12-31');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 11, 31, 12]);
  });
});
