import { LongitudinalDynamicsService } from '../src/training-intelligence/longitudinal-dynamics.service';
import { MathLayerService, SeriesPoint } from '../src/training-intelligence/math-layer.service';

// 04/10/2026 — BLOCO 2 (Excursao e Dinamica de Retorno). Estende LongitudinalDynamicsService (ja
// existente, nao recriado) com: trend ('approaching'/'departing'/'stable'/'insufficient_data'),
// returnStatus tri-estado ('complete'/'partial'/'absent'), currentMagnitude (distinto do pico),
// evidence estruturada, e historicalReturnBehavior() (recuperacao deterministica do comportamento
// historico de retorno, SEM score de resiliencia). Cobre os 15 casos obrigatorios do bloco.

function day(offset: number, base = '2026-09-01T00:00:00.000Z'): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

function series(values: number[]): SeriesPoint[] {
  return values.map((value, offset) => ({ value, timestamp: day(offset) }));
}

describe('LongitudinalDynamicsService — Bloco 2 (excursao e retorno)', () => {
  let dynamics: LongitudinalDynamicsService;

  beforeEach(() => {
    dynamics = new LongitudinalDynamicsService(new MathLayerService());
  });

  // Caso 1 — permanencia dentro do habitual
  it('1) permanencia dentro do habitual: nenhuma excursao detectada', () => {
    const s = series([10, 9, 10, 11, 10, 9]);
    const result = dynamics.excursions(s, { lower: 8, upper: 12 });
    expect(result).toHaveLength(0);
  });

  // Caso 2 — saida isolada
  it('2) saida isolada, com retorno imediato: returnStatus=complete', () => {
    const s = series([10, 10, 13, 10, 10]);
    const [exc] = dynamics.excursions(s, { lower: 8, upper: 12 });
    expect(exc.returnStatus).toBe('complete');
    expect(exc.returnDynamics?.returned).toBe(true);
  });

  // Caso 3 — excursao persistente
  it('3) excursao persistente (nunca retorna): ongoing=true, returnStatus != complete', () => {
    const s = series([10, 10, 13, 14, 15, 16]);
    const [exc] = dynamics.excursions(s, { lower: 8, upper: 12 });
    expect(exc.ongoing).toBe(true);
    expect(exc.returnStatus).not.toBe('complete');
  });

  // Caso 4 — aumento da magnitude da excursao
  it('4) magnitude crescendo monotonicamente: trend=departing, currentMagnitude=magnitude(pico)', () => {
    const s = series([10, 10, 13, 14, 16]); // cada ponto fora e mais extremo que o anterior
    const [exc] = dynamics.excursions(s, { lower: 8, upper: 12 });
    expect(exc.trend).toBe('departing');
    expect(exc.currentMagnitude).toBe(exc.magnitude); // ultima observacao E o pico
    expect(exc.returnStatus).toBe('absent');
  });

  // Caso 5 — aproximacao progressiva do habitual (ainda sem cruzar de volta)
  it('5) aproximacao progressiva: pico seguido de valores cada vez mais proximos do limite, ainda fora: trend=approaching, returnStatus=partial', () => {
    const s = series([10, 10, 16, 14, 13]); // 16=pico, depois 14, 13 -> aproximando do upper=12, mas 13 ainda fora
    const [exc] = dynamics.excursions(s, { lower: 8, upper: 12 });
    expect(exc.ongoing).toBe(true);
    expect(exc.trend).toBe('approaching');
    expect(exc.returnStatus).toBe('partial');
    expect(exc.currentMagnitude).toBeLessThan(exc.magnitude);
  });

  // Caso 6 — retorno completo
  it('6) retorno completo: a serie volta a entrar na faixa habitual', () => {
    const s = series([10, 10, 16, 14, 11]);
    const [exc] = dynamics.excursions(s, { lower: 8, upper: 12 });
    expect(exc.returnStatus).toBe('complete');
    expect(exc.returnDynamics?.returned).toBe(true);
    expect(exc.ongoing).toBe(false);
  });

  // Caso 7 — retorno parcial (distinto de completo E de ausente)
  it('7) retorno parcial: aproximando mas ainda fora e' + ' em curso — nao e complete nem absent-por-afastamento', () => {
    const s = series([10, 10, 16, 14, 13]);
    const [exc] = dynamics.excursions(s, { lower: 8, upper: 12 });
    expect(exc.returnStatus).toBe('partial');
    expect(exc.returnStatus).not.toBe('complete');
  });

  // Caso 8 — ausencia de retorno (persistente, sem aproximacao)
  it('8) ausencia de retorno: ongoing e trend nao e approaching -> returnStatus=absent', () => {
    const s = series([10, 10, 13, 13, 13]); // estavel no mesmo nivel fora da faixa, sem aproximar
    const [exc] = dynamics.excursions(s, { lower: 8, upper: 12 });
    expect(exc.ongoing).toBe(true);
    expect(exc.trend).not.toBe('approaching');
    expect(exc.returnStatus).toBe('absent');
  });

  // Caso 9 — observacoes temporalmente irregulares (durationDays usa tempo real, nao contagem)
  it('9) observacoes irregulares: trend/evidence continuam coerentes com o tempo real entre pontos', () => {
    const irregular: SeriesPoint[] = [
      { value: 10, timestamp: day(0) },
      { value: 16, timestamp: day(1) },
      { value: 13, timestamp: day(30) }, // 29 dias depois, ainda fora, mas mais proximo do limite
    ];
    const [exc] = dynamics.excursions(irregular, { lower: 8, upper: 12 });
    expect(exc.trend).toBe('approaching');
    expect(exc.durationDays).toBe(29);
    expect(exc.evidence.observationsConsidered).toBe(2);
  });

  // Caso 10 — dados ausentes (gap no tempo nao e interpolado; serie so' tem os pontos reais)
  it('10) dados ausentes: nenhum ponto e inventado para preencher o gap — excursion usa so as observacoes reais', () => {
    const withGap: SeriesPoint[] = [
      { value: 10, timestamp: day(0) },
      { value: 16, timestamp: day(5) }, // sem observacoes entre o dia 0 e o dia 5 — gap real, nao preenchido
      { value: 10, timestamp: day(6) },
    ];
    const [exc] = dynamics.excursions(withGap, { lower: 8, upper: 12 });
    expect(exc.observationCount).toBe(1); // so' o dia 5 esta fora — nenhum ponto fantasma no meio
    expect(exc.evidence.observationsConsidered).toBe(1);
  });

  // Caso 11 — historico insuficiente para padrao de retorno
  it('11) historico insuficiente (0 ou 1 retorno observado): medianas null, insufficientHistory=true', () => {
    const noHistory = dynamics.historicalReturnBehavior([]);
    expect(noHistory.insufficientHistory).toBe(true);
    expect(noHistory.medianTimeToReturnDays).toBeNull();
    expect(noHistory.medianObservationsToReturn).toBeNull();

    const s = series([10, 10, 16, 10, 10]); // 1 unica excursao com retorno
    const oneReturn = dynamics.excursions(s, { lower: 8, upper: 12 });
    const oneHistory = dynamics.historicalReturnBehavior(oneReturn);
    expect(oneHistory.excursionsWithObservedReturn).toBe(1);
    expect(oneHistory.insufficientHistory).toBe(true);
    expect(oneHistory.medianTimeToReturnDays).toBeNull();
  });

  // Caso 12 — atleta com alta variabilidade habitual (faixa larga: so excursoes alem dela contam)
  it('12) alta variabilidade habitual: faixa larga nao gera excursao para oscilacao normal dentro dela', () => {
    const s = series([5, 15, 6, 14, 7, 13]); // oscila bastante, mas tudo dentro de uma faixa habitual larga
    const result = dynamics.excursions(s, { lower: 2, upper: 18 });
    expect(result).toHaveLength(0);
  });

  // Caso 13 — variavel ordinal (escala 1-5): mesmo motor, sem presumir distancia uniforme
  it('13) variavel ordinal (1-5): excursion funciona com aritmetica de posicao, sem inventar unidade', () => {
    const s = series([3, 3, 5, 5, 3]); // escala Likert 1-5
    const bounds = dynamics.habitualRange(series([3, 3, 3, 3, 3, 3, 3]), { kind: 'observation_count', size: 7 });
    const result = dynamics.excursions(s, { lower: bounds.lower, upper: bounds.upper });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].evidence.method).toMatch(/distancia/);
  });

  // Caso 14 — variavel continua (km, pace etc.) — mesmo motor
  it('14) variavel continua: funciona identicamente para valores nao inteiros', () => {
    const s = series([5.2, 5.4, 8.9, 5.1]);
    const [exc] = dynamics.excursions(s, { lower: 4.5, upper: 6 });
    expect(exc.peak.value).toBe(8.9);
    expect(exc.returnStatus).toBe('complete');
  });

  // Caso 15 — nova observacao atualiza o episodio em curso SEM modificar o historico original
  it('15) nova observacao atualiza o episodio em curso sem alterar excursoes historicas ja concluidas', () => {
    const before = series([10, 10, 16, 10, 10, 13]); // 1a excursao concluida (retornou), 2a em curso
    const resultBefore = dynamics.excursions(before, { lower: 8, upper: 12 });
    expect(resultBefore).toHaveLength(2);
    const firstBefore = resultBefore[0];
    expect(firstBefore.returnStatus).toBe('complete');

    const after = series([10, 10, 16, 10, 10, 13, 11]); // nova observacao: 2a excursao agora retornou
    const resultAfter = dynamics.excursions(after, { lower: 8, upper: 12 });
    expect(resultAfter).toHaveLength(2);
    const firstAfter = resultAfter[0];
    // Episodio historico (primeira excursao) e byte-a-byte o mesmo, imutavel perante a nova observacao.
    expect(firstAfter).toEqual(firstBefore);
    expect(resultAfter[1].returnStatus).toBe('complete'); // so' o episodio em curso mudou
  });

  describe('fronteiras adicionais encontradas na implementacao', () => {
    it('overshoot (vira direto pro lado oposto sem passar pela faixa habitual): returnStatus=absent, nao complete', () => {
      const s = series([10, 13, 7, 10]); // sobe, depois cai direto pro lado oposto sem passar por 'inside'
      const result = dynamics.excursions(s, { lower: 8.5, upper: 11.5 });
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0].returnDynamics?.returned).toBe(false);
      expect(result[0].returnDynamics?.overshoot?.occurred).toBe(true);
      expect(result[0].returnStatus).toBe('absent');
    });

    it('excursao com uma unica observacao: trend=insufficient_data (nao inventa direcao com 1 ponto)', () => {
      const s = series([10, 10, 16, 10, 10]);
      const [exc] = dynamics.excursions(s, { lower: 8, upper: 12 });
      expect(exc.observationCount).toBe(1);
      expect(exc.trend).toBe('insufficient_data');
    });

    it('historicalReturnBehavior com 2+ retornos: medianas calculadas e reconstruiveis a partir dos valores brutos', () => {
      const s = series([10, 16, 10, 10, 10, 15, 10, 10]); // 2 excursoes, ambas retornando em 1 dia / 1 observacao
      const excursions = dynamics.excursions(s, { lower: 8, upper: 12 });
      const history = dynamics.historicalReturnBehavior(excursions);
      expect(history.excursionsWithObservedReturn).toBe(2);
      expect(history.insufficientHistory).toBe(false);
      expect(history.medianTimeToReturnDays).toBe(1);
      expect(history.medianObservationsToReturn).toBe(1);
      expect(history.timeToReturnDaysValues).toHaveLength(2); // valores brutos preservados, nao reduzidos a um score
    });

    it('historicalReturnBehavior nunca produz um campo de "score" — apenas contagens/medianas/listas declaradas', () => {
      const s = series([10, 16, 10]);
      const history = dynamics.historicalReturnBehavior(dynamics.excursions(s, { lower: 8, upper: 12 }));
      expect(Object.keys(history).sort()).toEqual([
        'excursionsWithObservedReturn',
        'excursionsWithoutObservedReturn',
        'insufficientHistory',
        'medianObservationsToReturn',
        'medianTimeToReturnDays',
        'observationsToReturnValues',
        'timeToReturnDaysValues',
        'totalExcursions',
      ].sort());
    });
  });
});
