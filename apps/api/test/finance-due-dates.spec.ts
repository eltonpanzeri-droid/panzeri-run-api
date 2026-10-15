import { CoachService } from '../src/coach/coach.service';

// 15/10/2026: calendario de vencimentos (somente leitura). Garante populacao sem arquivadas, agrupamento
// por dia pelo ISO date do nextChargeAt (meio-dia UTC), limites de intervalo e dias de atraso.
describe('CoachService.financeDueDates', () => {
  const row = (name: string, nextChargeAt: string, status = 'active') => ({
    nextChargeAt: new Date(nextChargeAt),
    user: { id: `id-${name}`, name, studentCode: 12, subscriptionStatus: status },
  });

  function build(upcoming: unknown[], overdue: unknown[] = []) {
    const calls: Array<{ where: any }> = [];
    const prisma = {
      billingSubscription: {
        findMany: jest.fn().mockImplementation((args: { where: any }) => {
          calls.push(args);
          return Promise.resolve(args.where.user.subscriptionStatus === 'overdue' ? overdue : upcoming);
        }),
      },
    };
    const service = new CoachService(
      prisma as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never);
    return { service, calls };
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

  it('ignora datas invalidas e calcula dias de atraso', async () => {
    const { service } = build([], [row('Dani', '2000-01-01T12:00:00.000Z', 'overdue')]);
    const result = await service.financeDueDates({ from: 'lixo', to: '2026-13-99' });
    expect(result.from).toBe(result.today);
    expect(result.overdueNow[0].daysLate).toBeGreaterThan(9000);
    expect(result.overdueNow[0].studentCode).toBeTruthy();
  });
});
