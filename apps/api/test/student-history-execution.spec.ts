import { TrainingPlansService } from '../src/training-plans/training-plans.service';

// Bloco 1 (04/10/2026): o Historico lia so' WorkoutCompletion. ActivityLog + SessionExecutionLink
// ativo prova a execucao; feedback e' estado separado. Caso real: Polar 512122061, 03/10/2026
// (sabado), 30,08 km vinculada a sessao prescrita de 30 km, sem feedback.
function build(sessions: unknown[], links: unknown[], alternativeLogs: unknown[] = []) {
  const prisma = {
    trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) },
    sessionExecutionLink: { findMany: jest.fn().mockResolvedValue(links) },
    activityLog: { findMany: jest.fn().mockResolvedValue(alternativeLogs) },
  };
  const noop = {} as never;
  return new TrainingPlansService(prisma as never, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop);
}

function session(overrides: Partial<any> = {}) {
  return {
    id: 'sess-30k',
    scheduledDate: new Date('2026-10-03T00:00:00.000Z'), // sabado
    weekday: 6,
    modality: 'corrida',
    title: 'Longao 30 km',
    structure: {},
    origin: 'agent',
    completion: null,
    plan: { status: 'active' },
    ...overrides,
  };
}

const polarRun = { id: 'act-1', distanceMeters: 30080, startedAt: new Date('2026-10-03T09:00:00Z'), utcOffsetMinutes: -180 };
const link = { trainingSessionId: 'sess-30k', activityLogId: 'act-1', activityLog: polarRun };

describe('getStudentHistory — execucao objetiva sem feedback', () => {
  it('sabado com vinculo ativo e sem completion: realizado, 30,08 km, feedback pendente', async () => {
    const result = await build([session()], [link]).getStudentHistory('u1');
    const s = result[0].sessions[0];
    expect(s.executionStatus).toBe('realized');
    expect(s.completedDistanceKm).toBe(30.08);
    expect(s.feedbackPending).toBe(true);
    expect(s.completionStatus).toBeNull();
    expect(result[0].totalKmDone).toBe(30.1);
  });

  it('sem vinculo e sem completion segue "sem registro" (executionStatus null, km 0)', async () => {
    const result = await build([session()], []).getStudentHistory('u1');
    expect(result[0].sessions[0].executionStatus).toBeNull();
    expect(result[0].totalKmDone).toBe(0);
  });

  it('com feedback preenchido (perceivedEffort) o feedback deixa de estar pendente; distancia vem da execucao', async () => {
    const s = session({ completion: { status: 'done', distanceKm: 29, perceivedEffort: 7 } });
    const result = await build([s], [link]).getStudentHistory('u1');
    expect(result[0].sessions[0].feedbackPending).toBe(false);
    expect(result[0].sessions[0].completedDistanceKm).toBe(30.08);
    expect(result[0].totalKmDone).toBe(30.1);
  });

  it('sessao de plano arquivado sem completion mas com vinculo ativo entra no historico', async () => {
    const result = await build([session({ plan: { status: 'archived' } })], [link]).getStudentHistory('u1');
    expect(result[0].sessions).toHaveLength(1);
  });

  it('atividade alternativa entra no historico e no volume, sem cumprir prescricao', async () => {
    const alt = { id: 'act-9', provider: 'polar', sport: 'ciclismo', distanceMeters: 20000, startedAt: new Date('2026-10-02T10:00:00Z'), utcOffsetMinutes: -180 };
    const result = await build([session()], [link], [alt]).getStudentHistory('u1');
    const altSession = result[0].sessions.find((x) => x.isAlternativeActivity)!;
    expect(altSession.date).toBe('2026-10-02');
    expect(altSession.completedDistanceKm).toBe(20);
    expect(altSession.isExtra).toBe(true);
    expect(altSession.executionStatus).toBe('realized');
    expect(result[0].totalKmDone).toBe(50.1);
  });

  it('alternativa ja materializada como sessao device_extra nao e contada duas vezes', async () => {
    const alt = { id: 'act-9', provider: 'polar', sport: 'ciclismo', distanceMeters: 20000, startedAt: new Date('2026-10-02T10:00:00Z'), utcOffsetMinutes: -180 };
    const materialized = session({
      id: 'sess-x', origin: 'device_extra', scheduledDate: new Date('2026-10-02T00:00:00.000Z'), weekday: 5,
      structure: { type: 'extra', source: 'device', activityLogId: 'act-9' },
      completion: { status: 'done', distanceKm: 20, perceivedEffort: null },
    });
    const result = await build([materialized], [], [alt]).getStudentHistory('u1');
    expect(result[0].sessions).toHaveLength(1);
    expect(result[0].totalKmDone).toBe(20);
  });
});
