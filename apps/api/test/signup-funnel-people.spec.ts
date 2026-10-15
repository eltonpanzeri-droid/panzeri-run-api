import { CoachService } from '../src/coach/coach.service';

// 15/10/2026: funil de PESSOAS lido do banco (substitui, no painel, a contagem por sessoes de evento).
// Garante: populacao sem arquivadas, cada pessoa na etapa mais avancada, funil monotonico, cortesia fora do funil.
describe('CoachService.signupFunnelPeople', () => {
  const user = (id: string, o: { status?: string; quick?: boolean; completed?: boolean; checkout?: boolean; firstPaidAt?: boolean } = {}) => ({
    id, name: `Aluna ${id}`, studentCode: 10, createdAt: new Date(Date.now() - 3 * 86400000),
    subscriptionStatus: o.status ?? 'pending',
    onboardingInterview: o.quick || o.completed ? { quickIntakeCompletedAt: o.quick ? new Date() : null, completedAt: o.completed ? new Date() : null } : null,
    billingSubscription: o.checkout || o.firstPaidAt ? { checkoutUrl: o.checkout ? 'https://x' : null, firstPaidAt: o.firstPaidAt ? new Date() : null } : null,
  });

  function build(users: unknown[]) {
    const calls: Array<{ where: any }> = [];
    const prisma = { user: { findMany: jest.fn().mockImplementation((args: { where: any }) => { calls.push(args); return Promise.resolve(users); }) } };
    const service = new CoachService(
      prisma as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never);
    return { service, calls };
  }

  it('conta cada pessoa na etapa mais avancada e o funil nunca cresce', async () => {
    const { service } = build([
      user('a'),                                                   // so criou conta
      user('b', { quick: true }),                                  // entrevista
      user('c', { quick: true, checkout: true }),                  // cobranca
      user('d', { status: 'active', firstPaidAt: true }),          // pagou (data de primeiro pagamento)
      user('e', { status: 'active' }),                             // pagou (conta antiga, sem firstPaidAt, sem entrevista registrada)
    ]);
    const result = await service.signupFunnelPeople({ days: 30 });
    expect(result.stages.map((s) => [s.key, s.count])).toEqual([['signup', 5], ['interview', 4], ['checkout', 3], ['paid', 2]]);
    expect(result.stoppedAt.signup.map((p) => p.name)).toEqual(['Aluna a']);
    expect(result.stoppedAt.paid.map((p) => p.name).sort()).toEqual(['Aluna d', 'Aluna e']);
    expect(result.stages[3].percentOfSignups).toBe(40);
  });

  it('cortesia fica fora do funil e nunca conta como pagou', async () => {
    const { service } = build([user('a', { status: 'manual_active' }), user('b')]);
    const result = await service.signupFunnelPeople({});
    expect(result.courtesy).toBe(1);
    expect(result.stages[0].count).toBe(1);
    expect(result.stages[3].count).toBe(0);
  });

  it('exclui arquivadas e filtra pelo periodo', async () => {
    const { service, calls } = build([]);
    await service.signupFunnelPeople({ days: 7 });
    expect(calls[0].where.role).toBe('student');
    expect(calls[0].where.accountStatus).toEqual({ not: 'archived' });
    expect(calls[0].where.createdAt.gte).toBeInstanceOf(Date);
    await service.signupFunnelPeople({});
    expect(calls[1].where.createdAt).toBeUndefined();
  });
});
