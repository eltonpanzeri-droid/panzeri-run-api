import { BadRequestException } from '@nestjs/common';
import { WorkoutCompletionsService, sleepDurationHoursEstimate, executionVsPrescribedLabel } from '../src/workout-completions/workout-completions.service';

// 24/09/2026 — regressao da reestruturacao do feedback individual de treino (16 perguntas, v2).
// Garante: (1) cliente v2 precisa preencher as perguntas novas; (2) cliente v1 (app antigo)
// continua funcionando sem elas; (3) as perguntas substituidas (satisfactionCapacidade/
// postWorkoutFeeling) deixam de ser exigidas quando o cliente e' v2, sem quebrar quem ainda envia
// a v1.
describe('WorkoutCompletionsService.upsert — validacao do feedback v2', () => {
  function buildService(overrides: { routineMismatchNote?: string | null } = {}) {
    const session = {
      id: 'session-1',
      userId: 'user-1',
      scheduledDate: new Date('2026-09-01T00:00:00.000Z'),
      title: 'Corrida leve',
      modality: 'corrida',
      routineMismatchNote: overrides.routineMismatchNote ?? null,
    };
    const prisma = {
      trainingSession: { findFirst: jest.fn().mockResolvedValue(session) },
      workoutCompletion: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'completion-1', ...create })),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Aluna Teste', studentCode: 1 }), findMany: jest.fn().mockResolvedValue([]) },
      userNotification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const config = { get: jest.fn().mockReturnValue('') };
    const studentProfile = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
    const service = new WorkoutCompletionsService(prisma as never, config as never, studentProfile as never, telegram as never);
    return { service, prisma };
  }

  const baseDto = {
    sessionId: 'session-1',
    status: 'done' as const,
    perceivedEffort: 6,
    satisfactionElaboracao: 'gostei',
    painFlag: 'none',
  };

  it('exige todas as perguntas do bloco Sono quando o cliente e v2', async () => {
    const { service } = buildService();
    await expect(service.upsert('user-1', {
      ...baseDto,
      // Presenca de QUALQUER campo v2 (aqui, executionVsPrescribed) ja marca o cliente como v2.
      executionVsPrescribed: 3,
      postPhysicalFatigue: 2,
      postMentalFatigue: 2,
      emotionalExperienceDuring: 4,
      mentalStateChangePrePost: 4,
      preMentalFatigue: 2,
      // sleepDurationCategory/sleepScheduleIrregularity/sleepInterruption/sleepDifficulty faltando
    } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aceita um envio v2 completo com as 16 perguntas preenchidas', async () => {
    const { service, prisma } = buildService();
    const result = await service.upsert('user-1', {
      ...baseDto,
      preSleepQuality: 4,
      sleepDurationCategory: '7_a_8h',
      sleepScheduleIrregularity: 2,
      sleepInterruption: 2,
      sleepDifficulty: 1,
      prePhysicalFatigue: 2,
      preMentalFatigue: 2,
      preStressLevel: 2,
      preMotivation: 4,
      executionVsPrescribed: 3,
      postPhysicalFatigue: 3,
      postMentalFatigue: 2,
      emotionalExperienceDuring: 4,
      mentalStateChangePrePost: 4,
    } as never);
    expect(result).toBeTruthy();
    expect(prisma.workoutCompletion.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ feedbackVersion: 2, sleepDurationCategory: '7_a_8h' }),
    }));
  });

  it('cliente v1 (app antigo, sem nenhum campo v2) continua funcionando normalmente', async () => {
    const { service, prisma } = buildService();
    const result = await service.upsert('user-1', {
      ...baseDto,
      preSleepQuality: 4,
      prePhysicalFatigue: 2,
      preStressLevel: 2,
      preMotivation: 4,
      satisfactionCapacidade: 'gostei',
      postWorkoutFeeling: 4,
    } as never);
    expect(result).toBeTruthy();
    expect(prisma.workoutCompletion.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ feedbackVersion: 1 }),
    }));
  });

  it('nao exige satisfactionCapacidade/postWorkoutFeeling (perguntas antigas) quando o cliente e v2', async () => {
    const { service } = buildService();
    await expect(service.upsert('user-1', {
      ...baseDto,
      preSleepQuality: 4,
      sleepDurationCategory: '7_a_8h',
      sleepScheduleIrregularity: 2,
      sleepInterruption: 2,
      sleepDifficulty: 1,
      prePhysicalFatigue: 2,
      preMentalFatigue: 2,
      preStressLevel: 2,
      preMotivation: 4,
      executionVsPrescribed: 3,
      postPhysicalFatigue: 3,
      postMentalFatigue: 2,
      emotionalExperienceDuring: 4,
      mentalStateChangePrePost: 4,
      // satisfactionCapacidade e postWorkoutFeeling propositalmente ausentes
    } as never)).resolves.toBeTruthy();
  });
});

describe('sleepDurationHoursEstimate', () => {
  it('transcreve a categoria escolhida pro ponto medio em horas, sem interpretar como intensidade', () => {
    expect(sleepDurationHoursEstimate('menos_5h')).toBe(4.5);
    expect(sleepDurationHoursEstimate('7_a_8h')).toBe(7.5);
    expect(sleepDurationHoursEstimate('mais_9h')).toBe(9.5);
    expect(sleepDurationHoursEstimate(undefined)).toBeUndefined();
  });
});

describe('executionVsPrescribedLabel', () => {
  it('3 e o ponto de referencia (fez como prescrito), nao "neutro" nem "ruim"', () => {
    expect(executionVsPrescribedLabel(3)).toBe('Fez como prescrito');
    expect(executionVsPrescribedLabel(1)).toBe('Fez bem menos que o prescrito');
    expect(executionVsPrescribedLabel(5)).toBe('Fez bem mais que o prescrito');
  });
});
