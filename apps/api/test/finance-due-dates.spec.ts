import { CoachService } from '../src/coach/coach.service';

// 15/10/2026: calendario de vencimentos (somente leitura). Garante populacao sem arquivadas, agrupamento
// por dia pelo ISO date do nextChargeAt (meio-dia UTC), limites de intervalo e dias de atraso.
// Correcao: "dias de atraso" vem do registro de mudanca para "overdue" (BillingEvent), nunca de nextChargeAt
// (para quem esta em atraso o Asaas ja avancou nextChargeAt para o proximo vencimento).
describe('CoachService.financeDueDates', () => {
  const row = (name: string, nextChargeAt: string, status = 'active', id = `id-${name}`) => ({
    nextChargeAt: new Date(nextChargeAt),
    user: { id, name, studentCode: 12, subscriptionStatus: status },
  });
  const daysAgo = (days: number) => new Date(Date.now() - days * 86400000);

  function build(upcoming: unknown[], overdue: unknown[] = [], events: unknown[] = []) {
    const calls: Array<{ where: any }> = [];
    const eventCalls: any[] = [];
    const prisma = {
      billingSubscription: {
        findMany: jest.fn().mockImplementation((args: { where: any }) => {
          calls.push(args);
          return Promise.resolve(args.where.user.subscriptionStatus === 'overdue' ? overdue : upcoming);
        }),
      },
      billingEvent: { findMany: jest.fn().mockImplementation((args: any) => { eventCalls.push(args); return Promise.resolve(events); }) },
    };
    const service = new CoachService(
      prisma as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never);
    return { service, calls, eventCalls };
  }

  it('agrupa por dia, conta e usa o valor de tabela', async () => {
    const { service } = build([
      row('Ana', '2026-10-20T12:00:00.000Z'),
      row('Bia', '2026-10-20T12:00:00.000Z'),
      row('Cris', '2026-10-22T12:00:00.000Z'),
    ]);
    const result = await service.financeDueDates({ from: '2026-10-15', to: '2026-10-30' });
    expect(result.days.map((d) => [d.date, d.count, d.expectedCents])).toEqual([
      ['2026-10-20', 2, 3980],
      ['2026-10-22', 1, 1990],
    ]);
    expect(result.totals).toEqual({ count: 3, expectedCents: 5970 });
  });

  it('exclui arquivadas e so considera Asaas, pagantes e atrasadas', async () => {
    const { service, calls } = build([]);
    await service.financeDueDates({ from: '2026-10-15', to: '2026-10-30' });
    for (const call of calls) {
      expect(call.where.provider).toBe('asaas');
      expect(call.where.user.accountStatus).toEqual({ not: 'archived' });
      expect(call.where.user.role).toBe('student');
    }
    expect(calls[0].where.user.subscriptionStatus).toEqual({ in: ['active', 'grace', 'overdue'] });
  });

  it('limita o intervalo a 120 dias e corrige "to" menor que "from"', async () => {
    const { service } = build([]);
    const longo = await service.financeDueDates({ from: '2026-01-01', to: '2027-12-31' });
    expect(longo.to).toBe('2026-05-01');
    const invertido = await service.financeDueDates({ from: '2026-10-20', to: '2026-10-01' });
    expect(invertido.to).toBe('2026-10-20');
  });

  it('ignora datas invalidas', async () => {
    const { service } = build([]);
    const result = await service.financeDueDates({ from: 'lixo', to: '2026-13-99' });
    expect(result.from).toBe(result.today);
  });

  it('dias de atraso vem do registro de mudanca para atrasado, nao de nextChargeAt', async () => {
    // nextChargeAt no FUTURO (Asaas ja avancou o vencimento): o calculo antigo dava sempre 0 dia.
    const futuro = new Date(Date.now() + 20 * 86400000).toISOString();
    const { service, eventCalls } = build([], [
      row('Dani', futuro, 'overdue', 'u-dani'),
      row('Eva', futuro, 'overdue', 'u-eva'),
      row('Fabi', futuro, 'overdue', 'u-fabi'),
    ], [
      { userId: 'u-dani', event: 'status_change', timestamp: daysAgo(12) },
      { userId: 'u-dani', event: 'baseline_snapshot', timestamp: daysAgo(30) },
      { userId: 'u-eva', event: 'baseline_snapshot', timestamp: daysAgo(30) },
    ]);
    const result = await service.financeDueDates({});
    const byName = Object.fromEntries(result.overdueNow.map((o) => [o.name, o]));
    expect(byName.Dani.precision).toBe('exata');
    expect(byName.Dani.daysLate).toBeGreaterThanOrEqual(11);
    expect(byName.Dani.daysLate).toBeLessThanOrEqual(13);
    expect(byName.Eva).toMatchObject({ precision: 'antes_do_registro', daysLate: null, overdueSince: null });
    expect(byName.Fabi).toMatchObject({ precision: 'sem_registro', daysLate: null });
    expect(eventCalls[0].where.nextStatus).toBe('overdue');
    expect(eventCalls[0].where.userId).toEqual({ in: ['u-dani', 'u-eva', 'u-fabi'] });
  });
});
