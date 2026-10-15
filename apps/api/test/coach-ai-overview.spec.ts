import { CoachService } from '../src/coach/coach.service';

// 15/10/2026: visao "Programas e IA" (somente leitura). Garante populacao sem arquivadas e as contas basicas.
describe('CoachService.aiOverview', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000);

  function build() {
    const calls: Record<string, any> = {};
    const prisma = {
      user: {
        findMany: jest.fn().mockImplementation((args: any) => {
          calls.users = args;
          return Promise.resolve([
            { id: 'u1', name: 'Ana', studentCode: 1, plans: [{ id: 'p1' }] },
            { id: 'u2', name: 'Bia', studentCode: 2, plans: [] },
          ]);
        }),
      },
      trainingPlan: {
        findMany: jest.fn().mockImplementation((args: any) => {
          calls.plans = args;
          return Promise.resolve([
            { userId: 'u1', createdAt: hoursAgo(2), generatedBy: 'ai' },
            { userId: 'u1', createdAt: hoursAgo(1), generatedBy: 'ai' },
            { userId: 'u3', createdAt: hoursAgo(30), generatedBy: 'ai' },
          ]);
        }),
      },
      trainingPlanGenerationLock: { findMany: jest.fn().mockResolvedValue([{ userId: 'u9', startedAt: hoursAgo(1) }]) },
      prescriptionDecision: {
        findMany: jest.fn().mockResolvedValue([
          { kind: 'week', traceStatus: 'complete' }, { kind: 'session', traceStatus: 'partial' }, { kind: 'session', traceStatus: 'absent' },
        ]),
      },
      studentDirective: { count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(2) },
      reassessment: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'u1', createdAt: hoursAgo(72), user: { name: 'Ana', studentCode: 1 } }]),
      },
    };
    const service = new CoachService(
      prisma as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never);
    return { service, calls };
  }

  it('conta alunas sem programa, regeneracoes, decisoes, diretrizes e reavaliacoes abertas', async () => {
    const { service } = build();
    const result = await service.aiOverview();
    expect(result.studentsWithAccess).toBe(2);
    expect(result.withoutProgram.students.map((s) => s.name)).toEqual(['Bia']);
    expect(result.generation.programsLast7Days).toBe(3);
    expect(result.generation.studentsWithRegeneration).toBe(1);
    expect(result.generation.runningNow[0].minutesRunning).toBeGreaterThanOrEqual(59);
    expect(result.decisionsLast7Days).toEqual({ total: 3, byTrace: { complete: 1, partial: 1, absent: 1 }, byKind: { week: 1, session: 2 } });
    expect(result.coach).toEqual({ activeDirectives: 4, directivesCreatedLast30Days: 2 });
    expect(result.openReassessments.count).toBe(1);
    expect(result.openReassessments.students[0].daysOpen).toBe(3);
  });

  it('usa so alunas com acesso e sem arquivadas', async () => {
    const { service, calls } = build();
    await service.aiOverview();
    expect(calls.users.where.accountStatus).toEqual({ not: 'archived' });
    expect(calls.users.where.subscriptionStatus).toEqual({ in: ['active', 'grace', 'manual_active'] });
    expect(calls.plans.where.user.accountStatus).toEqual({ not: 'archived' });
  });
});
