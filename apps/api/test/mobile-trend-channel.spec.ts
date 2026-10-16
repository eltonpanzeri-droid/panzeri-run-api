import { dayChannel, isWeekInProgress, threeWeekMean, trailingChannel } from '../../mobile/home/trendChannel';

// 15/10/2026: canal de tendencia dos graficos da aluna. Regra: media da janela ± 2 desvios, so com janela completa.
describe('trendChannel (graficos da aluna)', () => {
  it('trailingChannel exige 8 semanas validas e centra na media da janela', () => {
    const values = [30, 30, 30, 30, 30, 30, 30, 30, 30, 60];
    const channel = trailingChannel(values, 8);
    expect(channel.slice(0, 7).every((point) => point === null)).toBe(true);
    expect(channel[7]).toMatchObject({ mean: 30, lower: 30, upper: 30 });
    // ultima semana: janela = 7 x 30 + 60 -> media 33,75
    expect(channel[9]!.mean).toBeCloseTo((30 * 7 + 60) / 8, 5);
    expect(channel[9]!.upper).toBeGreaterThan(channel[9]!.mean);
    expect(channel[9]!.lower).toBeLessThanOrEqual(channel[9]!.mean);
  });

  it('trailingChannel nao inventa canal quando falta semana (null na janela)', () => {
    const values: Array<number | null> = [30, 30, null, 30, 30, 30, 30, 30, 30, 30, 30];
    const channel = trailingChannel(values, 8);
    expect(channel[7]).toBeNull(); // janela de 8 tem um buraco: so 7 valores
    expect(channel[8]).toBeNull(); // o buraco (indice 2) ainda esta na janela
    expect(channel[10]).not.toBeNull(); // janela 3..10: 8 valores validos
  });

  it('threeWeekMean = 21 dias exatos e fica nula sem 3 semanas validas', () => {
    expect(threeWeekMean([30, 30, 60, null, 30, 30, 30])).toEqual([null, null, 40, null, null, null, 30]);
  });

  it('dayChannel usa 21 dias e estende ate 8 registros; sem 8 registros nao ha canal', () => {
    const daily = Array.from({ length: 30 }, (_, i) => ({ x: 20000 + i, y: i % 2 ? 6 : 4 }));
    const channel = dayChannel(daily, { min: 1, max: 5 });
    expect(channel.length).toBe(23); // do 8o ponto em diante
    expect(channel[channel.length - 1].upper).toBeLessThanOrEqual(5);
    expect(dayChannel(daily.slice(0, 7))).toEqual([]);
    const weekly = Array.from({ length: 10 }, (_, i) => ({ x: 20000 + i * 7, y: 30 }));
    expect(dayChannel(weekly).length).toBe(3); // 8 semanas = 49 dias, dentro do limite de 120
  });

  it('isWeekInProgress marca so a semana que contem hoje', () => {
    expect(isWeekInProgress('2026-10-12', '2026-10-14')).toBe(true);
    expect(isWeekInProgress('2026-10-12', '2026-10-18')).toBe(true);
    expect(isWeekInProgress('2026-10-12', '2026-10-19')).toBe(false);
    expect(isWeekInProgress('2026-10-05', '2026-10-14')).toBe(false);
  });
});
