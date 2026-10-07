import { WeeklyCheckInService } from '../src/training-plans/weekly-checkin.service';

// Feedback pendente antes da nova semana (03/10/2026). Regras: sessoes com execucao objetiva
// (vinculo ativo ou alternativa materializada) sem feedback subjetivo entram na lista; a lista e'
// informativa — nunca altera needsCheckIn nem bloqueia a geracao.

const PLAN_START = new Date('2026-09-28T00:00:00Z');

function build(sessions: unknown[], options: { existingCheckIn?: boolean } = {}) {
  const prisma = {
    trainingPlan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-1', startDate: PLAN_START }) },
    weeklyCheckIn: {
      findFirst: jest.fn().mockResolvedValue(options.existingCheckIn ? { id: 'ck-1' } : null),
      count: jest.fn().mockResolvedValue(0),
    },
    weeklyAvailability: { findFirst: jest.fn().mockResolvedValue(null) },
    trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) },
    activityLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const strava = { report: jest.fn().mockResolvedValue({ summary: null }) };
  const service = new WeeklyCheckInService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

describe('WeeklyCheckInService.getStatus — feedbacks pendentes da semana (03/10/2026)', () => {
  it('lista sessoes realizadas (vinculo ativo) sem feedback e inclui device_extra sem RPE', async () => {
    const { service } = build([
      { id: 'run-1', title: 'Corrida 30km', scheduledDate: new Date('2026-09-30T00:00:00Z'), completion: null },
      { id: 'alt-1', title: 'bike (extra)', scheduledDate: new Date('2026-10-01T00:00:00Z'), completion: { perceivedEffort: null } },
    ]);
    const status = await service.getStatus('aluno-1');
    expect(status.pendingFeedbacks).toEqual([
      { sessionId: 'run-1', title: 'Corrida 30km', isoDate: '2026-09-30' },
      { sessionId: 'alt-1', title: 'bike (extra)', isoDate: '2026-10-01' },
    ]);
  });

  it('feedback ja respondido (com RPE) sai da lista', async () => {
    const { service } = build([
      { id: 'run-2', title: 'Corrida', scheduledDate: new Date('2026-09-30T00:00:00Z'), completion: { perceivedEffort: 7 } },
    ]);
    const status = await service.getStatus('aluno-1');
    expect(status.pendingFeedbacks).toEqual([]);
  });

  it('consulta so sessoes da janela da semana do plano ativo (7 dias a partir do inicio)', async () => {
    const { service, prisma } = build([]);
    await service.getStatus('aluno-1');
    const where = prisma.trainingSession.findMany.mock.calls[0][0].where;
    expect(where.scheduledDate).toEqual({
      gte: PLAN_START,
      lt: new Date('2026-10-05T00:00:00Z'),
    });
  });

  it('lista pendente NAO altera needsCheckIn: a regra de check-in continua a mesma (pular/prosseguir preservados)', async () => {
    const { service } = build([
      { id: 'run-1', title: 'Corrida', scheduledDate: new Date('2026-09-30T00:00:00Z'), completion: null },
    ], { existingCheckIn: false });
    const status = await service.getStatus('aluno-1');
    expect(status.needsCheckIn).toBe(true);
    expect(status.pendingFeedbacks).toHaveLength(1);
  });

  it('com check-in ja registrado, a lista de pendentes continua sendo informada (nao some por causa do check-in)', async () => {
    const { service } = build([
      { id: 'run-1', title: 'Corrida', scheduledDate: new Date('2026-09-30T00:00:00Z'), completion: null },
    ], { existingCheckIn: true });
    const status = await service.getStatus('aluno-1');
    expect(status.needsCheckIn).toBe(false);
    expect(status.pendingFeedbacks).toHaveLength(1);
  });
});
