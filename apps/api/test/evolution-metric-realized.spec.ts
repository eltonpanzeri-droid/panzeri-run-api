import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';

// Realidade objetiva no longitudinal (03/10/2026). Regras: execucao objetiva (ActivityLog) entra no
// realizado independentemente de feedback; atividade alternativa entra em realizado/extras mas nunca
// em aderencia; device_extra nunca conta duas vezes; null vira ausencia, nunca zero.

const WEEK_START = '2026-08-03'; // segunda-feira, semana passada (anterior a hoje)

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-default',
    userId: 'aluno-1',
    scheduledDate: new Date(`${WEEK_START}T00:00:00Z`),
    modality: 'corrida',
    distanceKm: 10,
    structure: { source: 'agent', type: 'run' },
    origin: 'agent',
    plan: { status: 'active' },
    completion: null,
    executionLinks: [],
    ...overrides,
  };
}

function activity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a-default',
    startedAt: new Date('2026-08-03T10:00:00Z'),
    utcOffsetMinutes: 0,
    distanceMeters: 10200,
    executionClassification: 'corresponding',
    ...overrides,
  };
}

function build(sessions: unknown[], activities: unknown[]) {
  const prisma = {
    trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) },
    activityLog: { findMany: jest.fn().mockResolvedValue(activities) },
  };
  return new EvolutionMetricService(prisma as never);
}

describe('EvolutionMetricService — realidade objetiva no longitudinal (03/10/2026)', () => {
  it('correspondente SEM feedback: conta como feita (P) e o km vem da atividade (R), sem depender de completion', async () => {
    const service = build(
      [session({ id: 'p1', distanceKm: 10, executionLinks: [{ activityLog: { distanceMeters: 10200 } }] })],
      [activity({ id: 'corr1', distanceMeters: 10200, executionClassification: 'corresponding' })],
    );
    const series = await service.getSeries('aluno-1');
    const week = series.weeks[0];
    expect(week.sessoesPrescritas).toBe(1);
    expect(week.sessoesFeitas).toBe(1);
    expect(week.adherencePercent).toBe(100);
    expect(week.kmPercorridos).toBe(10.2); // km da atividade, nunca o planejado (10) nem zero
    expect(week.kmPrescritos).toBe(10);
  });

  it('feedback ausente nao apaga nem invalida a execucao objetiva nos totais', async () => {
    const service = build(
      [session({ id: 'p1', executionLinks: [{ activityLog: { distanceMeters: 10200 } }], completion: null })],
      [activity({ distanceMeters: 10200, executionClassification: 'corresponding' })],
    );
    const overview = await service.getOverview('aluno-1');
    expect(overview.totalKmPercorridos).toBe(10.2);
    expect(overview.adherence.allTime.sessoesFeitas).toBe(1);
  });

  it('atividade ALTERNATIVA sem sessao entra no km realizado e nos extras, mas nunca em aderencia', async () => {
    const service = build(
      [],
      [activity({ id: 'alt1', distanceMeters: 5000, executionClassification: 'alternative', startedAt: new Date('2026-08-04T10:00:00Z') })],
    );
    const series = await service.getSeries('aluno-1');
    const week = series.weeks[0];
    expect(week.kmPercorridos).toBe(5);
    expect(week.kmExtras).toBe(5);
    expect(week.sessoesPrescritas).toBe(0);
    expect(week.sessoesFeitas).toBe(0);
    expect(week.adherencePercent).toBeNull();
  });

  it('sessao device_extra com feedback NAO conta o km duas vezes (conta so pela atividade alternativa) e NAO e prescrita', async () => {
    const service = build(
      [session({
        id: 'dx1',
        origin: 'device_extra',
        structure: { source: 'device', type: 'extra', activityLogId: 'alt1' },
        distanceKm: null,
        completion: { status: 'done', completedAt: new Date('2026-08-04T12:00:00Z'), distanceKm: 5, perceivedEffort: null },
        scheduledDate: new Date('2026-08-04T00:00:00Z'),
      })],
      [activity({ id: 'alt1', distanceMeters: 5000, executionClassification: 'alternative', startedAt: new Date('2026-08-04T10:00:00Z') })],
    );
    const series = await service.getSeries('aluno-1');
    const week = series.weeks[0];
    expect(week.kmPercorridos).toBe(5); // uma vez, nunca 10
    expect(week.sessoesPrescritas).toBe(0); // device_extra nunca e' prescricao
  });

  it('distancia ausente vira null, nunca zero (semana sem km realizado mantem kmPercorridos null)', async () => {
    const service = build(
      [session({ id: 'p1', completion: { status: 'done', completedAt: new Date('2026-08-03T12:00:00Z'), distanceKm: null, perceivedEffort: null } })],
      [],
    );
    const series = await service.getSeries('aluno-1');
    expect(series.weeks[0].kmPercorridos).toBeNull();
  });

  it('a consulta de realizado so pega atividades corresponding/alternative — ambiguous e null nunca entram por palpite', async () => {
    const prisma = {
      trainingSession: { findMany: jest.fn().mockResolvedValue([]) },
      activityLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await new EvolutionMetricService(prisma as never).getSeries('aluno-1');
    const where = prisma.activityLog.findMany.mock.calls[0][0].where;
    expect(where.executionClassification).toEqual({ in: ['corresponding', 'alternative'] });
  });

  it('extra do aluno (student_extra) segue contando km legado como extra, fora de aderencia', async () => {
    const service = build(
      [session({
        id: 'e1',
        structure: { source: 'student', type: 'extra' },
        distanceKm: null,
        completion: { status: 'done', completedAt: new Date('2026-08-05T12:00:00Z'), distanceKm: 3, perceivedEffort: null },
        scheduledDate: new Date('2026-08-05T00:00:00Z'),
      })],
      [],
    );
    const series = await service.getSeries('aluno-1');
    const week = series.weeks[0];
    expect(week.kmPercorridos).toBe(3);
    expect(week.kmExtras).toBe(3);
    expect(week.sessoesPrescritas).toBe(0);
  });
});
