import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';

// 25/09/2026 — Evolução do acompanhamento menstrual. Confirma que MenstrualDailyLog vira Observation
// pela MESMA arquitetura já usada por WorkoutCompletion/WeeklyCheckIn (nenhum leitor paralelo),
// e que ausência de sintoma num dia continua ausência, nunca zero.

function buildReader(dailyLogs: unknown[]) {
  const prisma = { menstrualDailyLog: { findMany: jest.fn().mockResolvedValue(dailyLogs) } };
  return new ObservationReaderService(prisma as never, {} as never, {} as never);
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

// 26/09/2026 (item 5 do pedido) — cycle.cycleLengthDays/cycle.periodLengthDays vem de
// MenstrualCycleLog (nao MenstrualDailyLog), uma observacao por INTERVALO, nao por registro isolado.
function buildCycleReader(cycleLogs: unknown[]) {
  const prisma = { menstrualCycleLog: { findMany: jest.fn().mockResolvedValue(cycleLogs) } };
  return new ObservationReaderService(prisma as never, {} as never, {} as never);
}
function cycleLog(overrides: Record<string, unknown>) {
  return {
    id: 'cycle-1', userId: 'aluna-1',
    cycleStartDate: new Date('2026-08-01T12:00:00Z'), cycleEndDate: null, flowIntensity: null,
    ...overrides,
  };
}

describe('ObservationReaderService — cycle.cycleLengthDays/cycle.periodLengthDays (MenstrualCycleLog)', () => {
  it('cycleLengthDays: uma observacao por intervalo entre inicios sucessivos — o ULTIMO ciclo nunca gera observacao', async () => {
    const logs = [
      cycleLog({ id: 'a', cycleStartDate: new Date('2026-08-01T12:00:00Z') }),
      cycleLog({ id: 'b', cycleStartDate: new Date('2026-08-29T12:00:00Z') }), // +28
      cycleLog({ id: 'c', cycleStartDate: new Date('2026-09-30T12:00:00Z') }), // +32
    ];
    const reader = buildCycleReader(logs);
    const obs = await reader.getObservations('aluna-1', 'cycle.cycleLengthDays');
    expect(obs).toHaveLength(2); // nunca 3 — o ultimo ainda nao tem duracao conhecida
    expect(obs[0].value).toBe(28);
    expect(obs[1].value).toBe(32);
    expect(obs[0].timestamp).toEqual(new Date('2026-08-29T12:00:00Z')); // timestamp = quando passou a ser sabido
  });

  it('periodLengthDays: so gera observacao quando o FIM foi informado, nunca inventa', async () => {
    const logs = [
      cycleLog({ id: 'a', cycleStartDate: new Date('2026-08-01T12:00:00Z'), cycleEndDate: new Date('2026-08-05T12:00:00Z') }), // 5 dias
      cycleLog({ id: 'b', cycleStartDate: new Date('2026-08-29T12:00:00Z'), cycleEndDate: null }), // em curso
    ];
    const reader = buildCycleReader(logs);
    const obs = await reader.getObservations('aluna-1', 'cycle.periodLengthDays');
    expect(obs).toHaveLength(1);
    expect(obs[0].value).toBe(5);
  });

  it('menos de 2 ciclos: cycleLengthDays vazio, nao erro', async () => {
    const reader = buildCycleReader([cycleLog({})]);
    const obs = await reader.getObservations('aluna-1', 'cycle.cycleLengthDays');
    expect(obs).toEqual([]);
  });
});
