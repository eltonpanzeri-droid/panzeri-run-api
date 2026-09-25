import { CoachService } from '../src/coach/coach.service';
import { ReassessmentService } from '../src/reassessment/reassessment.service';
import { ContextEventsService } from '../src/context-events/context-events.service';

// 25/09/2026 — Passo 5 (Training Intelligence no Admin). Cobre as propriedades pedidas:
// nenhum calculo canonico foi recriado (Visao Geral so' agrega leituras ja existentes),
// trajetoria reaproveita o snapshot persistido quando existe (nao recalcula), ContextEvents
// completos ficam disponiveis pro Admin, missing nao vira zero na trajetoria de admin.

function noop() {
  return {} as never;
}

describe('CoachService.trainingIntelligenceOverview — agregado sem recalcular matematica (secoes 4, 30)', () => {
  it('agrega gap/reavaliacao/dor de cada aluno reusando os services existentes, sem nova formula', async () => {
    const students = [
      { id: 'u1', name: 'Aluno Um', studentCode: 1, subscriptionStatus: 'active' },
      { id: 'u2', name: 'Aluno Dois', studentCode: 2, subscriptionStatus: 'active' },
    ];
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue(students) },
      painReport: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const contextEvents = {
      getGapStatus: jest.fn()
        .mockResolvedValueOnce({ inGap: true, daysSinceLastObserved: 20 })
        .mockResolvedValueOnce({ inGap: false, daysSinceLastObserved: 2 }),
    };
    const reassessmentService = {
      state: jest.fn()
        .mockResolvedValueOnce({ due: false, warning: true, daysSinceLast: 100 })
        .mockResolvedValueOnce({ due: false, warning: false, daysSinceLast: 10 }),
    };
    const service = new CoachService(
      prisma as never, noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(),
      contextEvents as never, reassessmentService as never,
    );

    const overview = await service.trainingIntelligenceOverview();

    expect(overview.totalStudents).toBe(2);
    expect(overview.studentsInGap).toEqual([{ id: 'u1', name: 'Aluno Um', studentCode: 1, daysSinceLastObserved: 20 }]);
    expect(overview.studentsReassessmentWarning).toEqual([{ id: 'u1', name: 'Aluno Um', studentCode: 1, daysSinceLast: 100 }]);
    expect(overview.studentsReassessmentDue).toEqual([]);
    // Prova estrutural: nenhuma chamada a MathLayer/LongitudinalDynamics/AthleteStateSnapshot —
    // so' os services ja existentes de gap e reavaliacao, mais uma contagem simples de PainReport.
    expect(contextEvents.getGapStatus).toHaveBeenCalledTimes(2);
    expect(reassessmentService.state).toHaveBeenCalledTimes(2);
  });
});

describe('ReassessmentService.getTrajectoryForAdmin — nao recalcula quando ja existe snapshot persistido (secao 29)', () => {
  function buildService(prisma: Record<string, unknown>) {
    return new ReassessmentService(prisma as never, noop(), noop(), noop());
  }

  it('reusa o trajectorySnapshot do Evolution Report valido mais recente, sem chamar buildReassessmentTrajectories de novo', async () => {
    const persistedTrajectory = [{ variableId: 'reassessment.rating_energy', label: 'x', domain: 'x', kind: 'rating_1_10', comparability: 'DIRECT', unit: '1-10', points: [], n: 1 }];
    const prisma = {
      onboardingInterview: { findUnique: jest.fn().mockResolvedValue({ answers: {}, completedAt: new Date(), interviewVersion: 1 }) },
      reassessment: { findMany: jest.fn().mockResolvedValue([]) },
      evolutionReport: {
        findMany: jest.fn().mockResolvedValue([{ id: 'er1', trajectorySnapshot: persistedTrajectory, invalidatedAt: null, createdAt: new Date() }]),
        findFirst: jest.fn().mockResolvedValue({ id: 'er1', trajectorySnapshot: persistedTrajectory, invalidatedAt: null }),
      },
    };
    const result = await buildService(prisma).getTrajectoryForAdmin('u1');
    expect(result.trajectories).toBe(persistedTrajectory); // mesma referencia — nunca recalculado
  });

  it('sem nenhum Evolution Report valido, cai no fallback puro (mesma funcao ja usada em complete(), nao uma logica nova) e nao inventa reavaliacoes inexistentes', async () => {
    const prisma = {
      onboardingInterview: { findUnique: jest.fn().mockResolvedValue({ answers: { rating_energy: 7 }, completedAt: new Date('2026-08-01'), interviewVersion: 1 }) },
      reassessment: { findMany: jest.fn().mockResolvedValue([]) },
      evolutionReport: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    };
    const result = await buildService(prisma).getTrajectoryForAdmin('u1');
    const energy = result.trajectories.find((t) => t.variableId === 'reassessment.rating_energy')!;
    expect(energy.points).toHaveLength(1); // so' o INITIAL — nenhum R1/R2 inventado
    expect(energy.points[0].value).toBe(7);
  });
});

describe('ContextEventsService.listForStudent — historico completo pro Admin (secao 28/AC)', () => {
  it('lista todos os eventos do aluno, mais recente primeiro, sem filtrar por recente/ativo', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'e2' }, { id: 'e1' }]);
    const service = new ContextEventsService({ contextEvent: { findMany } } as never);
    const result = await service.listForStudent('u1');
    expect(result).toEqual([{ id: 'e2' }, { id: 'e1' }]);
    expect(findMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, orderBy: { createdAt: 'desc' } });
  });
});
