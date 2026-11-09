import { CoachService } from '../src/coach/coach.service';

// Caso Renatha (09/11/2026, regra de Elton "nada oculto"): sem studentCode + assinatura removida ('canceled') nao pode sumir de TODAS as listas.
describe('prospects(): quem nunca foi aluna e foi cancelada nao some', () => {
  it('a consulta inclui pending E canceled sem studentCode', async () => {
    const findMany = jest.fn(async () => []);
    const service = Object.create(CoachService.prototype) as any;
    service.prisma = { user: { findMany } };
    await service.prospects();
    const where = (findMany.mock.calls[0] as any[])[0].where;
    expect(where.OR).toEqual([{ subscriptionStatus: 'pending' }, { subscriptionStatus: 'canceled', studentCode: null }]);
    expect(where.isTestAccount).toBe(false);
    expect(where.accountStatus).toEqual({ not: 'archived' });
  });
});
