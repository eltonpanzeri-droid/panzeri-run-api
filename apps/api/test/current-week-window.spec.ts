import { currentWeekWindow, TrainingPlansService } from '../src/training-plans/training-plans.service';

// 01/11/2026 — regra aprovada por Elton: de domingo 12h (Brasilia) em diante a "semana atual" da tela principal e' a SEMANA SEGUINTE (gerada, ou "nao gerada" -> botao);
// a semana que acabou fica em "Anterior". Caso real: domingo 21h08, o app nativo ficou sem botao e "Proxima" pulava para 09/11 (dossie 0013).
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const FAKE_ONLY_DATE = ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask'] as const;

describe('currentWeekWindow (funcao pura, sempre no horario de Brasilia)', () => {
  const cases: Array<[string, string, boolean, string[], string]> = [
    // instante UTC,                 descricao,                     rolou?, semanas buscadas,          semana mostrada
    ['2026-10-26T12:00:00.000Z', 'segunda 09h',                    false, ['2026-10-26', '2026-11-02'], '2026-10-26'],
    ['2026-10-31T15:00:00.000Z', 'sabado 12h',                     false, ['2026-10-26', '2026-11-02'], '2026-10-26'],
    ['2026-11-01T14:59:00.000Z', 'domingo 11h59 (ainda nao rola)', false, ['2026-10-26', '2026-11-02'], '2026-10-26'],
    ['2026-11-01T15:00:00.000Z', 'domingo 12h00 (rola)',           true,  ['2026-11-02'],               '2026-11-02'],
    ['2026-11-02T00:08:00.000Z', 'domingo 21h08 (o caso)',         true,  ['2026-11-02'],               '2026-11-02'],
    ['2026-11-02T02:59:00.000Z', 'domingo 23h59',                  true,  ['2026-11-02'],               '2026-11-02'],
    ['2026-11-02T03:00:00.000Z', 'segunda 00h00 (virou a semana)', false, ['2026-11-02', '2026-11-09'], '2026-11-02'],
    ['2026-11-08T14:59:00.000Z', 'domingo 08/11 11h59',            false, ['2026-11-02', '2026-11-09'], '2026-11-02'],
    ['2026-11-08T15:00:00.000Z', 'domingo 08/11 12h00 (rola)',     true,  ['2026-11-09'],               '2026-11-09'],
  ];

  it.each(cases)('%s (%s)', (instant, _label, rolled, searched, shown) => {
    const window = currentWeekWindow(new Date(instant));
    expect(window.rolledPastRelease).toBe(rolled);
    expect(window.searchStarts).toEqual(searched.map(day));
    expect(window.shownStart).toEqual(day(shown));
  });

  it('o resultado nao depende do fuso da maquina (sempre Brasilia)', () => {
    const original = process.env.TZ;
    try {
      const expected = currentWeekWindow(new Date('2026-11-02T00:08:00.000Z'));
      for (const zone of ['Pacific/Auckland', 'America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
        process.env.TZ = zone;
        expect(currentWeekWindow(new Date('2026-11-02T00:08:00.000Z'))).toEqual(expected);
      }
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });
});

describe('TrainingPlansService.current() — rolagem de domingo', () => {
  afterEach(() => jest.useRealTimers());

  function build() {
    const activeLookups: Array<Record<string, any>> = [];
    const prisma = {
      trainingPlan: {
        findFirst: jest.fn(async ({ where }: { where: Record<string, any> }) => {
          if (where.status === 'active') { activeLookups.push(where); return null; }
          // so' a consulta "ja teve algum programa?" (apenas userId) acha um plano; as buscas por semana nao acham (semana nao gerada)
          return Object.keys(where).length === 1 ? { id: 'plano-antigo' } : null;
        }),
      },
      fitnessTest: { findFirst: jest.fn(async () => null) },
      user: { findUniqueOrThrow: jest.fn(async () => ({ subscriptionStatus: 'active' })) },
      onboardingInterview: { findUnique: jest.fn(async () => ({ completedAt: new Date('2026-08-01T00:00:00.000Z') })) },
    };
    const noop = {} as never;
    const service = new TrainingPlansService(prisma as never, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop);
    return { service, activeLookups };
  }

  const at = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: [...FAKE_ONLY_DATE] });

  it('domingo 21h08 sem treino gerado para a semana seguinte: devolve "nao gerada" de 02/11 a 08/11 (nunca o treino velho de 26/10)', async () => {
    at('2026-11-02T00:08:00.000Z');
    const { service, activeLookups } = build();
    const result = await service.current('u1') as Record<string, any>;
    expect(activeLookups[0].startDate).toEqual({ in: [day('2026-11-02')] });
    expect(result).toMatchObject({ notGenerated: true, hasEverHadPlan: true, hasSubscriptionAccess: true });
    expect(result.startDate).toEqual(day('2026-11-02'));
    expect(result.endDate).toEqual(day('2026-11-08'));
  });

  it('domingo 11h59: ainda busca a semana do calendario (26/10) e a seguinte, e a semana mostrada e 26/10', async () => {
    at('2026-11-01T14:59:00.000Z');
    const { service, activeLookups } = build();
    const result = await service.current('u1') as Record<string, any>;
    expect(activeLookups[0].startDate).toEqual({ in: [day('2026-10-26'), day('2026-11-02')] });
    expect(result.startDate).toEqual(day('2026-10-26'));
  });

  it('segunda 00h01 (02/11): a semana do calendario vira 02/11', async () => {
    at('2026-11-02T03:01:00.000Z');
    const { service, activeLookups } = build();
    const result = await service.current('u1') as Record<string, any>;
    expect(activeLookups[0].startDate).toEqual({ in: [day('2026-11-02'), day('2026-11-09')] });
    expect(result.startDate).toEqual(day('2026-11-02'));
  });

  it('o deslocamento 0 e os demais ficam na mesma numeracao depois do corte (0 = 02/11, Anterior = 26/10, +1 = 09/11)', async () => {
    at('2026-11-02T00:08:00.000Z');
    const { service } = build();
    const zero = await service.getWeekByOffset('u1', 0) as Record<string, any>;
    const previous = await service.getWeekByOffset('u1', -1) as Record<string, any>;
    const next = await service.getWeekByOffset('u1', 1) as Record<string, any>;
    expect(zero.startDate).toEqual(day('2026-11-02'));
    expect(previous.startDate).toEqual(day('2026-10-26'));
    expect(next.startDate).toEqual(day('2026-11-09'));
  });
});
