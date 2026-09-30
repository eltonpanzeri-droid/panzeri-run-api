import { MedalEvaluationService } from '../src/medals/medal-evaluation.service';
import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';

// Sistema de Medalhas, etapa 6 (30/09/2026) — aderência usa realizado ÷ elegível (extra fora do
// denominador, ver evolution-metric-adherence-extra.spec.ts pra correção canônica em si). Estes
// testes cobrem especificamente a avaliação de MEDALHA em cima dessa aderência já corrigida.

function trainingSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-default',
    userId: 'aluno-1',
    scheduledDate: new Date('2026-08-03T00:00:00Z'),
    modality: 'corrida',
    structure: {},
    plan: { status: 'active' },
    completion: null,
    ...overrides,
  };
}

function achievementRow(code: string) {
  return { id: `id-${code}`, code, ruleVersion: 1 };
}

function buildService(sessions: unknown[], achievements: Array<{ id: string; code: string; ruleVersion: number }>) {
  const userAchievementCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) },
    achievement: { findMany: jest.fn().mockResolvedValue(achievements) },
    userAchievement: { findMany: jest.fn().mockResolvedValue([]), create: userAchievementCreate },
  };
  const evolutionMetric = new EvolutionMetricService({ trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) } } as never);
  const service = new MedalEvaluationService(prisma as never, evolutionMetric);
  return { service, userAchievementCreate };
}

function weekOfSessions(weekStartIso: string, prescribed: number, done: number, missed: number, extra: number) {
  const sessions: unknown[] = [];
  let day = 0;
  for (let i = 0; i < prescribed; i++) {
    const isDone = i < done;
    sessions.push(trainingSession({
      id: `${weekStartIso}-p${i}`,
      scheduledDate: new Date(new Date(weekStartIso + 'T00:00:00Z').getTime() + day * 86400000),
      completion: isDone
        ? { status: 'done', distanceKm: 5, id: `c-${weekStartIso}-${i}` }
        : (i < done + missed ? { status: 'missed', distanceKm: null, id: `c-${weekStartIso}-${i}` } : null),
    }));
    day++;
  }
  for (let i = 0; i < extra; i++) {
    sessions.push(trainingSession({
      id: `${weekStartIso}-e${i}`,
      scheduledDate: new Date(new Date(weekStartIso + 'T00:00:00Z').getTime() + day * 86400000),
      structure: { source: 'student', type: 'extra' },
      completion: { status: 'done', distanceKm: 5, id: `ce-${weekStartIso}-${i}` },
    }));
    day++;
  }
  return sessions;
}

describe('MedalEvaluationService — aderência (etapa 6): extra nunca infla a conquista', () => {
  it('prescrito=4, feitas=3, extra=2 -> aderencia real 75%, NUNCA desbloqueia "primeira semana >=90%"', async () => {
    const sessions = weekOfSessions('2026-08-03', 4, 3, 1, 2); // 75%, nao 80% nem 83%
    const { service, userAchievementCreate } = buildService(sessions, [achievementRow('aderencia_primeira_semana_90')]);
    await service.evaluateForUser('aluno-1', 'week_closed');
    expect(userAchievementCreate).not.toHaveBeenCalled();
  });

  it('prescrito=4, feitas=4 (100%, sem extra): desbloqueia "primeira semana >=90%"', async () => {
    const sessions = weekOfSessions('2026-08-03', 4, 4, 0, 0);
    const { service, userAchievementCreate } = buildService(sessions, [achievementRow('aderencia_primeira_semana_90')]);
    const unlocked = await service.evaluateForUser('aluno-1', 'week_closed');
    expect(unlocked).toContain('aderencia_primeira_semana_90');
    expect(userAchievementCreate).toHaveBeenCalledTimes(1);
  });
});

describe('MedalEvaluationService — semana perfeita', () => {
  it('100% com pelo menos 2 sessoes prescritas: desbloqueia semana perfeita', async () => {
    const sessions = weekOfSessions('2026-08-03', 3, 3, 0, 0);
    const { service, userAchievementCreate } = buildService(sessions, [achievementRow('aderencia_semana_perfeita')]);
    const unlocked = await service.evaluateForUser('aluno-1', 'week_closed');
    expect(unlocked).toContain('aderencia_semana_perfeita');
    expect(userAchievementCreate).toHaveBeenCalledTimes(1);
  });

  it('100% mas so 1 sessao prescrita: NAO desbloqueia semana perfeita (minimo de 2 sessoes)', async () => {
    const sessions = weekOfSessions('2026-08-03', 1, 1, 0, 0);
    const { service, userAchievementCreate } = buildService(sessions, [achievementRow('aderencia_semana_perfeita')]);
    await service.evaluateForUser('aluno-1', 'week_closed');
    expect(userAchievementCreate).not.toHaveBeenCalled();
  });

  it('extra nao ajuda a fechar semana perfeita: 3 prescritas com 1 faltando + 2 extras feitos continua NAO perfeita', async () => {
    const sessions = weekOfSessions('2026-08-03', 3, 2, 1, 2); // 2/3 prescritas, aderencia 67%
    const { service, userAchievementCreate } = buildService(sessions, [achievementRow('aderencia_semana_perfeita')]);
    await service.evaluateForUser('aluno-1', 'week_closed');
    expect(userAchievementCreate).not.toHaveBeenCalled();
  });
});

describe('MedalEvaluationService — streak de aderência (4/8/12/24/52 semanas >=90%)', () => {
  it('4 semanas consecutivas todas >=90% desbloqueia o streak de 4 semanas', async () => {
    const weeks = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'];
    const sessions = weeks.flatMap((w) => weekOfSessions(w, 4, 4, 0, 0));
    const { service, userAchievementCreate } = buildService(sessions, [achievementRow('aderencia_semanas_90_4')]);
    const unlocked = await service.evaluateForUser('aluno-1', 'week_closed');
    expect(unlocked).toContain('aderencia_semanas_90_4');
    expect(userAchievementCreate).toHaveBeenCalledTimes(1);
  });

  it('uma semana ruim no meio quebra a sequencia — streak de 4 nao desbloqueia', async () => {
    const sessions = [
      ...weekOfSessions('2026-08-03', 4, 4, 0, 0),
      ...weekOfSessions('2026-08-10', 4, 1, 3, 0), // semana ruim: 25%
      ...weekOfSessions('2026-08-17', 4, 4, 0, 0),
      ...weekOfSessions('2026-08-24', 4, 4, 0, 0),
    ];
    const { service, userAchievementCreate } = buildService(sessions, [achievementRow('aderencia_semanas_90_4')]);
    await service.evaluateForUser('aluno-1', 'week_closed');
    expect(userAchievementCreate).not.toHaveBeenCalled();
  });
});
