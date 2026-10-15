import { CoachService } from '../src/coach/coach.service';

// 15/10/2026: series diarias de prospectos (somente leitura). Garante populacao sem arquivadas, dias do calendario
// de Sao Paulo, sessoes que cadastraram nao contam como "so acessaram" e limite de dias.
describe('CoachService.prospectsSeries', () => {
  const spDay = (offset: number) => {
    const date = new Date(Date.now() - offset * 86400000);
    return date.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  };
  const noon = (offset: number) => new Date(`${spDay(offset)}T15:00:00.000Z`); // 12h em Sao Paulo

  function build() {
    const calls: Record<string, any> = {};
    const prisma = {
      user: { findMany: jest.fn().mockImplementation((args: any) => { calls.users = args; return Promise.resolve([{ createdAt: noon(0) }, { createdAt: noon(0) }, { createdAt: noon(2) }]); }) },
      onboardingInterview: { findMany: jest.fn().mockImplementation((args: any) => { calls.interviews = args; return Promise.resolve([{ quickIntakeCompletedAt: noon(1) }]); }) },
      billingSubscription: { findMany: jest.fn().mockImplementation((args: any) => { calls.checkouts = args; return Promise.resolve([{ createdAt: noon(1) }]); }) },
      funnelEvent: {
        groupBy: jest.fn().mockResolvedValue([
          { sessionId: 's1', event: 'app_opened', _min: { createdAt: noon(0) } },
          { sessionId: 's2', event: 'app_opened', _min: { createdAt: noon(0) } },
          { sessionId: 's2', event: 'signup_completed', _min: { createdAt: noon(0) } },
          { sessionId: 's3', event: 'app_opened', _min: { createdAt: noon(3) } },
        ]),
      },
    };
    const service = new CoachService(
      prisma as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never);
    return { service, calls };
  }

  it('conta por dia, sem as sessoes que cadastraram', async () => {
    const { service } = build();
    const result = await service.prospectsSeries({ days: 10 });
    const last = result.dates.length - 1;
    expect(result.dates).toHaveLength(10);
    expect(result.dates[last]).toBe(spDay(0));
    expect(result.series.signups[last]).toBe(2);
    expect(result.series.signups[last - 2]).toBe(1);
    expect(result.series.interview[last - 1]).toBe(1);
    expect(result.series.checkout[last - 1]).toBe(1);
    expect(result.series.accessed[last]).toBe(1); // s1 acessou e nao cadastrou; s2 cadastrou
    expect(result.series.accessed[last - 3]).toBe(1);
    expect(result.totals).toEqual({ accessed: 2, signups: 3, interview: 1, checkout: 1 });
  });

  it('exclui arquivadas e so considera cobranca de quem segue pendente e nunca pagou', async () => {
    const { service, calls } = build();
    await service.prospectsSeries({});
    expect(calls.users.where.accountStatus).toEqual({ not: 'archived' });
    expect(calls.interviews.where.user.accountStatus).toEqual({ not: 'archived' });
    expect(calls.checkouts.where.firstPaidAt).toBeNull();
    expect(calls.checkouts.where.user.subscriptionStatus).toBe('pending');
    expect(calls.checkouts.where.checkoutUrl).toEqual({ not: null });
  });

  it('limita o numero de dias entre 7 e 365', async () => {
    const { service } = build();
    expect((await service.prospectsSeries({ days: 1 })).dates).toHaveLength(7);
    expect((await service.prospectsSeries({ days: 9999 })).dates).toHaveLength(365);
    expect((await service.prospectsSeries({})).dates).toHaveLength(90);
  });
});
