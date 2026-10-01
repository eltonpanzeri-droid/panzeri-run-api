import { BadRequestException } from '@nestjs/common';
import { WorkoutCompletionsService, executionBehaviorLabel } from '../src/workout-completions/workout-completions.service';
import { getVariableDefinition } from '../src/training-intelligence/variable-registry';

// 01/10/2026 (ajuste 3) — executionBehavior substitui executionVsPrescribed: pergunta
// comportamental/categorica (NAO escala ordinal), serie separada e nao comparavel ao historico.
describe('WorkoutCompletionsService.upsert — executionBehavior (feedback v3)', () => {
  function buildService() {
    const session = {
      id: 'session-1',
      userId: 'user-1',
      scheduledDate: new Date('2026-10-01T00:00:00.000Z'),
      title: 'Corrida leve',
      modality: 'corrida',
      routineMismatchNote: null,
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
    const service = new WorkoutCompletionsService(prisma as never, config as never, studentProfile as never, telegram as never, contextEvents as never, { record: jest.fn() } as never, { evaluateForUser: jest.fn().mockResolvedValue([]) } as never);
    return { service, prisma };
  }

  const sleepAndPreFields = {
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
    satisfactionElaboracao: 'gostei',
    painFlag: 'none',
    postPhysicalFatigue: 2,
    postMentalFatigue: 2,
    emotionalExperienceDuring: 4,
    mentalStateChangePrePost: 4,
  };

  it('aceita cada uma das 5 categorias comportamentais e persiste em executionBehavior (nao em executionVsPrescribed)', async () => {
    const categories = ['as_planned', 'minor_adaptations', 'major_changes', 'different_workout', 'stopped_early'];
    for (const category of categories) {
      const { service } = buildService();
      const result = await service.upsert('user-1', {
        sessionId: 'session-1',
        status: 'done',
        perceivedEffort: 6,
        executionBehavior: category,
        ...sleepAndPreFields,
      } as never);
      expect((result as { executionBehavior: string }).executionBehavior).toBe(category);
      expect((result as { executionVsPrescribed: unknown }).executionVsPrescribed).toBeUndefined();
      expect((result as { feedbackVersion: number }).feedbackVersion).toBe(3);
    }
  });

  it('status "adjusted" tambem funciona com executionBehavior', async () => {
    const { service } = buildService();
    const result = await service.upsert('user-1', {
      sessionId: 'session-1',
      status: 'adjusted',
      perceivedEffort: 7,
      executionBehavior: 'minor_adaptations',
      adjustmentReasons: ['short_on_time'],
      ...sleepAndPreFields,
    } as never);
    expect(result).toBeTruthy();
    expect((result as { executionBehavior: string }).executionBehavior).toBe('minor_adaptations');
    expect((result as { feedbackVersion: number }).feedbackVersion).toBe(3);
  });

  it('cliente antigo (sem executionBehavior, so executionVsPrescribed) continua funcionando como feedbackVersion 2', async () => {
    const { service } = buildService();
    const result = await service.upsert('user-1', {
      sessionId: 'session-1',
      status: 'done',
      perceivedEffort: 6,
      executionVsPrescribed: 3,
      ...sleepAndPreFields,
    } as never);
    expect((result as { feedbackVersion: number }).feedbackVersion).toBe(2);
    expect((result as { executionVsPrescribed: number }).executionVsPrescribed).toBe(3);
    expect((result as { executionBehavior: unknown }).executionBehavior).toBeUndefined();
  });

  it('rejeita done/adjusted sem executionBehavior NEM executionVsPrescribed quando ja e cliente v2+', async () => {
    const { service } = buildService();
    await expect(service.upsert('user-1', {
      sessionId: 'session-1',
      status: 'done',
      perceivedEffort: 6,
      ...sleepAndPreFields,
      // nem executionBehavior nem executionVsPrescribed enviados
    } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nao aceita categoria desconhecida (validacao do DTO, fora do service) — rota real usa class-validator', () => {
    // Confirma apenas a lista de categorias validas reconhecida pelo label (nao inventa uma 6a).
    expect(executionBehaviorLabel('as_planned')).toBe('Seguiu o treino como estava planejado');
    expect(executionBehaviorLabel('stopped_early')).toBe('Interrompeu o treino antes de terminar');
    expect(executionBehaviorLabel('categoria_inexistente')).toBe('categoria_inexistente');
  });
});

describe('workout.executionBehavior vs workout.executionVsPrescribed — nao e ordinal, nao e a mesma serie', () => {
  it('executionBehavior e categorica, nao ordinal, e nao comparavel entre versoes', () => {
    const def = getVariableDefinition('workout.executionBehavior');
    expect(def?.dataType).toBe('categorical');
    expect(def?.allowedMathStrategy).toBe('categorical_frequency'); // nunca ordinal_or_continuous_stats
    expect(def?.direction).toBe('not_directional');
    expect(def?.versionComparability).toBe('not_comparable_across_versions');
    expect(def?.versions).toEqual([{ version: 3, field: 'executionBehavior', storageLocation: 'column' }]);
  });

  it('executionVsPrescribed permanece ordinal/quantitativa, intacta, para o historico', () => {
    const def = getVariableDefinition('workout.executionVsPrescribed');
    expect(def?.dataType).toBe('ordinal_scale');
    expect(def?.allowedMathStrategy).toBe('ordinal_or_continuous_stats');
    expect(def?.scale).toEqual({ min: 1, max: 5 });
    expect(def?.versions).toEqual([{ version: 2, field: 'executionVsPrescribed', storageLocation: 'column' }]);
  });
});
