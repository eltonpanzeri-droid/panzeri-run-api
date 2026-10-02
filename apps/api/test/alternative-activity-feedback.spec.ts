import { BadRequestException } from '@nestjs/common';
import { WorkoutCompletionsService } from '../src/workout-completions/workout-completions.service';

// Feedback de Atividade Alternativa (02/10/2026) — reusa INTEGRALMENTE o upsert/validacao do
// Feedback V3 (mesmo endpoint POST /workout-completions, mesma sessionId, mesmo DTO). A UNICA
// diferenca e' que a TrainingSession por tras e' sintetica (origin='device_extra', materializada
// de uma ActivityLog 'alternative'): a pergunta "em relacao ao prescrito, como foi sua execucao?"
// nao se aplica (nao ha' prescricao), nem "elaboracao do treino" (nao foi o treinador quem montou).
describe('WorkoutCompletionsService.upsert — Feedback de Atividade Alternativa (session origin=device_extra)', () => {
  function buildService(sessionOverrides: Partial<any> = {}) {
    const session = {
      id: 'session-alt-1',
      userId: 'user-1',
      scheduledDate: new Date('2026-10-01T00:00:00.000Z'),
      title: 'bike (extra · polar)',
      modality: 'bike',
      origin: 'device_extra',
      routineMismatchNote: null,
      ...sessionOverrides,
    };
    const prisma = {
      trainingSession: { findFirst: jest.fn().mockResolvedValue(session) },
      workoutCompletion: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'completion-1', ...create })),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Aluna Teste', studentCode: 1 }), findMany: jest.fn().mockResolvedValue([]) },
      userNotification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      nightlySleepLog: { upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'night-1', ...create })) },
      stressCheckin: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'stress-1', ...data })),
      },
    };
    const config = { get: jest.fn().mockReturnValue('') };
    const studentProfile = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
    const contextEvents = { linkFirstObservationIfPending: jest.fn().mockResolvedValue(undefined) };
    const service = new WorkoutCompletionsService(
      prisma as never,
      config as never,
      studentProfile as never,
      telegram as never,
      contextEvents as never,
      { record: jest.fn() } as never,
      { evaluateForUser: jest.fn().mockResolvedValue([]) } as never,
    );
    return { service, prisma };
  }

  // Campos "da experiencia da atividade" (esforco, fadiga, humor, dor, observacao livre) — iguais
  // ao Feedback V3 de uma sessao normal. Deliberadamente SEM executionBehavior/
  // executionVsPrescribed/satisfactionElaboracao (requisito G: nao se aplica a alternativa).
  const alternativeFeedbackFields = {
    preSleepQuality: 4,
    sleepDurationCategory: '7_a_8h' as const,
    bedtimeShiftDirection: 'on_time' as const,
    wakeTimeShiftDirection: 'on_time' as const,
    sleepInterruption: 2,
    sleepDifficulty: 1,
    prePhysicalFatigue: 2,
    preMentalFatigue: 2,
    preStressLevel: 2,
    preMotivation: 4,
    painFlag: 'none',
    postPhysicalFatigue: 2,
    postMentalFatigue: 2,
    emotionalExperienceDuring: 4,
    mentalStateChangePrePost: 4,
  };

  it('aceita feedback de atividade alternativa SEM executionBehavior/executionVsPrescribed/satisfactionElaboracao (cenario B/C/G)', async () => {
    const { service } = buildService();
    const result = (await service.upsert('user-1', {
      sessionId: 'session-alt-1',
      status: 'done',
      perceivedEffort: 7,
      ...alternativeFeedbackFields,
    } as never)) as any;

    expect(result).toBeTruthy();
    expect(result.perceivedEffort).toBe(7);
    expect(result.executionBehavior).toBeNull();
    expect(result.executionVsPrescribed).toBeNull();
    // Correcao 02/10/2026: atividade alternativa usa o formulario/fluxo V3, mas a deteccao padrao
    // (presenca de executionBehavior) nunca dispara aqui, ja que a coluna fica null de proposito —
    // isAlternativeSession entra como segundo sinal de V3, sem inventar valor em executionBehavior.
    expect(result.feedbackVersion).toBe(3);
  });

  it('nunca grava executionBehavior/executionVsPrescribed/satisfactionElaboracao mesmo se o dto enviar por engano (ausencia != zero != "treino diferente")', async () => {
    const { service } = buildService();
    const result = (await service.upsert('user-1', {
      sessionId: 'session-alt-1',
      status: 'done',
      perceivedEffort: 7,
      executionBehavior: 'as_planned',
      executionVsPrescribed: 3,
      satisfactionElaboracao: 'otima',
      ...alternativeFeedbackFields,
    } as never)) as any;

    expect(result.executionBehavior).toBeNull();
    expect(result.executionVsPrescribed).toBeNull();
    expect(result.satisfactionElaboracao).toBeNull();
  });

  it('ainda exige esforco percebido, dor/desconforto e bloco de sono/estado — so a pergunta de execucao vs prescrito fica de fora', async () => {
    const { service } = buildService();
    await expect(
      service.upsert('user-1', {
        sessionId: 'session-alt-1',
        status: 'done',
        ...alternativeFeedbackFields,
        // perceivedEffort ausente de proposito
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sessao prescrita normal (origin agent) continua exigindo executionBehavior/executionVsPrescribed (regressao, cenario A)', async () => {
    const { service } = buildService({ origin: 'agent' });
    await expect(
      service.upsert('user-1', {
        sessionId: 'session-alt-1',
        status: 'done',
        perceivedEffort: 7,
        ...alternativeFeedbackFields,
        // nem executionBehavior nem executionVsPrescribed enviados
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
