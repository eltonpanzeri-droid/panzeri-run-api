import { PrismaClient } from '@prisma/client';
import { refreshReviewContent, reviewAccountStatus, reviewUserId, seedReviewAccount } from '../../src/app-review/review-accounts';
import { startOfWeek } from '../../src/training-plans/training-plans.service';
import { createTestPrisma } from './pg-guard';

// Contas de demonstracao da App Store (24/10/2026): criam o estado certo, sao idempotentes, nunca tocam em conta alheia e o estado "expirada" nao depende da Apple.
describe('contas de revisao da App Store (PostgreSQL local de teste)', () => {
  let prisma: PrismaClient;
  const active = { kind: 'active' as const, email: 'revisao-apple-teste-ativa@example.test', password: 'senha-de-teste-ativa-1' };
  const expired = { kind: 'expired' as const, email: 'revisao-apple-teste-expirada@example.test', password: 'senha-de-teste-expirada-1' };

  beforeAll(() => { prisma = createTestPrisma(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('cria a conta ativa completa e a expirada com programa travado, e e idempotente', async () => {
    await seedReviewAccount(prisma, active);
    await seedReviewAccount(prisma, expired);
    const again = await seedReviewAccount(prisma, active);
    expect(again.created).toBe(false);
    await seedReviewAccount(prisma, expired);

    const rows = await reviewAccountStatus(prisma, [active.email, expired.email]);
    const [a, e] = rows as Array<Record<string, unknown>>;
    expect(a).toMatchObject({ exists: true, isReviewAccount: true, status: 'manual_active', provider: 'revenuecat', plans: 5, sessions: 20, hasCurrentWeekPlan: true });
    expect(e).toMatchObject({ exists: true, isReviewAccount: true, status: 'canceled', provider: 'revenuecat', plans: 5, hasCurrentWeekPlan: true });
    // idempotente: rodar de novo nao duplica nada
    expect(await prisma.user.count({ where: { email: { in: [active.email, expired.email] } } })).toBe(2);
    expect(await prisma.trainingPlan.count({ where: { userId: reviewUserId(active.email) } })).toBe(5);

    const week = startOfWeek(new Date());
    const current = await prisma.trainingPlan.findFirst({ where: { userId: reviewUserId(active.email), status: 'active' } });
    expect(current?.startDate.getTime()).toBe(week.getTime());
    // a conta expirada nao tem NENHUMA assinatura da loja registrada (nada que a Apple/RevenueCat possa "reativar")
    const store = await prisma.billingSubscription.findUnique({ where: { userId: reviewUserId(expired.email) } });
    expect(store).toMatchObject({ provider: 'revenuecat', providerStatus: 'expired', externalSubscriptionId: null });
  });

  it('o seed NAO reverte uma compra Sandbox legitima; --reset-access devolve a conta ao estado expirado', async () => {
    await seedReviewAccount(prisma, expired);
    const id = reviewUserId(expired.email);
    // compra Sandbox reconhecida pelo fluxo normal: ativa, com assinatura da loja registrada
    await prisma.user.update({ where: { id }, data: { subscriptionStatus: 'active' } });
    await prisma.billingSubscription.update({ where: { userId: id }, data: { providerStatus: 'active', externalSubscriptionId: 'sandbox-teste-1' } });
    await seedReviewAccount(prisma, expired);
    expect(await prisma.user.findUniqueOrThrow({ where: { id }, select: { subscriptionStatus: true } })).toEqual({ subscriptionStatus: 'active' });
    expect(await prisma.billingSubscription.findUnique({ where: { userId: id } })).toMatchObject({ providerStatus: 'active', externalSubscriptionId: 'sandbox-teste-1' });
    await seedReviewAccount(prisma, expired, new Date(), { resetAccess: true });
    expect(await prisma.user.findUniqueOrThrow({ where: { id }, select: { subscriptionStatus: true } })).toEqual({ subscriptionStatus: 'canceled' });
    expect(await prisma.billingSubscription.findUnique({ where: { userId: id } })).toMatchObject({ providerStatus: 'expired', externalSubscriptionId: null });
  });

  it('a renovacao automatica reconstroi so o conteudo quando a semana vira e preserva assinatura e senha', async () => {
    await seedReviewAccount(prisma, active);
    await seedReviewAccount(prisma, expired);
    const idB = reviewUserId(expired.email);
    await prisma.user.update({ where: { id: idB }, data: { subscriptionStatus: 'active' } });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: reviewUserId(active.email) }, select: { passwordHash: true } });
    expect(await refreshReviewContent(prisma)).toMatchObject({ refreshed: 0 }); // semana atual ja tem programa
    const nextWeek = new Date(Date.now() + 8 * 86_400_000);
    const result = await refreshReviewContent(prisma, nextWeek);
    expect(result.refreshed).toBeGreaterThanOrEqual(2);
    const week = startOfWeek(nextWeek);
    expect((await prisma.trainingPlan.findFirst({ where: { userId: reviewUserId(active.email), status: 'active' } }))?.startDate.getTime()).toBe(week.getTime());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: reviewUserId(active.email) }, select: { passwordHash: true } })).passwordHash).toBe(before.passwordHash);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: idB }, select: { subscriptionStatus: true } })).subscriptionStatus).toBe('active'); // compra preservada
    expect((await prisma.user.findUniqueOrThrow({ where: { id: reviewUserId(active.email) }, select: { subscriptionStatus: true } })).subscriptionStatus).toBe('manual_active');
    await seedReviewAccount(prisma, expired, new Date(), { resetAccess: true });
  });

  it('a renovacao ACRESCENTA a semana nova sem apagar o que o revisor registrou e nao toca em nenhuma conta real', async () => {
    const realId = 'conta-real-teste-refresh';
    const realEmail = 'aluna.real.refresh@example.test';
    await prisma.workoutCompletion.deleteMany({ where: { userId: realId } });
    await prisma.trainingSession.deleteMany({ where: { userId: realId } });
    await prisma.trainingPlan.deleteMany({ where: { userId: realId } });
    await prisma.user.deleteMany({ where: { id: realId } });
    await prisma.user.create({ data: { id: realId, email: realEmail, passwordHash: 'x', name: 'Aluna real', sex: 'Feminino', subscriptionStatus: 'active' } });
    const realPlan = await prisma.trainingPlan.create({ data: { userId: realId, name: 'Real', goal: 'g', status: 'active', startDate: new Date('2020-01-06T00:00:00.000Z'), inputSnapshot: {} } });
    const realSession = await prisma.trainingSession.create({ data: { planId: realPlan.id, userId: realId, scheduledDate: new Date('2020-01-07T00:00:00.000Z'), weekday: 2, modality: 'corrida', title: 'Corrida', structure: {} } });
    await prisma.workoutCompletion.create({ data: { userId: realId, sessionId: realSession.id, status: 'done', distanceKm: 5 } });
    const snapshotReal = async () => JSON.stringify({
      user: await prisma.user.findUnique({ where: { id: realId } }),
      plans: await prisma.trainingPlan.findMany({ where: { userId: realId } }),
      sessions: await prisma.trainingSession.findMany({ where: { userId: realId } }),
      completions: await prisma.workoutCompletion.findMany({ where: { userId: realId } }),
    });
    const realBefore = await snapshotReal();

    await seedReviewAccount(prisma, active);
    const id = reviewUserId(active.email);
    // o revisor registra/edita feedback numa execucao existente e cria uma dor
    const reviewerCompletion = await prisma.workoutCompletion.findFirstOrThrow({ where: { userId: id, status: 'done' }, orderBy: { completedAt: 'desc' } });
    await prisma.workoutCompletion.update({ where: { id: reviewerCompletion.id }, data: { perceivedEffort: 9, satisfactionElaboracao: 'detestei' } });
    const completionsBefore = await prisma.workoutCompletion.count({ where: { userId: id } });
    const plansBefore = await prisma.trainingPlan.count({ where: { userId: id } });

    const nextWeek = new Date(Date.now() + 8 * 86_400_000);
    expect((await refreshReviewContent(prisma, nextWeek)).refreshed).toBeGreaterThanOrEqual(1);

    expect(await prisma.workoutCompletion.findUniqueOrThrow({ where: { id: reviewerCompletion.id } })).toMatchObject({ perceivedEffort: 9, satisfactionElaboracao: 'detestei' });
    expect(await prisma.workoutCompletion.count({ where: { userId: id } })).toBeGreaterThanOrEqual(completionsBefore); // nada foi apagado
    expect(await prisma.trainingPlan.count({ where: { userId: id } })).toBe(plansBefore + 1); // so' a semana nova
    const activePlans = await prisma.trainingPlan.findMany({ where: { userId: id, status: 'active' } });
    expect(activePlans).toHaveLength(1);
    expect(activePlans[0].startDate.getTime()).toBe(startOfWeek(nextWeek).getTime());

    await refreshReviewContent(prisma, nextWeek); // idempotente: segunda execucao nao cria nada
    expect(await prisma.trainingPlan.count({ where: { userId: id } })).toBe(plansBefore + 1);
    await seedReviewAccount(prisma, { ...active });
    expect(await snapshotReal()).toBe(realBefore); // conta real intacta apos seed + renovacoes
    await prisma.workoutCompletion.deleteMany({ where: { userId: realId } });
    await prisma.trainingSession.deleteMany({ where: { userId: realId } });
    await prisma.trainingPlan.deleteMany({ where: { userId: realId } });
    await prisma.user.deleteMany({ where: { id: realId } });
  });

  it('conta excluida pelo revisor (e-mail anonimizado) e recriada pelo seed com o mesmo id', async () => {
    await seedReviewAccount(prisma, active);
    const id = reviewUserId(active.email);
    await prisma.user.update({ where: { id }, data: { email: 'excluida-teste@deleted.invalid', accountStatus: 'deleted', subscriptionStatus: 'canceled' } });
    const again = await seedReviewAccount(prisma, active);
    expect(again.created).toBe(false);
    expect(await prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true, accountStatus: true, subscriptionStatus: true } })).toEqual({ email: active.email, accountStatus: 'active', subscriptionStatus: 'manual_active' });
  });

  it('recusa e-mail fora do padrao, senha curta e e-mail que pertence a outra conta (nada e alterado)', async () => {
    await expect(seedReviewAccount(prisma, { ...active, email: 'aluna.real@example.test' })).rejects.toThrow(/revisao-apple-/);
    await expect(seedReviewAccount(prisma, { ...active, password: 'curta' })).rejects.toThrow(/12 caracteres/);
    const foreign = 'revisao-apple-teste-alheia@example.test';
    await prisma.user.create({ data: { id: 'conta-real-qualquer', email: foreign, passwordHash: 'x', name: 'Conta real' } });
    await expect(seedReviewAccount(prisma, { ...active, email: foreign })).rejects.toThrow(/NAO e uma conta de revisao/);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: foreign } })).name).toBe('Conta real');
    await prisma.user.delete({ where: { id: 'conta-real-qualquer' } });
  });
});
