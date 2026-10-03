import { MedalsService } from '../src/medals/medals.service';
import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';

// Sistema de Medalhas (30/09/2026) — lado de leitura (etapa 5). Confirma que progresso usa
// EXECUÇÃO REAL e que a regra de segurança do item 16 (não empurrar medalha muito acima da
// prescrição como "próximo objetivo") é aplicada corretamente, sem nunca decidir treino.

function trainingSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-default',
    userId: 'aluno-1',
    scheduledDate: new Date('2026-08-03T00:00:00Z'),
    modality: 'corrida',
    structure: {},
    plan: { status: 'active' },
    completion: null,
    executionLinks: [],
    ...overrides,
  };
}

function buildService(opts: {
  trainingSessions?: unknown[];
  workoutCompletionCount?: number;
  weeklyCheckIns?: unknown[];
  reassessmentCount?: number;
  unlockedCodes?: string[];
  activePlan?: { id: string } | null;
  planSessions?: unknown[];
}) {
  const {
    trainingSessions = [],
    workoutCompletionCount = 0,
    weeklyCheckIns = [],
    reassessmentCount = 0,
    unlockedCodes = [],
    activePlan = null,
    planSessions = [],
  } = opts;

  const prisma = {
    trainingSession: {
      findMany: jest.fn().mockImplementation(({ where }: { where?: { planId?: string } } = {}) =>
        Promise.resolve(where?.planId ? planSessions : trainingSessions),
      ),
      findFirst: jest.fn().mockImplementation(() => {
        const withDistance = trainingSessions.filter((s: unknown) => (s as { completion?: { distanceKm?: number } }).completion?.distanceKm != null);
        const sorted = [...withDistance].sort(
          (a, b) => (b as { completion: { distanceKm: number } }).completion.distanceKm - (a as { completion: { distanceKm: number } }).completion.distanceKm,
        );
        return Promise.resolve(sorted[0] ?? null);
      }),
    },
    workoutCompletion: { count: jest.fn().mockResolvedValue(workoutCompletionCount) },
    weeklyCheckIn: { findMany: jest.fn().mockResolvedValue(weeklyCheckIns) },
    reassessment: { count: jest.fn().mockResolvedValue(reassessmentCount) },
    userAchievement: {
      findMany: jest.fn().mockResolvedValue(unlockedCodes.map((code) => ({ achievement: { code } }))),
    },
    trainingPlan: { findFirst: jest.fn().mockResolvedValue(activePlan) },
  };
  const evolutionMetric = new EvolutionMetricService({ trainingSession: { findMany: jest.fn().mockResolvedValue(trainingSessions) }, activityLog: { findMany: jest.fn().mockResolvedValue([]) } } as never);
  const medalEvaluation = { evaluateForUser: jest.fn().mockResolvedValue([]) };
  const service = new MedalsService(prisma as never, evolutionMetric, medalEvaluation as never);
  return { service, prisma, medalEvaluation };
}

describe('MedalsService.getSummary', () => {
  it('reavalia categorias de fechamento semanal ANTES de ler (nao existe cron dedicado)', async () => {
    const { service, medalEvaluation } = buildService({});
    await service.getSummary('aluno-1');
    expect(medalEvaluation.evaluateForUser).toHaveBeenCalledWith('aluno-1', 'week_closed');
  });

  it('leitura continua funcionando mesmo se a reavaliacao lazy falhar', async () => {
    const { service, medalEvaluation } = buildService({});
    medalEvaluation.evaluateForUser.mockRejectedValue(new Error('falhou'));
    await expect(service.getSummary('aluno-1')).resolves.toEqual(expect.objectContaining({ unlocked: [], progress: expect.any(Array) }));
  });
});

describe('MedalsService.getProgress — próxima conquista por categoria', () => {
  it('mostra o PRÓXIMO limiar nao conquistado, nunca o ja conquistado', async () => {
    const { service } = buildService({ workoutCompletionCount: 7, unlockedCodes: ['treinos_concluidos_1', 'treinos_concluidos_5'] });
    const progress = await service.getProgress('aluno-1');
    const treinos = progress.find((p) => p.category === 'treinos_concluidos');
    expect(treinos?.code).toBe('treinos_concluidos_10');
    expect(treinos?.currentValue).toBe(7);
  });

  it('categoria totalmente conquistada nao aparece em progress', async () => {
    const allTreinosCodes = ['treinos_concluidos_1', 'treinos_concluidos_5', 'treinos_concluidos_10', 'treinos_concluidos_25', 'treinos_concluidos_50', 'treinos_concluidos_100', 'treinos_concluidos_250', 'treinos_concluidos_500', 'treinos_concluidos_1000'];
    const { service } = buildService({ workoutCompletionCount: 2000, unlockedCodes: allTreinosCodes });
    const progress = await service.getProgress('aluno-1');
    expect(progress.find((p) => p.category === 'treinos_concluidos')).toBeUndefined();
  });
});

describe('MedalsService.getProgress — regra de segurança da prescrição (item 16/seção 16)', () => {
  it('sem plano ativo (sem prescricao pra comparar): nunca filtra, recommendedAsNextGoal fica null', async () => {
    const { service } = buildService({ activePlan: null });
    const progress = await service.getProgress('aluno-1');
    const volumeSemanal = progress.find((p) => p.category === 'volume_semanal');
    expect(volumeSemanal?.recommendedAsNextGoal).toBeNull();
  });

  it('limiar dentro de 1.5x da prescricao atual: recomendado', async () => {
    const { service } = buildService({
      activePlan: { id: 'plan-1' },
      planSessions: [{ distanceKm: 8 }, { distanceKm: 8 }], // 16km/semana prescritos
    });
    const progress = await service.getProgress('aluno-1');
    const volumeSemanal10 = progress.find((p) => p.category === 'volume_semanal'); // primeiro nao conquistado: 10km
    expect(volumeSemanal10?.threshold).toBe(10);
    expect(volumeSemanal10?.recommendedAsNextGoal).toBe(true); // 10 <= 16*1.5
  });

  it('limiar MUITO acima da prescricao atual: existe no catalogo mas nao e recomendado (nunca estimula excesso)', async () => {
    const { service } = buildService({
      activePlan: { id: 'plan-1' },
      planSessions: [{ distanceKm: 2 }], // 2km/semana prescritos — bem pouco
      unlockedCodes: ['volume_semanal_corrida_10km'], // ja passou dos 10km, proximo seria 20km
    });
    const progress = await service.getProgress('aluno-1');
    const volumeSemanal20 = progress.find((p) => p.category === 'volume_semanal');
    expect(volumeSemanal20?.threshold).toBe(20);
    expect(volumeSemanal20?.recommendedAsNextGoal).toBe(false); // 20 > 2*1.5=3
  });
});

describe('MedalsService.getProgress — sustentacao_volume usa streak ATUAL (nao o historico maximo)', () => {
  it('cada patamar aparece com sua propria proxima medalha e progresso independente', async () => {
    const { service } = buildService({});
    const progress = await service.getProgress('aluno-1');
    const sustentacao = progress.filter((p) => p.category === 'sustentacao_volume');
    expect(sustentacao).toHaveLength(6); // 6 patamares, cada um com sua propria "proxima"
  });
});

describe('MedalsService.getUnlocked', () => {
  it('devolve as medalhas conquistadas com os dados de evidencia/execucao real preservados', async () => {
    const unlockedAt = new Date('2026-09-01T00:00:00Z');
    const prisma = {
      userAchievement: {
        findMany: jest.fn().mockResolvedValue([
          {
            achievement: { code: 'distancia_unica_corrida_10km', category: 'distancia_unica', name: '10km numa corrida', description: 'd', grau: 'prata', unit: 'km' },
            unlockedAt,
            value: 10.4,
            periodStart: unlockedAt,
            periodEnd: unlockedAt,
            modality: 'corrida',
          },
        ]),
      },
    };
    const service = new MedalsService(prisma as never, {} as never, { evaluateForUser: jest.fn() } as never);
    const unlocked = await service.getUnlocked('aluno-1');
    expect(unlocked).toEqual([
      expect.objectContaining({ code: 'distancia_unica_corrida_10km', value: 10.4, grau: 'prata' }),
    ]);
  });
});
