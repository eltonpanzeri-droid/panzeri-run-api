import { CoachService } from '../src/coach/coach.service';

// 24/09: regressao real relatada por Elton — "43 programas ativos" com so' 40 alunos na mesma tela.
// Causa raiz: a query de trainingPlan.findMany({ status: 'active' }) que alimenta totals.activePlans
// nao tinha NENHUM filtro ligando o plano a mesma populacao de "aluno" usada em totals.students
// (role=student, subscriptionStatus fora de pending/canceled, accountStatus != archived) — contava
// planos active de contas arquivadas, canceladas ou ate orfas. Este teste garante que a query agora
// exige essa mesma populacao, e nao regride silenciosamente.
describe('CoachService.dashboard — activePlans usa a mesma populacao de totals.students', () => {
  function buildPrismaMock() {
    const trainingPlanFindManyCalls: unknown[] = [];
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      trainingPlan: {
        findMany: jest.fn().mockImplementation((args: unknown) => {
          trainingPlanFindManyCalls.push(args);
          return Promise.resolve([]);
        }),
      },
      trainingSession: { count: jest.fn().mockResolvedValue(0) },
      workoutCompletion: { count: jest.fn().mockResolvedValue(0) },
      stravaConnection: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, trainingPlanFindManyCalls };
  }

  const EXPECTED_STUDENT_POPULATION = {
    role: 'student',
    subscriptionStatus: { notIn: ['pending', 'canceled'] },
    accountStatus: { not: 'archived' },
  };

  it('filtra trainingPlan (planos ativos) pela mesma populacao de aluno usada no total geral', async () => {
    const { prisma, trainingPlanFindManyCalls } = buildPrismaMock();
    const trainingPlans = { fixAllStuckScheduledPlans: jest.fn().mockResolvedValue(undefined) };
    const service = new CoachService(
      prisma as never, trainingPlans as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never,
    );

    await service.dashboard({ search: '', page: 1, pageSize: 20 });

    expect(trainingPlanFindManyCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of trainingPlanFindManyCalls as Array<{ where: { status: string; user?: unknown } }>) {
      expect(call.where.status).toBe('active');
      expect(call.where.user).toEqual(EXPECTED_STUDENT_POPULATION);
    }
  });
});
