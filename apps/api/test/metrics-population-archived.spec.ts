import { CoachService } from '../src/coach/coach.service';

// 15/10/2026: Financeiro e resumo de negocio contavam contas arquivadas; a Visao geral nao. O mesmo grupo
// de pagamento aparecia com numeros diferentes em telas diferentes (cortesia 9 x 10, atrasadas 10 x 12,
// prospectos 24 x 26). Este teste garante que as duas contas usam a mesma populacao (sem arquivadas).
describe('CoachService — finance() e dataBusinessSummary() excluem contas arquivadas', () => {
  function build() {
    const groupByCalls: Array<{ where: unknown }> = [];
    const prisma = {
      user: {
        groupBy: jest.fn().mockImplementation((args: { where: unknown }) => {
          groupByCalls.push(args);
          return Promise.resolve([{ subscriptionStatus: 'active', _count: 3 }]);
        }),
      },
      billingSubscription: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      coupon: { findMany: jest.fn().mockResolvedValue([]) },
      billingEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CoachService(
      prisma as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never);
    return { service, groupByCalls };
  }

  const EXPECTED = { role: 'student', accountStatus: { not: 'archived' } };

  it('finance() conta so alunas nao arquivadas', async () => {
    const { service, groupByCalls } = build();
    const result = await service.finance();
    expect(groupByCalls).toHaveLength(1);
    expect(groupByCalls[0].where).toEqual(EXPECTED);
    expect(result.payingPlans).toBe(3);
  });

  it('dataBusinessSummary() conta so alunas nao arquivadas', async () => {
    const { service, groupByCalls } = build();
    const result = await service.dataBusinessSummary();
    expect(groupByCalls).toHaveLength(1);
    expect(groupByCalls[0].where).toEqual(EXPECTED);
    expect(result.subscribers.paying).toBe(3);
  });
});
