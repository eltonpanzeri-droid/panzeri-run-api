import {
  mondayOf,
  buildCompleteWeekList,
  isWeekClosed,
  isMonthClosed,
  firstTimeStreakReached,
  firstTimeValueReached,
  firstTimeCumulativeReached,
  detectGapEpisodes,
  consecutiveWeeksFromReturn,
  isoDate,
} from '../src/medals/medal-evaluation.helpers';

function d(iso: string): Date {
  return new Date(iso + 'T00:00:00.000Z');
}

describe('mondayOf / buildCompleteWeekList', () => {
  it('domingo pertence à semana que termina nele (mesma convenção do resto do projeto)', () => {
    expect(isoDate(mondayOf(d('2026-08-09')))).toBe('2026-08-03'); // domingo -> segunda anterior
  });

  it('lista completa de semanas nunca pula uma, mesmo sem nenhuma sessão naquela semana', () => {
    const weeks = buildCompleteWeekList(d('2026-08-03'), d('2026-08-24'));
    expect(weeks.map(isoDate)).toEqual(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']);
  });
});

describe('isWeekClosed / isMonthClosed', () => {
  it('semana fecha exatamente 7 dias após o início, nunca antes', () => {
    const weekStart = d('2026-08-03');
    expect(isWeekClosed(weekStart, d('2026-08-09'))).toBe(false); // 6 dias depois, ainda aberta
    expect(isWeekClosed(weekStart, d('2026-08-10'))).toBe(true); // exatamente 7 dias
  });

  it('mês fecha só quando hoje já está em mês estritamente posterior', () => {
    expect(isMonthClosed('2026-08', d('2026-08-31'))).toBe(false);
    expect(isMonthClosed('2026-08', d('2026-09-01'))).toBe(true);
  });
});

describe('firstTimeStreakReached — família constância/sustentação de volume/aderência', () => {
  it('encontra a primeira semana em que cada limiar de sequência consecutiva foi atingido', () => {
    const weeks = buildCompleteWeekList(d('2026-08-03'), d('2026-09-28')).map(isoDate);
    // presente em todas as 8 semanas, sem lacuna
    const present = new Set(weeks);
    const result = firstTimeStreakReached(weeks, present, [2, 4, 8]);
    expect(result.get(2)).toBe(weeks[1]);
    expect(result.get(4)).toBe(weeks[3]);
    expect(result.get(8)).toBe(weeks[7]);
  });

  it('uma lacuna reseta a sequência — streak nunca atravessa uma semana ausente', () => {
    const weeks = buildCompleteWeekList(d('2026-08-03'), d('2026-09-28')).map(isoDate); // 9 semanas
    const present = new Set(weeks.filter((_, i) => i !== 3)); // falha na 4a semana (índice 3)
    const result = firstTimeStreakReached(weeks, present, [4]);
    // sequência de 4 só reaparece contando as semanas 5,6,7,8 (índices 4-7)
    expect(result.get(4)).toBe(weeks[7]);
  });

  it('nunca conquista um limiar maior que o histórico permite', () => {
    const weeks = buildCompleteWeekList(d('2026-08-03'), d('2026-08-17')).map(isoDate); // 3 semanas
    const present = new Set(weeks);
    const result = firstTimeStreakReached(weeks, present, [4]);
    expect(result.has(4)).toBe(false);
  });
});

describe('firstTimeValueReached — família volume semanal/mensal', () => {
  it('acha o primeiro ponto cronológico que cruzou cada limiar, mesmo que pontos depois caiam', () => {
    const points = [
      { date: d('2026-08-03'), value: 15 },
      { date: d('2026-08-10'), value: 32 }, // primeira vez >=30 e >=20
      { date: d('2026-08-17'), value: 10 }, // caiu, mas a conquista já aconteceu
      { date: d('2026-08-24'), value: 45 }, // primeira vez >=40
    ];
    const result = firstTimeValueReached(points, [20, 30, 40]);
    expect(result.get(20)?.date).toEqual(d('2026-08-10'));
    expect(result.get(30)?.date).toEqual(d('2026-08-10'));
    expect(result.get(40)?.date).toEqual(d('2026-08-24'));
  });

  it('limiar nunca atingido simplesmente não aparece no resultado (nunca inventa)', () => {
    const result = firstTimeValueReached([{ date: d('2026-08-03'), value: 5 }], [100]);
    expect(result.has(100)).toBe(false);
  });
});

describe('firstTimeCumulativeReached — família quilometragem acumulada', () => {
  it('soma progressivamente e marca a primeira data em que cada limiar acumulado foi cruzado', () => {
    const points = [
      { date: d('2026-08-03'), value: 40 },
      { date: d('2026-08-10'), value: 40 }, // acumulado 80
      { date: d('2026-08-17'), value: 40 }, // acumulado 120 -> cruza 100
    ];
    const result = firstTimeCumulativeReached(points, [100, 250]);
    expect(result.get(100)?.at.date).toEqual(d('2026-08-17'));
    expect(result.get(100)?.cumulative).toBe(120);
    expect(result.has(250)).toBe(false);
  });
});

describe('detectGapEpisodes — família retomada', () => {
  it('detecta um episódio quando o intervalo entre duas sessões é >= 14 dias', () => {
    const dates = [d('2026-08-01'), d('2026-08-03'), d('2026-08-25')]; // 22 dias de lacuna
    const episodes = detectGapEpisodes(dates, 14);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].returnDate).toEqual(d('2026-08-25'));
    expect(episodes[0].gapDays).toBe(22);
  });

  it('intervalo menor que o limiar nunca vira episódio', () => {
    const dates = [d('2026-08-01'), d('2026-08-10')]; // 9 dias
    expect(detectGapEpisodes(dates, 14)).toHaveLength(0);
  });

  it('múltiplos episódios na mesma linha do tempo são todos detectados', () => {
    const dates = [d('2026-01-01'), d('2026-02-01'), d('2026-02-03'), d('2026-04-01')];
    const episodes = detectGapEpisodes(dates, 14);
    expect(episodes).toHaveLength(2);
  });
});

describe('consecutiveWeeksFromReturn — família retomada', () => {
  it('conta semanas consecutivas presentes a partir da semana de retorno, nunca mais que o teto', () => {
    const weeks = buildCompleteWeekList(d('2026-08-03'), d('2026-09-28')).map(isoDate);
    const present = new Set(weeks); // presente em tudo
    expect(consecutiveWeeksFromReturn(weeks[2], weeks, present, 4)).toBe(4); // teto de 4
  });

  it('quebra a contagem na primeira semana ausente depois do retorno', () => {
    const weeks = buildCompleteWeekList(d('2026-08-03'), d('2026-09-28')).map(isoDate);
    const present = new Set([weeks[2], weeks[3]]); // só 2 semanas presentes a partir do retorno
    expect(consecutiveWeeksFromReturn(weeks[2], weeks, present, 4)).toBe(2);
  });

  it('semana de retorno fora da lista conhecida retorna 0, nunca erro', () => {
    const weeks = buildCompleteWeekList(d('2026-08-03'), d('2026-08-17')).map(isoDate);
    expect(consecutiveWeeksFromReturn('2099-01-01', weeks, new Set(weeks), 4)).toBe(0);
  });
});
