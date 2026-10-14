import { Prisma } from '@prisma/client';
import { pendingModel } from './pending-fake';

// Prisma em memoria so' para medalhas (catalogo, concessoes, transicoes) + os contadores que as categorias de contagem leem. Nao e' o banco: nao prova
// transacao nem migracao reais (ver relatorio); prova a LOGICA de concessao, revogacao, reativacao, ajuste e historico.
type Row = Record<string, any>;

export interface MedalsFakeOptions {
  achievements: Array<{ id: string; code: string; category: string; ruleVersion?: number; active?: boolean; threshold?: number | null; criteria?: Prisma.JsonValue; grau?: string; name?: string; description?: string; unit?: string | null }>;
  awards?: Row[];
  // totais lidos pelas categorias de contagem
  completedTotal?: number;
  feedbackTotal?: number;
}

export function medalsFake(options: MedalsFakeOptions) {
  const state = { completedTotal: options.completedTotal ?? 0, feedbackTotal: options.feedbackTotal ?? 0 };
  const catalog = options.achievements.map((a) => ({ ruleVersion: 1, active: true, threshold: null, criteria: {}, grau: 'bronze', name: a.code, description: '', unit: null, ...a }));
  let seq = 0;
  const awards = new Map<string, Row>((options.awards ?? []).map((a) => [a.id, { userId: 'u1', value: null, periodStart: null, periodEnd: null, modality: null, evidence: {}, ruleVersionAtUnlock: 1, status: 'active', statusChangedAt: null, revokedAt: null, revokedReason: null, unlockedAt: new Date('2026-10-01T00:00:00Z'), ...a }]));
  const transitions: Row[] = [];
  const pending = pendingModel();
  const byAchievement = (id: string) => catalog.find((c) => c.id === id);
  const withAchievement = (row: Row) => ({ ...row, achievement: byAchievement(row.achievementId) });

  const prisma: any = {
    correctionReevaluation: pending.model,
    achievement: {
      findMany: jest.fn(async ({ where }: any) => catalog.filter((c) => (!where?.code?.in || where.code.in.includes(c.code)) && (!where?.category?.in || where.category.in.includes(c.category)) && (where?.active === undefined || c.active === where.active))),
    },
    userAchievement: {
      findMany: jest.fn(async ({ where }: any = {}) => [...awards.values()]
        .filter((a) => (!where?.userId || a.userId === where.userId) && (!where?.achievementId?.in || where.achievementId.in.includes(a.achievementId)) && (!where?.achievement?.category?.in || where.achievement.category.in.includes(byAchievement(a.achievementId)?.category)))
        .map((a) => withAchievement(a))),
      findUnique: jest.fn(async ({ where }: any) => (awards.get(where.id) ? { ...awards.get(where.id) } : null)),
      create: jest.fn(async ({ data }: any) => {
        if ([...awards.values()].some((a) => a.userId === data.userId && a.achievementId === data.achievementId)) {
          throw new Prisma.PrismaClientKnownRequestError('duplicada', { code: 'P2002', clientVersion: 'test' });
        }
        const row = { id: `ua-${++seq}`, unlockedAt: new Date('2026-10-14T12:00:00Z'), revokedAt: null, revokedReason: null, statusChangedAt: null, ...data };
        awards.set(row.id, row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = awards.get(where.id);
        if (!row) throw new Error('inexistente');
        Object.assign(row, data);
        return { ...row };
      }),
    },
    userAchievementTransition: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `t-${transitions.length + 1}`, ...data }; transitions.push(row); return row; }),
      findMany: jest.fn(async ({ where }: any = {}) => transitions.filter((t) => (!where?.userId || t.userId === where.userId) && (!where?.type || t.type === where.type) && (!where?.userAchievementId?.in || where.userAchievementId.in.includes(t.userAchievementId)))
        .sort((a, b) => b.at.getTime() - a.at.getTime()).map((t) => ({ ...t, userAchievement: withAchievement(awards.get(t.userAchievementId) ?? {}) }))),
    },
    workoutCompletion: { count: jest.fn(async ({ where }: any) => (where?.status ? state.completedTotal : state.feedbackTotal)) },
    trainingSession: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    $executeRaw: jest.fn(async () => 0),
  };
  return { prisma, awards, transitions, pending, state, catalog };
}

export const evolutionStub = () => ({
  getRunMedalUncertainty: jest.fn(async () => ({ weeks: new Set<string>(), months: new Set<string>() })),
  getRunSeries: jest.fn(async () => ({ weeks: [], months: [], calculatedAt: '2026-10-15T00:00:00Z' })),
  getSeries: jest.fn(async () => ({ weeks: [], months: [], calculatedAt: '2026-10-15T00:00:00Z' })),
});
