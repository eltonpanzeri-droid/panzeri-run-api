import { Prisma } from '@prisma/client';
import { MedalEvaluationService } from '../src/medals/medal-evaluation.service';
import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';

// Sistema de Medalhas (30/09/2026) — testes de integração leve (Prisma mockado) do motor de
// avaliação. Cada bloco cobre UMA família, confirmando que a regra central (execução real) é
// respeitada e que a persistência nunca duplica uma conquista já existente.

function trainingSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-default',
    userId: 'aluno-1',
    scheduledDate: new Date('2026-08-03T00:00:00Z'),
    modality: 'corrida',
    structure: {},
    completion: null,
    executionLinks: [],
    ...overrides,
  };
}

function buildEvolutionMetric(sessions: unknown[]) {
  const prisma = { trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) }, activityLog: { findMany: jest.fn().mockResolvedValue([]) } };
  return new EvolutionMetricService(prisma as never);
}

function buildService(opts: {
  trainingSessions?: unknown[];
  workoutCompletionCount?: number;
  weeklyCheckIns?: unknown[];
  reassessmentCount?: number;
  achievements?: Array<{ id: string; code: string; ruleVersion: number }>;
  existingUnlocks?: string[]; // achievementIds já desbloqueados
}) {
  const {
    trainingSessions = [],
    workoutCompletionCount = 0,
    weeklyCheckIns = [],
    reassessmentCount = 0,
    achievements = [],
    existingUnlocks = [],
  } = opts;

  const userAchievementCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    trainingSession: { findMany: jest.fn().mockResolvedValue(trainingSessions) },
    workoutCompletion: { count: jest.fn().mockResolvedValue(workoutCompletionCount) },
    weeklyCheckIn: { findMany: jest.fn().mockResolvedValue(weeklyCheckIns) },
    reassessment: { count: jest.fn().mockResolvedValue(reassessmentCount) },
    achievement: { findMany: jest.fn().mockResolvedValue(achievements) },
    userAchievement: {
      findMany: jest.fn().mockResolvedValue(existingUnlocks.map((achievementId) => ({ achievementId }))),
      create: userAchievementCreate,
    },
  };
  const evolutionMetric = buildEvolutionMetric(trainingSessions);
  const service = new MedalEvaluationService(prisma as never, evolutionMetric);
  return { service, prisma, userAchievementCreate };
}

function achievementRow(code: string, id = `id-${code}`, ruleVersion = 1) {
  return { id, code, ruleVersion };
}

describe('MedalEvaluationService — treinos_concluidos (execução real, all-time)', () => {
  it('desbloqueia todos os limiares <= total de treinos concluídos', async () => {
    const { service, userAchievementCreate } = buildService({
      workoutCompletionCount: 12,
      achievements: [achievementRow('treinos_concluidos_1'), achievementRow('treinos_concluidos_5'), achievementRow('treinos_concluidos_10'), achievementRow('treinos_concluidos_25')],
    });
    const unlocked = await service.evaluateForUser('aluno-1', 'workout_completed');
    expect(unlocked).toEqual(expect.arrayContaining(['treinos_concluidos_1', 'treinos_concluidos_5', 'treinos_concluidos_10']));
    expect(unlocked).not.toContain('treinos_concluidos_25');
    expect(userAchievementCreate).toHaveBeenCalledTimes(3);
  });

  it('nunca re-desbloqueia uma medalha já conquistada (idempotência)', async () => {
    const { service, userAchievementCreate } = buildService({
      workoutCompletionCount: 12,
      achievements: [achievementRow('treinos_concluidos_1', 'id-1'), achievementRow('treinos_concluidos_5', 'id-5')],
      existingUnlocks: ['id-1'],
    });
    const unlocked = await service.evaluateForUser('aluno-1', 'workout_completed');
    expect(unlocked).toEqual(['treinos_concluidos_5']);
    expect(userAchievementCreate).toHaveBeenCalledTimes(1);
  });

  it('corrida concorrente (P2002) nunca propaga erro — trata como já conquistada', async () => {
    const { service, prisma } = buildService({
      workoutCompletionCount: 1,
      achievements: [achievementRow('treinos_concluidos_1')],
    });
    (prisma.userAchievement.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(service.evaluateForUser('aluno-1', 'workout_completed')).resolves.toEqual([]);
  });

  it('evaluateForUser NUNCA lança, mesmo com falha total de banco (nao pode derrubar a acao real)', async () => {
    const prisma = { trainingSession: { findMany: jest.fn().mockRejectedValue(new Error('banco fora')) } };
    const service = new MedalEvaluationService(prisma as never, buildEvolutionMetric([]));
    await expect(service.evaluateForUser('aluno-1', 'workout_completed')).resolves.toEqual([]);
  });
});

describe('MedalEvaluationService — distancia_unica (execução real da SESSÃO, nunca o prescrito)', () => {
  it('prescrito 20km, executado 10km -> considera 10km (regra central de execução real)', async () => {
    const { service } = buildService({
      trainingSessions: [
        trainingSession({ id: 's1', distanceKm: 20, completion: { status: 'done', distanceKm: 10, id: 'c1' } }),
      ],
      achievements: [achievementRow('distancia_unica_corrida_10km'), achievementRow('distancia_unica_corrida_12km')],
    });
    const unlocked = await service.evaluateForUser('aluno-1', 'workout_completed');
    expect(unlocked).toEqual(['distancia_unica_corrida_10km']);
  });

  it('executado ACIMA do prescrito conta o valor real (nunca trava no prescrito)', async () => {
    const { service } = buildService({
      trainingSessions: [
        trainingSession({ id: 's1', distanceKm: 10, completion: { status: 'done', distanceKm: 15, id: 'c1' } }),
      ],
      achievements: [achievementRow('distancia_unica_corrida_12km'), achievementRow('distancia_unica_corrida_15km')],
    });
    const unlocked = await service.evaluateForUser('aluno-1', 'workout_completed');
    expect(unlocked.sort()).toEqual(['distancia_unica_corrida_12km', 'distancia_unica_corrida_15km']);
  });

  it('sessao extra tambem conta pra distancia unica (extra e execucao real)', async () => {
    const { service } = buildService({
      trainingSessions: [
        trainingSession({ id: 'e1', structure: { source: 'student', type: 'extra' }, distanceKm: null, completion: { status: 'done', distanceKm: 21.1, id: 'c1' } }),
      ],
      achievements: [achievementRow('distancia_unica_corrida_21_1km')],
    });
    const unlocked = await service.evaluateForUser('aluno-1', 'workout_completed');
    expect(unlocked).toEqual(['distancia_unica_corrida_21_1km']);
  });
});

describe('MedalEvaluationService — acumulado (soma progressiva de execução real)', () => {
  it('soma sessoes na ordem cronologica e desbloqueia o limiar quando o acumulado cruza', async () => {
    const { service } = buildService({
      trainingSessions: [
        trainingSession({ id: 's1', scheduledDate: new Date('2026-08-03T00:00:00Z'), completion: { status: 'done', distanceKm: 60, id: 'c1' } }),
        trainingSession({ id: 's2', scheduledDate: new Date('2026-08-10T00:00:00Z'), completion: { status: 'done', distanceKm: 60, id: 'c2' } }),
      ],
      achievements: [achievementRow('acumulado_corrida_100km'), achievementRow('acumulado_corrida_250km')],
    });
    const unlocked = await service.evaluateForUser('aluno-1', 'workout_completed');
    expect(unlocked).toEqual(['acumulado_corrida_100km']);
  });
});

describe('MedalEvaluationService — feedbacks (fornecer a informação, nao o conteudo)', () => {
  it('conta QUALQUER WorkoutCompletion, inclusive status missed (relatar "nao fiz" tambem e informacao)', async () => {
    const { service, prisma } = buildService({
      workoutCompletionCount: 5,
      achievements: [achievementRow('feedbacks_1'), achievementRow('feedbacks_5'), achievementRow('feedbacks_10')],
    });
    const unlocked = await service.evaluateForUser('aluno-1', 'workout_completed');
    expect(unlocked.sort()).toEqual(['feedbacks_1', 'feedbacks_5']);
    // confirma que a query NAO filtra por status (ao contrario de treinos_concluidos)
    expect(prisma.workoutCompletion.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ status: expect.anything() }) }),
    );
  });
});

describe('MedalEvaluationService — checkins (respeita sentinelas v1 e v2 de "pulou")', () => {
  it('v1: elaborationSatisfaction===0 e pulado, qualquer outro valor conta', async () => {
    const { service } = buildService({
      weeklyCheckIns: [
        { checkinVersion: 1, checkinSkipped: false, elaborationSatisfaction: 0 }, // pulado (v1)
        { checkinVersion: 1, checkinSkipped: false, elaborationSatisfaction: 3 }, // real
        { checkinVersion: 1, checkinSkipped: false, elaborationSatisfaction: 4 }, // real
      ],
      achievements: [achievementRow('checkins_4')],
    });
    const unlocked = await service.evaluateForUser('aluno-1', 'weekly_checkin_submitted');
    expect(unlocked).toEqual([]); // so 2 reais, ainda nao bateu 4
  });

  it('v2: checkinSkipped=true e pulado, independente de elaborationSatisfaction (nao existe em v2) — so os reais contam', async () => {
    const { service } = buildService({
      weeklyCheckIns: [
        { checkinVersion: 2, checkinSkipped: true, elaborationSatisfaction: null }, // pulado, nao conta
        { checkinVersion: 2, checkinSkipped: false, elaborationSatisfaction: null },
        { checkinVersion: 2, checkinSkipped: false, elaborationSatisfaction: null },
        { checkinVersion: 2, checkinSkipped: false, elaborationSatisfaction: null },
        { checkinVersion: 2, checkinSkipped: false, elaborationSatisfaction: null },
      ],
      achievements: [achievementRow('checkins_4')],
    });
    const unlocked = await service.evaluateForUser('aluno-1', 'weekly_checkin_submitted');
    expect(unlocked).toEqual(['checkins_4']); // 4 reais (o pulado nao conta) -> bate o limiar de 4
  });
});

describe('MedalEvaluationService — reavaliacoes (so completedAt != null)', () => {
  it('desbloqueia conforme a contagem de reavaliacoes concluidas', async () => {
    const { service } = buildService({
      reassessmentCount: 2,
      achievements: [achievementRow('reavaliacoes_1'), achievementRow('reavaliacoes_2'), achievementRow('reavaliacoes_4')],
    });
    const unlocked = await service.evaluateForUser('aluno-1', 'reassessment_completed');
    expect(unlocked.sort()).toEqual(['reavaliacoes_1', 'reavaliacoes_2']);
  });
});

describe('MedalEvaluationService — trigger mapping', () => {
  it('workout_completed nunca avalia categorias de check-in/reavaliacao (gatilho errado nao deveria nem consultar)', async () => {
    const { service, prisma } = buildService({ achievements: [] });
    await service.evaluateForUser('aluno-1', 'workout_completed');
    expect(prisma.weeklyCheckIn.findMany).not.toHaveBeenCalled();
    expect(prisma.reassessment.count).not.toHaveBeenCalled();
  });

  it('weekly_checkin_submitted so avalia checkins', async () => {
    const { service, prisma } = buildService({ achievements: [] });
    await service.evaluateForUser('aluno-1', 'weekly_checkin_submitted');
    expect(prisma.workoutCompletion.count).not.toHaveBeenCalled();
    expect(prisma.weeklyCheckIn.findMany).toHaveBeenCalled();
  });
});
