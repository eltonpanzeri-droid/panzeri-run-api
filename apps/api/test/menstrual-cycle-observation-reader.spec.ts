import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';

// 25/09/2026 — Evolução do acompanhamento menstrual. Confirma que MenstrualDailyLog vira Observation
// pela MESMA arquitetura já usada por WorkoutCompletion/WeeklyCheckIn (nenhum leitor paralelo),
// e que ausência de sintoma num dia continua ausência, nunca zero.

function buildReader(dailyLogs: unknown[]) {
  const prisma = { menstrualDailyLog: { findMany: jest.fn().mockResolvedValue(dailyLogs) } };
  return new ObservationReaderService(prisma as never);
}

function dailyLog(overrides: Record<string, unknown>) {
  return {
    id: 'daily-1',
    userId: 'aluna-1',
    date: new Date('2026-09-10T12:00:00.000Z'),
    crampsLevel: null,
    energyLevel: null,
    moodLevel: null,
    flowIntensity: null,
    ...overrides,
  };
}

describe('ObservationReaderService — cycle.* (MenstrualDailyLog)', () => {
  it('cada dia com valor vira uma Observation, com flowIntensity preservado no context', async () => {
    const reader = buildReader([dailyLog({ crampsLevel: 3, flowIntensity: 'moderado' })]);
    const obs = await reader.getObservations('aluna-1', 'cycle.crampsLevel');
    expect(obs).toHaveLength(1);
    expect(obs[0].value).toBe(3);
    expect(obs[0].context.flowIntensity).toBe('moderado');
    expect(obs[0].source).toBe('student_menstrual_daily_log');
  });

  it('dia sem aquele sintoma especifico nao vira observacao (ausencia, nunca zero)', async () => {
    const reader = buildReader([dailyLog({ crampsLevel: 3, energyLevel: null })]);
    const obs = await reader.getObservations('aluna-1', 'cycle.energyLevel');
    expect(obs).toHaveLength(0);
  });

  it('sem nenhum registro diario: lista vazia, nao erro', async () => {
    const reader = buildReader([]);
    const obs = await reader.getObservations('aluna-1', 'cycle.moodLevel');
    expect(obs).toEqual([]);
  });
});
