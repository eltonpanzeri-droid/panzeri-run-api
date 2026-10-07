import { PrismaService } from '../src/prisma/prisma.service';
import { SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';
import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { WeeklyCheckInService } from '../src/training-plans/weekly-checkin.service';

// 3C.2 (correcao de semantica) — WorkoutCompletion 'missed' EXPLICITO + PhysicalEvent compativel:
//  - a TrainingSession permanece nao realizada (nao conta como feita; conta como nao feita);
//  - o PhysicalEvent continua sendo exercicio realizado e, para aderencia, e' atividade ADICIONAL (alternative), nunca o cumprimento daquela
//    prescricao; suas metricas objetivas seguem validas; Polar + Apple continuam sendo uma atividade so';
//  - sem 'nao feito' explicito, o evento reconciliado comprova a execucao mesmo sem feedback.
function fixture() {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;
  const activityLogs = new Map<string, any>();
  const sessions = new Map<string, any>();
  const links = new Map<string, any>();

  const prisma = {
    activityLog: {
      findUnique: jest.fn(async ({ where }: any) => activityLogs.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        [...activityLogs.values()].filter((a) => {
          if (where.userId !== undefined && a.userId !== where.userId) return false;
          if (where.physicalEventId !== undefined && a.physicalEventId !== where.physicalEventId) return false;
          if (where.id?.not !== undefined && a.id === where.id.not) return false;
          if (where.id?.in !== undefined && !where.id.in.includes(a.id)) return false;
          if (where.OR !== undefined && !where.OR.some((c: any) => a.executionClassification === c.executionClassification)) return false;
          if (typeof where.executionClassification === 'string' && a.executionClassification !== where.executionClassification) return false;
          if (where.executionClassification?.in !== undefined && !where.executionClassification.in.includes(a.executionClassification)) return false;
          return true;
        }),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...activityLogs.get(where.id), ...data };
        activityLogs.set(where.id, updated);
        return updated;
      }),
    },
    trainingSession: {
      findUnique: jest.fn(async ({ where }: any) => sessions.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        [...sessions.values()]
          .filter((s) => (where.userId === undefined || s.userId === where.userId)
            && (where.scheduledDate === undefined || s.scheduledDate.getTime() === where.scheduledDate.getTime())
            && (where.origin === undefined || s.origin === where.origin))
          .map((s) => ({ ...s, executionLinks: [...links.values()].filter((l) => l.trainingSessionId === s.id && l.status === 'active') })),
      ),
      update: jest.fn(async ({ where, data }: any) => ({ ...sessions.get(where.id), ...data })),
    },
    sessionExecutionLink: {
      findUnique: jest.fn(async ({ where }: any) => links.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        [...links.values()]
          .filter((l) => {
            const ids = where.activityLogId?.in ?? (where.activityLogId !== undefined ? [where.activityLogId] : null);
            if (ids && !ids.includes(l.activityLogId)) return false;
            if (where.trainingSessionId !== undefined && l.trainingSessionId !== where.trainingSessionId) return false;
            if (where.status?.in !== undefined && !where.status.in.includes(l.status)) return false;
            if (typeof where.status === 'string' && l.status !== where.status) return false;
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId('link'), createdAt: new Date(Date.now() + seq), revokedAt: null, supersededByLinkId: null, matchMethod: null, evidence: null, confidence: null, note: null, ...data };
        links.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...links.get(where.id), ...data };
        links.set(where.id, updated);
        return updated;
      }),
      count: jest.fn(async () => 0),
    },
    trainingPlan: { findFirst: jest.fn(async () => null) },
    workoutCompletion: { findUnique: jest.fn(async () => null), create: jest.fn(), update: jest.fn() },
  };
  const service = new SessionExecutionLinkService(prisma as unknown as PrismaService);

  const addActivity = (overrides: Record<string, unknown> = {}) => {
    const row = {
      id: nextId('act'), userId: 'u1', provider: 'polar', externalId: nextId('ext'), startedAt: new Date('2026-09-30T10:00:00Z'), utcOffsetMinutes: -180,
      sport: 'corrida', distanceMeters: 10000, durationSec: 3000, cadenceAvg: 170, executionClassification: null, executionClassifiedAt: null, executionClassifiedBy: null,
      physicalEventId: null, physicalIdentityStatus: 'unique', physicalCanonicalActivityLogId: null, ...overrides,
    };
    activityLogs.set(row.id as string, row);
    return row as any;
  };
  const addSession = (overrides: Record<string, unknown> = {}) => {
    const row = { id: nextId('s'), userId: 'u1', planId: 'plan', scheduledDate: new Date('2026-09-30T00:00:00Z'), modality: 'corrida', distanceKm: 10, durationMin: 50, origin: 'ai', structure: {}, completion: null, ...overrides };
    sessions.set(row.id as string, row);
    return row as any;
  };
  const polarAppleEvent = () => {
    const polar = addActivity({ provider: 'polar' });
    const apple = addActivity({ provider: 'apple_health', startedAt: new Date('2026-09-30T10:00:01Z'), distanceMeters: 10100, cadenceAvg: 150 });
    for (const a of [polar, apple]) Object.assign(a, { physicalEventId: 'ev-1', physicalIdentityStatus: 'matched', physicalCanonicalActivityLogId: polar.id });
    return { polar, apple };
  };
  const activeLinks = () => [...links.values()].filter((l) => l.status === 'active');
  return { service, prisma, activityLogs, sessions, links, addActivity, addSession, polarAppleEvent, activeLinks };
}

describe('3C.2 — "nao feito" explicito x PhysicalEvent compativel (3B)', () => {
  it('vinculo automatico ja existente numa sessao que o aluno marca "nao feito": o vinculo vira historico revogado e o evento passa a atividade adicional', async () => {
    const f = fixture();
    const { polar, apple } = f.polarAppleEvent();
    const session = f.addSession();
    await f.service.reconcileEvent(polar.id);
    expect(f.activeLinks()).toHaveLength(1); // sem "nao feito": o evento comprova a execucao (comportamento mantido)

    session.completion = { status: 'missed' }; // o aluno registra 'nao feito'
    const results = await f.service.reconcileEventsOfSession(session.id);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ outcome: 'alternative', classification: 'alternative', canonicalActivityLogId: polar.id, changed: true });
    expect(f.activeLinks()).toHaveLength(0);
    const revoked = [...f.links.values()].filter((l) => l.status === 'revoked');
    expect(revoked).toHaveLength(1); // historico preservado, nunca apagado
    expect(revoked[0]).toMatchObject({ trainingSessionId: session.id, activityLogId: polar.id, note: 'explicit_not_done_by_student' });
    expect(f.activityLogs.get(polar.id)).toMatchObject({ executionClassification: 'alternative', distanceMeters: 10000, cadenceAvg: 170 });
    expect(f.activityLogs.get(apple.id).executionClassification).toBeNull(); // Polar + Apple seguem sendo UMA atividade
    expect(f.activeLinks()).toHaveLength(0);

    // idempotente
    expect((await f.service.reconcileEvent(polar.id))).toMatchObject({ outcome: 'unchanged', changed: false, classification: 'alternative' });
  });

  it('sem vinculo previo: sessao com "nao feito" explicito nao e candidata; o evento fica como adicional', async () => {
    const f = fixture();
    const { polar } = f.polarAppleEvent();
    f.addSession({ completion: { status: 'missed' } });
    expect(await f.service.reconcileEvent(polar.id)).toMatchObject({ outcome: 'alternative', classification: 'alternative' });
    expect(f.activeLinks()).toHaveLength(0);
  });

  it('com outra sessao compativel do mesmo dia (nao marcada), o evento vincula a ela e a "nao feita" permanece sem execucao', async () => {
    const f = fixture();
    const { polar } = f.polarAppleEvent();
    const missed = f.addSession({ completion: { status: 'missed' }, title: 'nao feita' });
    const other = f.addSession({ title: 'outra' });
    expect(await f.service.reconcileEvent(polar.id)).toMatchObject({ outcome: 'linked', classification: 'corresponding' });
    expect(f.activeLinks().map((l) => l.trainingSessionId)).toEqual([other.id]);
    expect(f.activeLinks().some((l) => l.trainingSessionId === missed.id)).toBe(false);
  });

  it('SEM "nao feito" explicito: o evento reconciliado comprova a execucao mesmo sem feedback (comportamento mantido)', async () => {
    const f = fixture();
    const { polar } = f.polarAppleEvent();
    const session = f.addSession({ completion: null });
    expect(await f.service.reconcileEvent(polar.id)).toMatchObject({ outcome: 'linked', classification: 'corresponding' });
    expect(f.activeLinks().map((l) => l.trainingSessionId)).toEqual([session.id]);
    // alterar para um status que NAO e' "nao feito" (ex.: feito) nao revoga nada
    session.completion = { status: 'done' };
    await f.service.reconcileEventsOfSession(session.id);
    expect(f.activeLinks()).toHaveLength(1);
  });

  it('decisao humana de vinculo (coach) continua prevalecendo; so o vinculo AUTOMATICO cede ao "nao feito" do aluno', async () => {
    const f = fixture();
    const { polar } = f.polarAppleEvent();
    const session = f.addSession({ completion: { status: 'missed' } });
    await f.service.linkManually({ trainingSessionId: session.id, activityLogId: polar.id, origin: 'coach' });
    const result = await f.service.reconcileEvent(polar.id);
    expect(result.outcome).toBe('human_preserved');
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activeLinks()[0]).toMatchObject({ origin: 'coach', trainingSessionId: session.id });
  });
});

describe('3C.2 — consumidores apos o "nao feito" explicito', () => {
  async function reconciled() {
    const f = fixture();
    const { polar } = f.polarAppleEvent();
    const session = f.addSession();
    await f.service.reconcileEvent(polar.id);
    session.completion = { status: 'missed' };
    await f.service.reconcileEventsOfSession(session.id);
    return { f, polar, session };
  }

  it('Weekly check-in: a sessao conta como nao feita (nao como feita) e o evento e reconhecido UMA vez como atividade adicional', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T15:00:00Z'), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
    try {
      const { f, session } = await reconciled();
      const prisma = {
        trainingPlan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan', startDate: new Date('2026-09-28T00:00:00Z') }) },
        weeklyCheckIn: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
        weeklyAvailability: { findFirst: jest.fn().mockResolvedValue(null) },
        trainingSession: {
          findMany: jest.fn().mockResolvedValue([
            { id: session.id, title: 'Treino', scheduledDate: session.scheduledDate, origin: 'ai', completion: { status: 'missed' }, executionLinks: [...f.links.values()].filter((l) => l.status === 'active') },
          ]),
        },
        activityLog: f.prisma.activityLog,
      };
      const summary = (await new WeeklyCheckInService(prisma as never, {} as never, {} as never).getStatus('u1')).summary!;
      expect(summary.missedSessions).toBe(1);
      expect(summary.asPrescribedSessions).toBe(0);
      expect(summary.additionalActivities).toBe(1); // Polar + Apple = uma atividade
    } finally {
      jest.useRealTimers();
    }
  });

  it('Evolution: sessao nao feita; o evento entra no realizado como extra (uma vez), sem cumprir a prescricao', async () => {
    const { f } = await reconciled();
    const sessionRow = { id: 's', userId: 'u1', scheduledDate: new Date('2026-08-03T00:00:00Z'), modality: 'corrida', distanceKm: 10, structure: { source: 'agent', type: 'run' }, origin: 'agent', plan: { status: 'active' }, completion: { status: 'missed' }, executionLinks: [] };
    const activities = [...f.activityLogs.values()].map((a) => ({ ...a, startedAt: new Date('2026-08-03T10:00:00Z'), utcOffsetMinutes: 0 }));
    const prisma = { trainingSession: { findMany: jest.fn().mockResolvedValue([sessionRow]) }, activityLog: { findMany: jest.fn(async ({ where }: any) => activities.filter((a) => (where.id?.in ? where.id.in.includes(a.id) : true) && (where.executionClassification?.in ? where.executionClassification.in.includes(a.executionClassification) : true))) } };
    const week = (await new EvolutionMetricService(prisma as never).getSeries('u1')).weeks[0];
    expect(week.sessoesFeitas).toBe(0);
    expect(week.kmPercorridos).toBe(10); // metricas objetivas validas, contadas uma vez (canonica)
    expect(week.kmExtras).toBe(10);
  });

  it('Training Intelligence: pace/cadencia do evento seguem validos (uma observacao, da canonica)', async () => {
    const { f } = await reconciled();
    const reader = new ObservationReaderService({ activityLog: f.prisma.activityLog } as never, {} as never, {} as never);
    const cadence = await reader.getObservations('u1', 'activity.cadenceAvg');
    expect(cadence.map((o) => o.value)).toEqual([170]);
    const pace = await reader.getObservations('u1', 'activity.avgPaceSecondsKm');
    expect(pace.map((o) => o.value)).toEqual([300]);
  });
});
