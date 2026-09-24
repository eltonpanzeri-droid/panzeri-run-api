import { LongitudinalDynamicsService } from '../src/training-intelligence/longitudinal-dynamics.service';
import { MathLayerService, SeriesPoint } from '../src/training-intelligence/math-layer.service';

// 24/09/2026 — segundo bloco da Camada Matematica Longitudinal (auditoria aprovada + dados reais
// aprovados). Cobre exatamente os casos pedidos: media igual/variabilidade diferente, excursao com
// retorno rapido/lento/sem retorno, retorno com overshoot, recuperacao de nivel sem recuperacao de
// variabilidade, serie estavel, mudanca persistente, serie curta, observacoes irregulares, janela
// parcial, missing (sem faixa habitual), e os exemplos A/B/C/D do pedido original.

function day(offset: number, base = '2026-09-01T00:00:00.000Z'): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

function series(values: number[]): SeriesPoint[] {
  return values.map((value, offset) => ({ value, timestamp: day(offset) }));
}

describe('LongitudinalDynamicsService', () => {
  let dynamics: LongitudinalDynamicsService;

  beforeEach(() => {
    dynamics = new LongitudinalDynamicsService(new MathLayerService());
  });

  describe('dispersion', () => {
    it('serie vazia: tudo null', () => {
      const result = dynamics.dispersion([], { kind: 'observation_count', size: 5 }, true);
      expect(result).toEqual({ window: { kind: 'observation_count', size: 5 }, n: 0, isPartialWindow: true, median: null, mad: null, iqr: null, range: null });
    });

    it('uma unica observacao: mediana e o proprio valor, mad/iqr/range null (nao inventa "sem variabilidade")', () => {
      const result = dynamics.dispersion(series([7]), { kind: 'observation_count', size: 1 }, false);
      expect(result.median).toBe(7);
      expect(result.mad).toBeNull();
      expect(result.iqr).toBeNull();
      expect(result.range).toBeNull();
    });

    it('media igual, variabilidade diferente: A=[10,10,10,10,10] x B=[8,12,8,12,10]', () => {
      const a = dynamics.dispersion(series([10, 10, 10, 10, 10]), { kind: 'observation_count', size: 5 }, false);
      const b = dynamics.dispersion(series([8, 12, 8, 12, 10]), { kind: 'observation_count', size: 5 }, false);
      expect(a.median).toBe(10);
      expect(b.median).toBe(10);
      expect(a.mad).toBe(0);
      expect(b.mad).toBeGreaterThan(0);
      expect(a.range).toBe(0);
      expect(b.range).toBe(4);
    });
  });

  describe('habitualRange', () => {
    it('serie vazia: tudo null, mas declara o metodo mesmo assim', () => {
      const result = dynamics.habitualRange([], { kind: 'observation_count', size: 30 });
      expect(result.method).toBe('empirical_percentile_linear_interpolation');
      expect(result.n).toBe(0);
      expect(result.lower).toBeNull();
      expect(result.upper).toBeNull();
    });

    it('janela parcial e sinalizada quando o historico e menor que a janela pedida', () => {
      const result = dynamics.habitualRange(series([9, 10, 11]), { kind: 'calendar_days', size: 200 });
      expect(result.isPartialWindow).toBe(true);
      expect(result.n).toBe(3);
    });

    it('nao presume normalidade: registra a advertencia semantica sobre escalas ordinais', () => {
      const result = dynamics.habitualRange(series([1, 2, 3, 4, 5]), { kind: 'observation_count', size: 5 });
      expect(result.semanticCaution).toMatch(/ordinais/);
    });
  });

  describe('variabilityChange', () => {
    it('insufficient_data com poucas observacoes em qualquer uma das janelas', () => {
      const s = series([10, 10]);
      const result = dynamics.variabilityChange(s, { kind: 'observation_count', size: 5 }, { kind: 'observation_count', size: 5 });
      expect(result.direction).toBe('insufficient_data');
    });

    it('detecta aumento de variabilidade (recente instavel, habitual estavel)', () => {
      // 20 pontos estaveis (~10) seguidos de 5 pontos oscilando forte — janela recente pega so' os ultimos.
      const stable = Array.from({ length: 20 }, () => 10);
      const volatile = [6, 14, 6, 14, 10];
      const s = series([...stable, ...volatile]);
      const result = dynamics.variabilityChange(
        s,
        { kind: 'observation_count', size: 5 },
        { kind: 'observation_count', size: 25 },
      );
      expect(result.direction).toBe('increased');
      // Habitual sem NENHUMA variabilidade (mad=0): a razao fica null (divisao por zero e'
      // indefinida) mesmo com a direcao sendo inequivoca — nao inventamos um numero aqui.
      expect(result.madRatio).toBeNull();
    });

    it('serie totalmente estavel: variabilidade "unchanged" (ambas proximas de zero)', () => {
      const s = series(Array.from({ length: 25 }, () => 10));
      const result = dynamics.variabilityChange(
        s,
        { kind: 'observation_count', size: 5 },
        { kind: 'observation_count', size: 25 },
      );
      expect(result.direction).toBe('unchanged');
      expect(result.madRatio).toBe(1);
    });
  });

  describe('excursions — exemplos A/B/C/D do pedido original', () => {
    const bounds = { lower: 8.5, upper: 11.5 };

    it('A) 10,11,13,10,9,10 — excursao curta com retorno rapido, sem overshoot', () => {
      const s = series([10, 11, 13, 10, 9, 10]);
      const result = dynamics.excursions(s, bounds);
      expect(result).toHaveLength(1);
      const [exc] = result;
      expect(exc.direction).toBe('above');
      expect(exc.peak.value).toBe(13);
      expect(exc.observationCount).toBe(1);
      expect(exc.returnDynamics?.returned).toBe(true);
      expect(exc.returnDynamics?.observationsToReturn).toBe(1);
      expect(exc.returnDynamics?.timeToReturnDays).toBe(1);
      expect(exc.returnDynamics?.overshoot).toBeNull();
    });

    it('B) 10,11,13,12,12,11,10 — excursao com retorno lento (mais observacoes, velocidade menor que A)', () => {
      const sA = series([10, 11, 13, 10, 9, 10]);
      const sB = series([10, 11, 13, 12, 12, 11, 10]);
      const excA = dynamics.excursions(sA, bounds)[0];
      const excB = dynamics.excursions(sB, bounds)[0];
      expect(excB.returnDynamics?.returned).toBe(true);
      expect(excB.observationCount).toBeGreaterThan(excA.observationCount);
      expect(excB.returnDynamics!.timeToReturnDays!).toBeGreaterThan(excA.returnDynamics!.timeToReturnDays!);
      expect(excB.returnDynamics!.returnVelocity!).toBeLessThan(excA.returnDynamics!.returnVelocity!);
    });

    it('C) 10,11,13,13,14,13,12 — excursao SEM retorno observado (ongoing ate o fim da serie)', () => {
      const s = series([10, 11, 13, 13, 14, 13, 12]);
      const result = dynamics.excursions(s, bounds);
      expect(result).toHaveLength(1);
      expect(result[0].ongoing).toBe(true);
      expect(result[0].returnDynamics).toBeNull();
      expect(result[0].peak.value).toBe(14);
    });

    it('D) 10,11,13,7,14,6,13,8 — oscilacao com overshoot encadeado (nunca passa observavelmente pela faixa habitual)', () => {
      const s = series([10, 11, 13, 7, 14, 6, 13, 8]);
      const result = dynamics.excursions(s, bounds);
      // 5 excursoes: 13(above), 7(below), 14(above), 6(below), 13+8 nao -- 13(above) e 8(below) sao segmentos separados
      expect(result.length).toBeGreaterThanOrEqual(5);
      // Nenhuma delas retornou de verdade a faixa habitual (nunca ha um ponto 'inside' entre elas)
      const allButLast = result.slice(0, -1);
      for (const exc of allButLast) {
        expect(exc.returnDynamics?.returned).toBe(false);
        expect(exc.returnDynamics?.overshoot?.occurred).toBe(true);
      }
      // A ultima esta em curso (ultimo ponto da serie, 8, ainda fora da faixa)
      expect(result[result.length - 1].ongoing).toBe(true);
    });
  });

  describe('recuperacao de nivel vs recuperacao de variabilidade — sao medidas independentes', () => {
    it('nivel recupera mas variabilidade NAO recupera apos o retorno', () => {
      // baseline com pequena variabilidade real (mad=0.5), excursao isolada, retorno pro mesmo
      // nivel mas oscilando fortemente logo em seguida (mad pos-retorno bem maior que o habitual).
      const s = series([10, 11, 10, 9, 15, 9, 13, 11]);
      const bounds = { lower: 8, upper: 12 };
      const result = dynamics.excursions(s, bounds);
      const excursion = result.find((e) => e.peak.value === 15)!;
      expect(excursion.returnDynamics?.returned).toBe(true);
      expect(excursion.returnDynamics?.levelRecovery.recovered).toBe(true);
      expect(excursion.returnDynamics?.variabilityRecovery.recovered).toBe(false);
      expect(excursion.returnDynamics!.variabilityRecovery.ratio!).toBeGreaterThan(1.5);
    });
  });

  describe('persistence', () => {
    it('sem observacoes ou sem faixa habitual: null (nao avaliavel)', () => {
      expect(dynamics.persistence([], { lower: 8, upper: 12 })).toEqual({
        currentlyOutsideHabitualRange: null, direction: null, startTimestamp: null, durationDays: null, observationCount: null,
      });
      expect(dynamics.persistence(series([10, 10]), { lower: null, upper: null })).toEqual({
        currentlyOutsideHabitualRange: null, direction: null, startTimestamp: null, durationDays: null, observationCount: null,
      });
    });

    it('serie estavel (dentro da faixa o tempo todo): currentlyOutsideHabitualRange=false', () => {
      const s = series([10, 10, 11, 10, 9, 10]);
      const result = dynamics.persistence(s, { lower: 8, upper: 12 });
      expect(result.currentlyOutsideHabitualRange).toBe(false);
    });

    it('mudanca persistente: serie sai da faixa e NAO retorna ate o fim — duracao/observacoes crescem', () => {
      const s = series([10, 10, 10, 15, 16, 17, 18]); // sai no dia 3 e nunca mais volta
      const result = dynamics.persistence(s, { lower: 8, upper: 12 });
      expect(result.currentlyOutsideHabitualRange).toBe(true);
      expect(result.direction).toBe('above');
      expect(result.observationCount).toBe(4);
      expect(result.durationDays).toBe(3); // do dia 3 ao dia 6
    });

    it('nao confunde um valor isolado com mudanca persistente (excursao unica seguida de retorno nao fica "persistente")', () => {
      const s = series([10, 10, 15, 10, 10]);
      const result = dynamics.persistence(s, { lower: 8, upper: 12 });
      expect(result.currentlyOutsideHabitualRange).toBe(false);
    });
  });

  describe('observacoes irregulares no tempo', () => {
    it('durationDays usa o timestamp real, nao a contagem de observacoes', () => {
      const irregular: SeriesPoint[] = [
        { value: 10, timestamp: day(0) },
        { value: 15, timestamp: day(1) }, // excursao comeca
        { value: 16, timestamp: day(20) }, // proxima observacao so 20 dias depois (irregular)
        { value: 10, timestamp: day(21) }, // retorno
      ];
      const result = dynamics.excursions(irregular, { lower: 8, upper: 12 });
      expect(result).toHaveLength(1);
      expect(result[0].observationCount).toBe(2); // 2 observacoes fora da faixa (15 e 16)
      expect(result[0].durationDays).toBe(19); // dia 1 ao dia 20, nao "2 observacoes"
      expect(result[0].returnDynamics?.timeToReturnDays).toBe(20); // do inicio (dia1) ate o retorno (dia21)
    });
  });

  describe('missing / sem faixa habitual', () => {
    it('excursions() retorna vazio quando nao ha faixa habitual calculavel (bounds null)', () => {
      const s = series([10, 20, 5]);
      expect(dynamics.excursions(s, { lower: null, upper: null })).toEqual([]);
    });
  });
});
