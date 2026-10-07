import { PrismaService } from '../src/prisma/prisma.service';
import { SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { WeeklyCheckInService } from '../src/training-plans/weekly-checkin.service';

// 3C.2 — training-plans (historico + getWeekReconciliation) e weekly-checkin: uma atividade fisica = um cartao/execucao (observacao canonica da
// 3A); execucao objetiva e feedback subjetivo sao conceitos separados; decisoes humanas e sessoes sinteticas device_extra preservadas.
const ev = (eventId: string, canonicalId: string) => ({ physicalIdentityStatus: 'matched', physicalEventId: eventId, physicalCanonicalActivityLogId: canonicalId });

function act(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, userId: 'u1', provider: 'polar', sport: 'corrida', startedAt: new Date('2026-09-30T10:00:00Z'), utcOffsetMinutes: -180, distanceMeters: 10000, durationSec: 3000,
    avgHeartRateBpm: 150, maxHeartRateBpm: 170, cadenceAvg: 170, executionClassification: null, physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null,
    ...overrides,
  } as Record<string, any>;
}

function activityStore(rows: Array<Record<string, any>>) {
  return {
    findMany: jest.fn(async ({ where }: any) =>
      rows.filter((r) => {
        if (where.userId !== undefined && r.userId !== where.userId) return false;
        if (where.id?.in !== undefined && !where.id.in.includes(r.id)) return false;
        if (typeof where.executionClassification === 'string' && r.executionClassification !== where.executionClassification) return false;
        if (where.startedAt?.gte !== undefined && r.startedAt < where.startedAt.gte) return false;
        if (where.startedAt?.lt !== undefined && r.startedAt >= where.startedAt.lt) return false;
        return true;
      }),
    ),
  };
}

describe('3C.2 — getWeekReconciliation: um cartao por PhysicalEvent', () => {
  function build(activities: Array<Record<string, any>>, links: Array<Record<string, any>>, sessionsRows: Array<Record<string, any>> = []) {
    const prisma = {
      activityLog: activityStore(activities),
      sessionExecutionLink: {
        findMany: jest.fn(async ({ where }: any) =>
          links.filter((l) => where.activityLogId.in.includes(l.activityLogId) && where.status.in.includes(l.status)).map((l) => ({ ...l, trainingSession: { id: l.trainingSessionId, title: 'Longao', modality: 'corrida', scheduledDate: new Date('2026-09-30T00:00:00Z') } })),
        ),
      },
      trainingSession: { findMany: jest.fn(async () => sessionsRows) },
    };
    return new SessionExecutionLinkService(prisma as unknown as PrismaService);
  }
  const range = [new Date('2026-09-28T00:00:00Z'), new Date('2026-10-05T00:00:00Z')] as const;

  it('vinculo ativo na canonica: uma execucao; a copia Apple nao reaparece como alternativa nem candidata', async () => {
    const polar = act('polar-1', { ...ev('e1', 'polar-1'), executionClassification: 'corresponding' });
    const apple = act('apple-1', { ...ev('e1', 'polar-1'), provider: 'apple_health', distanceMeters: 10300 });
    const result = await build([polar, apple], [{ id: 'l1', trainingSessionId: 's1', activityLogId: 'polar-1', status: 'active', origin: 'automatic', matchMethod: 'automatic_single_candidate' }]).getWeekReconciliation('u1', ...range);
    expect([...result.activeLinkBySessionId.values()].map((l) => l.activityLog.id)).toEqual(['polar-1']);
    expect(result.alternativeActivities).toEqual([]);
    expect(result.pendingActivities).toEqual([]);
  });

  it('vinculo legado (humano) na observacao NAO canonica: o cartao mostra os dados da canonica e a decisao humana e mantida', async () => {
    const polar = act('polar-1', { ...ev('e1', 'polar-1'), distanceMeters: 10020 });
    const apple = act('apple-1', { ...ev('e1', 'polar-1'), provider: 'apple_health', distanceMeters: 10300, executionClassification: 'corresponding' });
    const link = { id: 'l1', trainingSessionId: 's1', activityLogId: 'apple-1', status: 'active', origin: 'coach', matchMethod: null };
    const result = await build([polar, apple], [link]).getWeekReconciliation('u1', ...range);
    const shown = result.activeLinkBySessionId.get('s1')!;
    expect(shown.activityLog.id).toBe('polar-1');
    expect(shown.activityLog.distanceMeters).toBe(10020);
    expect(link).toMatchObject({ origin: 'coach', activityLogId: 'apple-1', status: 'active' }); // nada reescrito
    expect(result.alternativeActivities).toEqual([]); // o evento tem vinculo: nao reaparece
  });

  it('atividade alternativa: Polar + Apple do mesmo evento = UM cartao (canonica); atividade livre unica continua aparecendo', async () => {
    const polar = act('polar-1', { ...ev('e1', 'polar-1'), executionClassification: 'alternative' });
    const apple = act('apple-1', { ...ev('e1', 'polar-1'), provider: 'apple_health', executionClassification: 'alternative' });
    const free = act('free-1', { startedAt: new Date('2026-10-01T10:00:00Z'), executionClassification: 'alternative' });
    const result = await build([polar, apple, free], []).getWeekReconciliation('u1', ...range);
    expect(result.alternativeActivities.map((a) => a.id)).toEqual(['polar-1', 'free-1']);
  });

  it('candidatas: um cartao por evento, opcoes reunidas sem repetir a mesma sessao', async () => {
    const polar = act('polar-1', { ...ev('e1', 'polar-1'), executionClassification: 'ambiguous' });
    const apple = act('apple-1', { ...ev('e1', 'polar-1'), provider: 'apple_health', executionClassification: 'ambiguous' });
    const links = [
      { id: 'c1', trainingSessionId: 's1', activityLogId: 'polar-1', status: 'candidate', origin: 'automatic' },
      { id: 'c2', trainingSessionId: 's1', activityLogId: 'apple-1', status: 'candidate', origin: 'automatic' },
      { id: 'c3', trainingSessionId: 's2', activityLogId: 'apple-1', status: 'candidate', origin: 'automatic' },
    ];
    const result = await build([polar, apple], links).getWeekReconciliation('u1', ...range);
    expect(result.pendingActivities).toHaveLength(1);
    expect(result.pendingActivities[0].activityLog.id).toBe('polar-1');
    expect(result.pendingActivities[0].candidates.map((c) => c.trainingSessionId).sort()).toEqual(['s1', 's2']);
  });

  it('sessao sintetica device_extra continua escondendo a alternativa materializada (inclusive pela observacao nao canonica)', async () => {
    const polar = act('polar-1', { ...ev('e1', 'polar-1'), executionClassification: 'alternative' });
    const apple = act('apple-1', { ...ev('e1', 'polar-1'), provider: 'apple_health' });
    const result = await build([polar, apple], [], [{ structure: { activityLogId: 'apple-1' } }]).getWeekReconciliation('u1', ...range);
    expect(result.alternativeActivities).toEqual([]);
  });
});

describe('3C.2 — getStudentHistory: um cartao por PhysicalEvent', () => {
  function build(sessions: unknown[], links: unknown[], activities: Array<Record<string, any>>) {
    const prisma = {
      trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) },
      sessionExecutionLink: { findMany: jest.fn().mockResolvedValue(links) },
      activityLog: activityStore(activities),
    };
    const noop = {} as never;
    return new TrainingPlansService(prisma as never, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop);
  }
  const session = (overrides: Record<string, unknown> = {}) => ({
    id: 's1', scheduledDate: new Date('2026-09-30T00:00:00Z'), weekday: 3, modality: 'corrida', title: 'Longao', structure: {}, origin: 'agent', completion: null, plan: { status: 'active' }, ...overrides,
  });

  it('atividades alternativas Polar + Apple do mesmo evento = um cartao, com modalidade canonica (RUNNING legado -> corrida)', async () => {
    const polar = act('polar-1', { ...ev('e1', 'polar-1'), sport: 'RUNNING', executionClassification: 'alternative' });
    const apple = act('apple-1', { ...ev('e1', 'polar-1'), provider: 'apple_health', sport: 'corrida', executionClassification: 'alternative' });
    const free = act('free-1', { startedAt: new Date('2026-10-01T10:00:00Z'), executionClassification: 'alternative' });
    const history = await build([], [], [polar, apple, free]).getStudentHistory('u1');
    const cards = history.flatMap((w) => w.sessions);
    expect(cards.map((c) => c.id).sort()).toEqual(['activity:free-1', 'activity:polar-1']);
    expect(cards.find((c) => c.id === 'activity:polar-1')).toMatchObject({ modality: 'corrida', isAlternativeActivity: true });
  });

  it('sessao vinculada pela observacao nao canonica (legado): distancia da canonica e a copia nao vira alternativa', async () => {
    const polar = act('polar-1', { ...ev('e1', 'polar-1'), distanceMeters: 10020 });
    const apple = act('apple-1', { ...ev('e1', 'polar-1'), provider: 'apple_health', distanceMeters: 10300, executionClassification: 'alternative' });
    const link = { trainingSessionId: 's1', activityLogId: 'apple-1', activityLog: apple };
    const history = await build([session()], [link], [polar, apple]).getStudentHistory('u1');
    const cards = history.flatMap((w) => w.sessions);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: 's1', executionStatus: 'realized', completedDistanceKm: 10.02 });
  });

  it('sessao sintetica device_extra continua representando a alternativa materializada (sem cartao duplicado)', async () => {
    const polar = act('polar-1', { ...ev('e1', 'polar-1'), executionClassification: 'alternative' });
    const synthetic = session({ id: 'syn', origin: 'device_extra', structure: { type: 'extra', source: 'device', activityLogId: 'polar-1' }, completion: { status: 'done', distanceKm: 10, perceivedEffort: null } });
    const history = await build([synthetic], [], [polar]).getStudentHistory('u1');
    expect(history.flatMap((w) => w.sessions).map((c) => c.id)).toEqual(['syn']);
  });
});

describe('3C.2 — Weekly check-in: execucao objetiva x feedback subjetivo', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-02T15:00:00Z'), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  });
  afterEach(() => jest.useRealTimers());

  const PLAN = { id: 'plan-1', startDate: new Date('2026-09-28T00:00:00Z') };
  const sess = (date: string, overrides: Record<string, unknown> = {}) => ({
    id: `s-${date}`, title: 'Treino', scheduledDate: new Date(`${date}T00:00:00Z`), origin: 'agent', completion: null, executionLinks: [], ...overrides,
  });

  async function summaryFor(sessions: unknown[], activities: Array<Record<string, any>> = []) {
    const prisma = {
      trainingPlan: { findFirst: jest.fn().mockResolvedValue(PLAN) },
      weeklyCheckIn: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
      weeklyAvailability: { findFirst: jest.fn().mockResolvedValue(null) },
      trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) },
      activityLog: activityStore(activities),
    };
    const status = await new WeeklyCheckInService(prisma as never, {} as never, {} as never).getStatus('u1');
    return status.summary!;
  }

  it('execucao objetiva SEM feedback conta como feita; sem WorkoutCompletion nunca vira "nao feito" nem inventa resposta', async () => {
    const summary = await summaryFor([sess('2026-09-29', { executionLinks: [{ id: 'l1' }] }), sess('2026-09-30')]);
    expect(summary.asPrescribedSessions).toBe(1); // a com vinculo ativo
    expect(summary.missedSessions).toBe(0); // a sem nada nao e' "nao feita"
  });

  it('status explicito do aluno continua valendo: "nao feito" com vinculo ativo permanece nao feito (nao sobrescrevo o registro do aluno)', async () => {
    const summary = await summaryFor([sess('2026-09-29', { executionLinks: [{ id: 'l1' }], completion: { status: 'missed' } })]);
    expect(summary.missedSessions).toBe(1);
    expect(summary.asPrescribedSessions).toBe(0);
  });

  it('feedback registrado (feito/ajustado) segue contando como antes', async () => {
    const summary = await summaryFor([sess('2026-09-29', { completion: { status: 'done' } }), sess('2026-09-30', { completion: { status: 'adjusted' } })]);
    expect(summary.asPrescribedSessions).toBe(2);
  });

  it('sessao sintetica de atividade adicional (device_extra) nao conta como "feita como prescrito"', async () => {
    const summary = await summaryFor([sess('2026-09-29', { origin: 'device_extra', completion: { status: 'done' } })]);
    expect(summary.asPrescribedSessions).toBe(0);
  });

  it('atividade adicional/livre e reconhecida; Polar + Apple do mesmo evento contam UMA vez; eventos diferentes contam separado', async () => {
    const polar = act('polar-1', { ...ev('e1', 'polar-1'), executionClassification: 'alternative', startedAt: new Date('2026-09-30T10:00:00Z') });
    const apple = act('apple-1', { ...ev('e1', 'polar-1'), provider: 'apple_health', executionClassification: 'alternative', startedAt: new Date('2026-09-30T10:00:01Z') });
    const free = act('free-1', { executionClassification: 'alternative', startedAt: new Date('2026-10-01T10:00:00Z') });
    const summary = await summaryFor([], [polar, apple, free]);
    expect(summary.additionalActivities).toBe(2);
    expect(summary.differentSessions).toBe(0); // 'diferente do prescrito' (ajustado) segue sendo outro conceito
  });

  it('atividade classificada como correspondente nao e "adicional"', async () => {
    const summary = await summaryFor([], [act('c1', { executionClassification: 'corresponding' })]);
    expect(summary.additionalActivities).toBe(0);
  });
});
