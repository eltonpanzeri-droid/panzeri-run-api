import { MathLayerService, SeriesPoint } from '../src/training-intelligence/math-layer.service';

// 24/09/2026 — fundacao da Camada Matematica Longitudinal (auditoria aprovada). Cobre os casos
// exigidos explicitamente: serie vazia, uma unica observacao, serie curta, janela parcialmente
// preenchida, observacoes irregulares no tempo, serie crescente/decrescente/estavel, e valor zero
// valido (nunca tratado como ausencia dentro do MathLayer — ausencia e' so a AUSENCIA do ponto).

function day(offset: number, base = '2026-09-01T00:00:00.000Z'): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

function series(pairs: [number, number][]): SeriesPoint[] {
  return pairs.map(([offset, value]) => ({ value, timestamp: day(offset) }));
}

describe('MathLayerService', () => {
  let math: MathLayerService;

  beforeEach(() => {
    math = new MathLayerService();
  });

  describe('periodMean', () => {
    it('retorna null/n=0 para serie vazia', () => {
      expect(math.periodMean([])).toEqual({ value: null, n: 0 });
    });

    it('calcula a media de uma serie simples', () => {
      const s = series([[0, 2], [1, 4], [2, 6]]);
      expect(math.periodMean(s)).toEqual({ value: 4, n: 3 });
    });

    it('trata valor zero como observacao valida, nao ausencia', () => {
      const s = series([[0, 0], [1, 4]]);
      expect(math.periodMean(s)).toEqual({ value: 2, n: 2 });
    });

    it('respeita o periodo quando informado', () => {
      const s = series([[0, 1], [10, 5], [20, 9]]);
      const result = math.periodMean(s, { from: day(5), to: day(15) });
      expect(result).toEqual({ value: 5, n: 1 });
    });
  });

  describe('movingAverage', () => {
    it('serie vazia retorna value null, n 0, janela parcial', () => {
      const result = math.movingAverage([], { kind: 'calendar_days', size: 21 });
      expect(result.value).toBeNull();
      expect(result.n).toBe(0);
      expect(result.isPartialWindow).toBe(true);
    });

    it('uma unica observacao: media = o proprio valor, janela parcial se a janela pedida for maior que o historico', () => {
      const s = series([[0, 3]]);
      const result = math.movingAverage(s, { kind: 'calendar_days', size: 21 });
      expect(result.value).toBe(3);
      expect(result.n).toBe(1);
      expect(result.isPartialWindow).toBe(true);
    });

    it('janela por contagem de observacoes (observation_count) parcialmente preenchida', () => {
      const s = series([[0, 2], [1, 4]]);
      const result = math.movingAverage(s, { kind: 'observation_count', size: 5 });
      expect(result.value).toBe(3);
      expect(result.n).toBe(2);
      expect(result.isPartialWindow).toBe(true);
    });

    it('janela por contagem totalmente preenchida nao e parcial', () => {
      const s = series([[0, 2], [1, 4], [2, 6]]);
      const result = math.movingAverage(s, { kind: 'observation_count', size: 3 });
      expect(result.value).toBe(4);
      expect(result.isPartialWindow).toBe(false);
    });

    it('janela cronologica exclui pontos fora do intervalo de dias', () => {
      const s = series([[0, 1], [5, 3], [30, 100]]); // dia 30 fora de uma janela de 21 dias a partir do dia 30
      const result = math.movingAverage(s, { kind: 'calendar_days', size: 21 }, day(30));
      // janela: (30-21, 30] = (9, 30] -> so o ponto do dia 30 entra
      expect(result.n).toBe(1);
      expect(result.value).toBe(100);
    });

    it('observacoes irregulares no tempo ainda sao promediadas corretamente', () => {
      const s = series([[0, 10], [1, 20], [15, 30]]); // dois pontos proximos, um distante
      const result = math.movingAverage(s, { kind: 'calendar_days', size: 60 });
      expect(result.n).toBe(3);
      expect(result.value).toBe(20);
    });
  });

  describe('baseline', () => {
    it('e mecanicamente equivalente a movingAverage na mesma janela', () => {
      const s = series([[0, 2], [10, 4], [20, 6]]);
      const window = { kind: 'calendar_days' as const, size: 200 };
      expect(math.baseline(s, window)).toEqual(math.movingAverage(s, window));
    });
  });

  describe('deviation', () => {
    it('null quando current ou baseline sao null', () => {
      expect(math.deviation(null, 5)).toEqual({ current: null, baseline: 5, absoluteDeviation: null, relativeDeviation: null });
      expect(math.deviation(5, null)).toEqual({ current: 5, baseline: null, absoluteDeviation: null, relativeDeviation: null });
    });

    it('calcula desvio absoluto e relativo', () => {
      const result = math.deviation(8, 4);
      expect(result.absoluteDeviation).toBe(4);
      expect(result.relativeDeviation).toBe(1);
    });

    it('relativeDeviation null quando baseline e zero (evita divisao por zero)', () => {
      const result = math.deviation(5, 0);
      expect(result.absoluteDeviation).toBe(5);
      expect(result.relativeDeviation).toBeNull();
    });
  });

  describe('trend', () => {
    it('insufficient_data com menos de 2 pontos', () => {
      expect(math.trend([], { kind: 'calendar_days', size: 21 }).direction).toBe('insufficient_data');
      expect(math.trend(series([[0, 5]]), { kind: 'calendar_days', size: 21 }).direction).toBe('insufficient_data');
    });

    it('detecta serie crescente', () => {
      const s = series([[0, 1], [5, 2], [10, 3], [15, 4], [20, 5]]);
      const result = math.trend(s, { kind: 'calendar_days', size: 60 });
      expect(result.direction).toBe('increasing');
      expect(result.slopePerDay).toBeGreaterThan(0);
    });

    it('detecta serie decrescente', () => {
      const s = series([[0, 5], [5, 4], [10, 3], [15, 2], [20, 1]]);
      const result = math.trend(s, { kind: 'calendar_days', size: 60 });
      expect(result.direction).toBe('decreasing');
      expect(result.slopePerDay).toBeLessThan(0);
    });

    it('detecta serie estavel (oscilacao simetrica em torno de um mesmo nivel, sem inclinacao liquida)', () => {
      const s = series([[0, 3], [5, 4], [10, 2], [15, 4], [20, 3]]);
      const result = math.trend(s, { kind: 'calendar_days', size: 60 });
      expect(result.direction).toBe('stable');
    });
  });

  describe('selectWindow', () => {
    it('serie vazia', () => {
      const selection = math.selectWindow([], { kind: 'calendar_days', size: 21 });
      expect(selection).toEqual({ points: [], window: { kind: 'calendar_days', size: 21 }, n: 0, isPartialWindow: true, windowStart: null, windowEnd: null });
    });

    it('serie curta com janela por contagem maior que o historico fica marcada como parcial', () => {
      const s = series([[0, 1], [1, 2]]);
      const selection = math.selectWindow(s, { kind: 'observation_count', size: 10 });
      expect(selection.n).toBe(2);
      expect(selection.isPartialWindow).toBe(true);
    });
  });
});
