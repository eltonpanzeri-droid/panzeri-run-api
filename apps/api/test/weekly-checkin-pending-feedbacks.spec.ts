import { WeeklyCheckInService } from '../src/training-plans/weekly-checkin.service';

// Feedback pendente antes da nova semana (03/10/2026). Regras: sessoes com execucao objetiva
// (vinculo ativo ou alternativa materializada) sem feedback subjetivo entram na lista; a lista e'
// informativa — nunca altera needsCheckIn nem bloqueia a geracao.

const PLAN_START = new Date('2026-09-28T00:00:00Z');

function build(sessions: unknown[], options: { existingCheckIn?: boolean; activities?: unknown[] } = {}) {
  const prisma = {
    trainingPlan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-1', startDate: PLAN_START }) },
    weeklyCheckIn: {
      findFirst: jest.fn().mockResolvedValue(options.existingCheckIn ? { id: 'ck-1' } : null),
      count: jest.fn().mockResolvedValue(0),
    },
    weeklyAvailability: { findFirst: jest.fn().mockResolvedValue(null) },
    trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) },
    activityLog: { findMany: jest.fn().mockResolvedValue(options.activities ?? []) },
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

  // 02/11/2026 (pedido de Elton): atividade do relogio sem vinculo e ainda sem treino extra criado tambem e' feedback pendente (antes ficava so' no numero "atividades adicionais").
  const watchRun = (id: string, startedAt: string, sport = 'corrida') => ({ id, sport, startedAt: new Date(startedAt), utcOffsetMinutes: -180, executionClassification: 'alternative', physicalIdentityStatus: null, physicalEventId: null, physicalCanonicalActivityLogId: null });

  it('atividade do relogio sem vinculo e sem treino extra criado entra na lista, sem sessionId, ordenada por data', async () => {
    const { service } = build(
      [{ id: 'run-1', title: 'Corrida 30km', scheduledDate: new Date('2026-10-02T00:00:00Z'), completion: null }],
      { activities: [watchRun('act-1', '2026-09-30T12:00:00Z')] },
    );
    const status = await service.getStatus('aluno-1');
    expect(status.pendingFeedbacks).toEqual([
      { sessionId: null, activityLogId: 'act-1', title: 'corrida (relógio)', isoDate: '2026-09-30' },
      { sessionId: 'run-1', title: 'Corrida 30km', isoDate: '2026-10-02' },
    ]);
  });

  it('atividade ja materializada em treino extra nao e contada duas vezes (e some quando o extra tem RPE)', async () => {
    const materialized = (rpe: number | null) => ({ id: 'alt-1', title: 'corrida (extra · polar)', scheduledDate: new Date('2026-09-30T00:00:00Z'), origin: 'device_extra', structure: { activityLogId: 'act-1' }, completion: { perceivedEffort: rpe } });
    const semRpe = await build([materialized(null)], { activities: [watchRun('act-1', '2026-09-30T12:00:00Z')] }).service.getStatus('aluno-1');
    expect(semRpe.pendingFeedbacks).toEqual([{ sessionId: 'alt-1', title: 'corrida (extra · polar)', isoDate: '2026-09-30' }]);
    const comRpe = await build([materialized(7)], { activities: [watchRun('act-1', '2026-09-30T12:00:00Z')] }).service.getStatus('aluno-1');
    expect(comRpe.pendingFeedbacks).toEqual([]);
  });

  it('sem atividades do relogio na semana, a lista continua so com as sessoes (comportamento anterior)', async () => {
    const { service } = build([{ id: 'run-1', title: 'Corrida', scheduledDate: new Date('2026-09-30T00:00:00Z'), completion: null }]);
    expect((await service.getStatus('aluno-1')).pendingFeedbacks).toEqual([{ sessionId: 'run-1', title: 'Corrida', isoDate: '2026-09-30' }]);
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
