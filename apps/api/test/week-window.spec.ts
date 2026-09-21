import { planStartsInFuture, saoPauloDateString, saoPauloTomorrowString } from '../../mobile/src/weekWindow';

// Regressao (20/09/2026): de domingo 21:00 a 23:59 (BRT) o app escondia o plano recem-gerado da semana
// seguinte e mostrava "Sua semana esta liberada" (planStartsInFuture misturava data local com UTC).

// Instante em que Sao Paulo (UTC-3, sem horario de verao) marca o dia/hora dados.
const brt = (isoLocal: string) => new Date(`${isoLocal}-03:00`);

const NEW_PLAN = { startDate: '2026-09-21T00:00:00.000Z' };  // gerado no domingo 20/09 para 21-27/09
const OLD_PLAN = { startDate: '2026-09-14T00:00:00.000Z' };  // semana que esta terminando (cobre o domingo 20/09)

describe('planStartsInFuture — domingo (20/09/2026), horario de Sao Paulo', () => {
  const sundayTimes = ['12:00', '15:30', '20:59', '21:00', '21:31', '22:45', '23:59'];

  it.each(sundayTimes)('plano NOVO (21/09) e reconhecido como futuro as %s de domingo', (hhmm) => {
    expect(planStartsInFuture(NEW_PLAN, brt(`2026-09-20T${hhmm}:00`))).toBe(true);
  });

  it.each(sundayTimes)('plano ANTIGO (14/09) continua sendo escondido as %s de domingo', (hhmm) => {
    expect(planStartsInFuture(OLD_PLAN, brt(`2026-09-20T${hhmm}:00`))).toBe(false);
  });

  it('a hora exata do print (21:31) — o caso que falhava', () => {
    expect(planStartsInFuture(NEW_PLAN, brt('2026-09-20T21:31:00'))).toBe(true);
  });

  it('sem plano / sem startDate nunca conta como futuro', () => {
    expect(planStartsInFuture(null, brt('2026-09-20T21:31:00'))).toBe(false);
    expect(planStartsInFuture({}, brt('2026-09-20T21:31:00'))).toBe(false);
  });

  it('plano que comeca hoje (nao amanha) nao e "futuro"', () => {
    expect(planStartsInFuture({ startDate: '2026-09-20T00:00:00.000Z' }, brt('2026-09-20T21:31:00'))).toBe(false);
  });

  it('virada de mes/ano: amanha e calculado no calendario de Sao Paulo', () => {
    expect(saoPauloTomorrowString(brt('2026-09-30T22:00:00'))).toBe('2026-10-01');
    expect(saoPauloTomorrowString(brt('2026-12-31T21:30:00'))).toBe('2027-01-01');
    expect(saoPauloDateString(brt('2026-09-20T21:31:00'))).toBe('2026-09-20');   // UTC ja seria 21/09
  });
});
