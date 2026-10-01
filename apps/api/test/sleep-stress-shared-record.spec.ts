import { WorkoutCompletionsService } from '../src/workout-completions/workout-completions.service';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';

// 01/10/2026 — sono pertence a UMA NOITE por aluno (reutilizada entre sessoes do mesmo dia) e
// estresse tem timestamp real com janela movel de 24h (reaproveitavel/atualizavel), em vez de
// "por sessao". Mock de Prisma com armazenamento REAL em memoria (Map/array), nao so jest.fn
// espionado — permite verificar de fato compartilhamento/ausencia de duplicata, nao so "foi
// chamado". Cobre os 8 cenarios pedidos.

interface Session {
  id: string;
  userId: string;
  scheduledDate: Date;
  title: string;
  modality: string;
  routineMismatchNote: string | null;
}

function buildEnv(sessions: Session[]) {
  const sessionsById = new Map(sessions.map((s) => [s.id, s]));
  const completions = new Map<string, Record<string, unknown>>(); // key: sessionId
  const nights = new Map<string, Record<string, unknown>>(); // key: userId|nightDateISO
  const stressCheckins: Array<Record<string, unknown>> = [];
  let nightSeq = 0;
  let stressSeq = 0;
  let completionSeq = 0;

  const nightKey = (userId: string, nightDate: Date) => `${userId}|${nightDate.toISOString()}`;

  const prisma = {
    trainingSession: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; userId: string } }) => {
        const s = sessionsById.get(where.id);
        return s && s.userId === where.userId ? s : null;
      }),
    },
    workoutCompletion: {
      findUnique: jest.fn(async ({ where }: { where: { sessionId: string } }) => completions.get(where.sessionId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: { where: { sessionId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = completions.get(where.sessionId);
        const row = existing
          ? { ...existing, ...update }
          : { id: `completion-${++completionSeq}`, ...create };
        completions.set(where.sessionId, row);
        return row;
      }),
    },
    nightlySleepLog: {
      upsert: jest.fn(async ({ where, create, update }: { where: { userId_nightDate: { userId: string; nightDate: Date } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = nightKey(where.userId_nightDate.userId, where.userId_nightDate.nightDate);
        const existing = nights.get(key);
        const row = existing ? { ...existing, ...update } : { id: `night-${++nightSeq}`, ...create };
        nights.set(key, row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: { where: { userId: string } }) =>
        [...nights.values()]
          .filter((n) => n.userId === where.userId)
          .sort((a, b) => (a.nightDate as Date).getTime() - (b.nightDate as Date).getTime()),
      ),
    },
    stressCheckin: {
      findFirst: jest.fn(async ({ where }: { where: { userId: string; respondedAt: { gte: Date } } }) => {
        const candidates = stressCheckins
          .filter((c) => c.userId === where.userId && (c.respondedAt as Date) >= where.respondedAt.gte)
          .sort((a, b) => (b.respondedAt as Date).getTime() - (a.respondedAt as Date).getTime());
        return candidates[0] ?? null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = stressCheckins.findIndex((c) => c.id === where.id);
        stressCheckins[idx] = { ...stressCheckins[idx], ...data };
        return stressCheckins[idx];
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `stress-${++stressSeq}`, respondedAt: new Date(), ...data };
        stressCheckins.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: { where: { userId: string } }) =>
        stressCheckins.filter((c) => c.userId === where.userId).sort((a, b) => (a.respondedAt as Date).getTime() - (b.respondedAt as Date).getTime()),
      ),
    },
    user: {
      findUnique: jest.fn(async () => ({ id: 'user-1', name: 'Aluna Teste', studentCode: 1 })),
      findMany: jest.fn(async () => []),
    },
    userNotification: { createMany: jest.fn(async () => ({ count: 0 })) },
  };

  const config = { get: jest.fn(() => '') };
  const studentProfile = { recordEvent: jest.fn(async () => undefined) };
  const telegram = { notifyCoach: jest.fn(async () => undefined) };
  const contextEvents = { linkFirstObservationIfPending: jest.fn(async () => undefined) };
  const reportTimeline = { record: jest.fn() };
  const medalEvaluation = { evaluateForUser: jest.fn(async () => []) };

  const service = new WorkoutCompletionsService(
    prisma as never,
    config as never,
    studentProfile as never,
    telegram as never,
    contextEvents as never,
    reportTimeline as never,
    medalEvaluation as never,
  );

  return { service, prisma, nights, stressCheckins, completions };
}

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    userId: 'user-1',
    scheduledDate: new Date('2026-10-01T00:00:00.000Z'),
    title: 'Corrida leve',
    modality: 'corrida',
    routineMismatchNote: null,
    ...overrides,
  };
}

const sleepBase = {
  preSleepQuality: 4,
  sleepDurationCategory: '7_a_8h' as const,
  bedtimeShiftDirection: 'on_time' as const,
  wakeTimeShiftDirection: 'on_time' as const,
  sleepInterruption: 2,
  sleepDifficulty: 1,
  preStressLevel: 2,
};

describe('Sono por noite e estresse por janela de 24h (registro compartilhado)', () => {
  it('1) duas sessoes no mesmo dia compartilham o MESMO registro de sono', async () => {
    const sessions = [
      session({ id: 's1', scheduledDate: new Date('2026-10-01T00:00:00.000Z') }),
      session({ id: 's2', scheduledDate: new Date('2026-10-01T00:00:00.000Z') }),
    ];
    const { service, nights } = buildEnv(sessions);

    await service.upsert('user-1', { sessionId: 's1', status: 'done', perceivedEffort: 6, satisfactionElaboracao: 'gostei', painFlag: 'none', executionVsPrescribed: 3, postPhysicalFatigue: 2, postMentalFatigue: 2, emotionalExperienceDuring: 4, mentalStateChangePrePost: 4, prePhysicalFatigue: 2, preMentalFatigue: 2, preMotivation: 4, ...sleepBase } as never);
    await service.upsert('user-1', { sessionId: 's2', status: 'done', perceivedEffort: 7, satisfactionElaboracao: 'gostei', painFlag: 'none', executionVsPrescribed: 3, postPhysicalFatigue: 2, postMentalFatigue: 2, emotionalExperienceDuring: 4, mentalStateChangePrePost: 4, prePhysicalFatigue: 2, preMentalFatigue: 2, preMotivation: 4, ...sleepBase } as never);

    expect(nights.size).toBe(1); // uma unica noite, nao duas
    const [night] = [...nights.values()];
    const c1 = await service.upsert('user-1', { sessionId: 's1', status: 'done', perceivedEffort: 6, satisfactionElaboracao: 'gostei', painFlag: 'none', executionVsPrescribed: 3, postPhysicalFatigue: 2, postMentalFatigue: 2, emotionalExperienceDuring: 4, mentalStateChangePrePost: 4, prePhysicalFatigue: 2, preMentalFatigue: 2, preMotivation: 4, ...sleepBase } as never);
    expect((c1 as { nightlySleepLogId: string }).nightlySleepLogId).toBe((night as { id: string }).id);
  });

  it('2) tres sessoes no mesmo dia nao geram tres observacoes na Training Intelligence', async () => {
    const sessions = [
      session({ id: 's1' }),
      session({ id: 's2' }),
      session({ id: 's3' }),
    ];
    const { service, prisma } = buildEnv(sessions);
    for (const id of ['s1', 's2', 's3']) {
      await service.upsert('user-1', { sessionId: id, status: 'done', perceivedEffort: 6, satisfactionElaboracao: 'gostei', painFlag: 'none', executionVsPrescribed: 3, postPhysicalFatigue: 2, postMentalFatigue: 2, emotionalExperienceDuring: 4, mentalStateChangePrePost: 4, prePhysicalFatigue: 2, preMentalFatigue: 2, preMotivation: 4, ...sleepBase } as never);
    }

    // Reader le a MESMA fonte compartilhada (nightlySleepLog.findMany) — monta um reader minimo
    // reaproveitando o prisma real do teste, sem trainingSession.findMany (nao usado neste caso
    // porque todos os completions ja tem nightlySleepLogId, entao o fallback legado nao contribui).
    const readerPrisma = {
      ...prisma,
      trainingSession: { findMany: jest.fn(async () => []) },
      weeklyCheckIn: { findMany: jest.fn(async () => []) },
    };
    const reader = new ObservationReaderService(readerPrisma as never, {} as never, {} as never);
    const obs = await reader.getObservations('user-1', 'workout.preSleepQuality');
    expect(obs).toHaveLength(1); // nao 3
  });

  it('3) alterar o sono atualiza o registro correto (nao cria um segundo)', async () => {
    const sessions = [session({ id: 's1' }), session({ id: 's2' })];
    const { service, nights } = buildEnv(sessions);
    await service.upsert('user-1', { sessionId: 's1', status: 'done', perceivedEffort: 6, satisfactionElaboracao: 'gostei', painFlag: 'none', executionVsPrescribed: 3, postPhysicalFatigue: 2, postMentalFatigue: 2, emotionalExperienceDuring: 4, mentalStateChangePrePost: 4, prePhysicalFatigue: 2, preMentalFatigue: 2, preMotivation: 4, ...sleepBase } as never);
    expect(nights.size).toBe(1);
    const nightIdBefore = [...nights.values()][0].id;

    // Segunda sessao do mesmo dia corrige a qualidade do sono (3 em vez de 4).
    await service.upsert('user-1', { sessionId: 's2', status: 'done', perceivedEffort: 6, satisfactionElaboracao: 'gostei', painFlag: 'none', executionVsPrescribed: 3, postPhysicalFatigue: 2, postMentalFatigue: 2, emotionalExperienceDuring: 4, mentalStateChangePrePost: 4, prePhysicalFatigue: 2, preMentalFatigue: 2, preMotivation: 4, ...sleepBase, preSleepQuality: 3 } as never);

    expect(nights.size).toBe(1); // ainda uma unica noite
    const night = [...nights.values()][0];
    expect(night.id).toBe(nightIdBefore); // MESMO registro, nao um novo
    expect(night.sleepQuality).toBe(3); // valor atualizado
  });

  it('4) treino nao realizado (missed) nao impede registro/reutilizacao do sono', async () => {
    const sessions = [session({ id: 's1' })];
    const { service, nights } = buildEnv(sessions);
    const completion = await service.upsert('user-1', { sessionId: 's1', status: 'missed', ...sleepBase } as never);
    expect(nights.size).toBe(1);
    expect((completion as { nightlySleepLogId: string }).nightlySleepLogId).toBeTruthy();
  });

  it('5) horario mais cedo/mais tarde preserva direcao (nao vira escala artificial)', async () => {
    const sessions = [session({ id: 's1' })];
    const { nights, service } = buildEnv(sessions);
    await service.upsert('user-1', { sessionId: 's1', status: 'done', perceivedEffort: 6, satisfactionElaboracao: 'gostei', painFlag: 'none', executionVsPrescribed: 3, postPhysicalFatigue: 2, postMentalFatigue: 2, emotionalExperienceDuring: 4, mentalStateChangePrePost: 4, prePhysicalFatigue: 2, preMentalFatigue: 2, preMotivation: 4, ...sleepBase, bedtimeShiftDirection: 'much_earlier', wakeTimeShiftDirection: 'moderately_later' } as never);
    const night = [...nights.values()][0];
    expect(night.bedtimeShiftDirection).toBe('much_earlier');
    expect(night.wakeTimeShiftDirection).toBe('moderately_later');
  });

  it('6) horario de despertar e persistido', async () => {
    const sessions = [session({ id: 's1' })];
    const { nights, service } = buildEnv(sessions);
    await service.upsert('user-1', { sessionId: 's1', status: 'done', perceivedEffort: 6, satisfactionElaboracao: 'gostei', painFlag: 'none', executionVsPrescribed: 3, postPhysicalFatigue: 2, postMentalFatigue: 2, emotionalExperienceDuring: 4, mentalStateChangePrePost: 4, prePhysicalFatigue: 2, preMentalFatigue: 2, preMotivation: 4, ...sleepBase, wakeTimeShiftDirection: 'slightly_later' } as never);
    expect([...nights.values()][0].wakeTimeShiftDirection).toBe('slightly_later');
  });

  it('7) estresse recente (dentro de 24h) e reutilizado/atualizado, sem criar observacao fantasma', async () => {
    const sessions = [session({ id: 's1' }), session({ id: 's2' })];
    const { service, stressCheckins } = buildEnv(sessions);

    await service.upsert('user-1', { sessionId: 's1', status: 'done', perceivedEffort: 6, satisfactionElaboracao: 'gostei', painFlag: 'none', executionVsPrescribed: 3, postPhysicalFatigue: 2, postMentalFatigue: 2, emotionalExperienceDuring: 4, mentalStateChangePrePost: 4, prePhysicalFatigue: 2, preMentalFatigue: 2, preMotivation: 4, ...sleepBase, preStressLevel: 3, stressEventFrequency: 2 } as never);
    expect(stressCheckins).toHaveLength(1);
    const respondedAtBefore = stressCheckins[0].respondedAt;

    // Segunda sessao, mesma janela de 24h, atualiza o nivel de estresse.
    await service.upsert('user-1', { sessionId: 's2', status: 'done', perceivedEffort: 6, satisfactionElaboracao: 'gostei', painFlag: 'none', executionVsPrescribed: 3, postPhysicalFatigue: 2, postMentalFatigue: 2, emotionalExperienceDuring: 4, mentalStateChangePrePost: 4, prePhysicalFatigue: 2, preMentalFatigue: 2, preMotivation: 4, ...sleepBase, preStressLevel: 5, stressEventFrequency: 3 } as never);

    expect(stressCheckins).toHaveLength(1); // nao criou um segundo
    expect(stressCheckins[0].stressLevel).toBe(5); // atualizado
    expect(stressCheckins[0].stressEventFrequency).toBe(3);
    expect(stressCheckins[0].respondedAt).toBe(respondedAtBefore); // timestamp original preservado
  });

  it('8) as demais perguntas (6, 7, 9-16) continuam sendo exigidas e persistidas normalmente', async () => {
    const sessions = [session({ id: 's1' })];
    const { service, completions } = buildEnv(sessions);
    const dto = {
      sessionId: 's1',
      status: 'done' as const,
      perceivedEffort: 8,
      satisfactionElaboracao: 'amei',
      painFlag: 'none',
      ...sleepBase,
      prePhysicalFatigue: 3, // pergunta 6
      preMentalFatigue: 2, // pergunta 7
      preMotivation: 5, // pergunta 9
      executionVsPrescribed: 4, // pergunta 12
      postPhysicalFatigue: 3, // pergunta 13
      postMentalFatigue: 2, // pergunta 14
      emotionalExperienceDuring: 5, // pergunta 15
      mentalStateChangePrePost: 5, // pergunta 16
    };
    const result = await service.upsert('user-1', dto as never);
    expect(result).toBeTruthy();
    const completion = completions.get('s1')!;
    expect(completion.prePhysicalFatigue).toBe(3);
    expect(completion.preMentalFatigue).toBe(2);
    expect(completion.preMotivation).toBe(5);
    expect(completion.executionVsPrescribed).toBe(4);
    expect(completion.postPhysicalFatigue).toBe(3);
    expect(completion.postMentalFatigue).toBe(2);
    expect(completion.emotionalExperienceDuring).toBe(5);
    expect(completion.mentalStateChangePrePost).toBe(5);
  });

  it('9) envio com status "adjusted" tambem resolve/compartilha sono e estresse normalmente', async () => {
    const sessions = [session({ id: 's1' })];
    const { service, nights, stressCheckins } = buildEnv(sessions);
    const result = await service.upsert('user-1', {
      sessionId: 's1',
      status: 'adjusted',
      perceivedEffort: 7,
      satisfactionElaboracao: 'gostei',
      painFlag: 'none',
      executionVsPrescribed: 2,
      postPhysicalFatigue: 3,
      postMentalFatigue: 2,
      emotionalExperienceDuring: 3,
      mentalStateChangePrePost: 3,
      prePhysicalFatigue: 2,
      preMentalFatigue: 2,
      preMotivation: 3,
      adjustmentReasons: ['short_on_time'],
      ...sleepBase,
    } as never);
    expect(result).toBeTruthy();
    expect(nights.size).toBe(1);
    expect(stressCheckins).toHaveLength(1);
  });
});
