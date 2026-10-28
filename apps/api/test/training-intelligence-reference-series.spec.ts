import { LongitudinalDynamicsService } from '../src/training-intelligence/longitudinal-dynamics.service';
import { MathLayerService, SeriesPoint } from '../src/training-intelligence/math-layer.service';
import { BAND_INDIVIDUAL_MIN, BAND_LIMITED_MIN, buildReferenceSeries, referenceUnitOf } from '../src/training-intelligence/reference-series';
import { explorerCategoryOf, explorerInfoOf } from '../src/training-intelligence/explorer-catalog';
import { getVariableDefinition, listVariableIds } from '../src/training-intelligence/variable-registry';

// 27/10/2026 — referencias ANTERIORES a cada observacao (Evolucao do painel): a propria observacao nunca entra na sua referencia, empates compartilham a referencia,
// a unidade da janela segue a periodicidade e a faixa so' existe com base suficiente.

const math = new MathLayerService();
const dynamics = new LongitudinalDynamicsService(math);
const day = (offset: number) => new Date(Date.UTC(2026, 8, 1 + offset));
const points = (values: number[]): SeriesPoint[] => values.map((value, i) => ({ value, timestamp: day(i) }));
const weekly = { expectedFrequency: 'per_week' } as const;
const daily = { expectedFrequency: 'per_day' } as const;
const perWorkout = { expectedFrequency: 'per_workout' } as const;

describe('referencias anteriores a cada observacao', () => {
  it('a observacao analisada NAO participa da propria referencia; ela entra nas das seguintes', () => {
    const result = buildReferenceSeries(points([10, 10, 10, 10, 10, 50]), weekly, math, dynamics);
    const last = result.points[5];
    expect(last.value).toBe(50);
    expect(last.priorN).toBe(5);
    expect(last.historicalMean).toEqual({ value: 10, n: 5 });             // o 50 NAO puxou a media
    expect(last.movingAverages.mm7.value).toBe(10);
    expect(last.movingAverages.mm7.n).toBe(5);
    // a proxima observacao ja' enxerga o 50 na referencia
    const next = buildReferenceSeries(points([10, 10, 10, 10, 10, 50, 10]), weekly, math, dynamics).points[6];
    expect(next.priorN).toBe(6);
    expect(next.historicalMean.value).toBeCloseTo(100 / 6, 6);
  });

  it('a primeira observacao nao tem referencia (nada antes dela) e nunca vira "normal"', () => {
    const [first] = buildReferenceSeries(points([7, 8]), weekly, math, dynamics).points;
    expect(first.priorN).toBe(0);
    expect(first.historicalMean).toEqual({ value: null, n: 0 });
    expect(first.movingAverages.mm21).toMatchObject({ value: null, n: 0 });
    expect(first.band).toMatchObject({ lower: null, upper: null, basis: 'none' });
    expect(first.signal).toBe('no_reference');
    expect(first.outsideBy).toBeNull();
  });

  it('observacoes no MESMO instante compartilham a referencia congelada antes do grupo, qualquer que seja a ordem', () => {
    const instant = day(10);
    const base = points([5, 6, 5, 6, 5, 6, 5, 6, 5, 6]);
    const a = buildReferenceSeries([...base, { value: 9, timestamp: instant }, { value: 2, timestamp: instant }], perWorkout, math, dynamics).points;
    const b = buildReferenceSeries([...base, { value: 2, timestamp: instant }, { value: 9, timestamp: instant }], perWorkout, math, dynamics).points;
    for (const result of [a, b]) {
      const [x, y] = result.slice(10);
      expect(x.priorN).toBe(10);
      expect(y.priorN).toBe(10);                                       // um nao entra na referencia do outro
      expect(x.historicalMean).toEqual(y.historicalMean);
      expect(x.band).toEqual(y.band);
    }
    expect(a[10].historicalMean).toEqual(b[10].historicalMean);
  });

  it('a faixa so existe com base suficiente: <4 sem faixa, 4 a 11 limitada, 12 ou mais individual', () => {
    const basisAfter = (priorCount: number) => buildReferenceSeries(points([...Array(priorCount).fill(5), 5]), weekly, math, dynamics).points[priorCount].band.basis;
    expect(BAND_LIMITED_MIN).toBe(4);
    expect(BAND_INDIVIDUAL_MIN).toBe(12);
    expect(basisAfter(3)).toBe('none');
    expect(basisAfter(4)).toBe('limited');
    expect(basisAfter(11)).toBe('limited');
    expect(basisAfter(12)).toBe('individual');
    const tiny = buildReferenceSeries(points([5, 5, 5, 9]), weekly, math, dynamics).points[3];
    expect(tiny.signal).toBe('no_reference');                           // sem base, o valor 9 nao e' classificado
  });

  it('o sinal e a magnitude descrevem o lado da faixa, sem julgar bom ou ruim', () => {
    const base = [10, 11, 10, 12, 11, 10, 11, 12, 10, 11, 10, 12];
    const above = buildReferenceSeries(points([...base, 30]), weekly, math, dynamics).points[12];
    const below = buildReferenceSeries(points([...base, 1]), weekly, math, dynamics).points[12];
    const inside = buildReferenceSeries(points([...base, 11]), weekly, math, dynamics).points[12];
    expect(above.signal).toBe('above');
    expect(above.outsideBy).toBeCloseTo(30 - above.band.upper!, 6);
    expect(below.signal).toBe('below');
    expect(below.outsideBy).toBeCloseTo(1 - below.band.lower!, 6);
    expect(inside.signal).toBe('within');
    expect(inside.outsideBy).toBeNull();
  });

  it('a faixa e' + " a MESMA do backend (habitualRange) aplicada so' ao que veio antes", () => {
    const values = [10, 11, 10, 12, 11, 10, 11, 12, 10, 11, 10, 12, 30, 9];
    const result = buildReferenceSeries(points(values), weekly, math, dynamics).points;
    for (const i of [8, 12, 13]) {
      const prior = points(values.slice(0, i));
      const expected = dynamics.habitualRange(prior, { kind: 'observation_count', size: 200 });
      expect(result[i].band.lower).toBeCloseTo(expected.lower!, 9);
      expect(result[i].band.upper).toBeCloseTo(expected.upper!, 9);
      expect(result[i].band.n).toBe(expected.n);
    }
  });

  it('a unidade da janela segue a periodicidade: dias/noites em dias corridos; semanas, ciclos e registros por numero de observacoes', () => {
    expect(referenceUnitOf({ expectedFrequency: 'per_day' })).toBe('dias');
    expect(referenceUnitOf({ expectedFrequency: 'per_night' })).toBe('noites');
    expect(referenceUnitOf({ expectedFrequency: 'per_week' })).toBe('semanas');
    expect(referenceUnitOf({ expectedFrequency: 'per_cycle' })).toBe('ciclos');
    expect(referenceUnitOf({ expectedFrequency: 'per_workout' })).toBe('registros');
    const counted = buildReferenceSeries(points([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), perWorkout, math, dynamics);
    expect(counted.windowKind).toBe('observation_count');
    expect(counted.windows.map((w) => w.label)).toEqual(['MM7 registros', 'MM21 registros', 'MM60 registros', 'MM200 registros']);
    // MM7 em registros: as 7 observacoes anteriores a 10 (3..9), media 6
    expect(counted.points[9].movingAverages.mm7).toMatchObject({ value: 6, n: 7, isPartialWindow: false });
    expect(counted.points[9].movingAverages.mm21.isPartialWindow).toBe(true);
    const days = buildReferenceSeries(points([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), daily, math, dynamics);
    expect(days.windowKind).toBe('calendar_days');
    expect(days.windows[0].label).toBe('MM7 dias');
    expect(days.points[9].movingAverages.mm7).toMatchObject({ n: 6 });  // dias 3..8 antes do dia 9, janela de 7 dias corridos exclui a propria observacao
  });

  it('nao altera a serie recebida e e deterministico', () => {
    const input = points([3, 1, 2, 9, 4, 4, 5, 6, 7, 8, 2, 3, 4, 5]);
    const snapshot = JSON.stringify(input);
    const first = buildReferenceSeries(input, weekly, math, dynamics);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(buildReferenceSeries(input, weekly, math, dynamics)).toEqual(first);
  });
});

describe('catalogo da Evolucao: categoria e ficha de cada indicador', () => {
  it('toda variavel do registro tem categoria e ficha completa (definicao, unidade de janela, periodicidade, origem e comparabilidade)', () => {
    for (const id of listVariableIds()) {
      const definition = getVariableDefinition(id)!;
      const info = explorerInfoOf(definition);
      expect(['treinos', 'sono', 'recuperacao', 'bem_estar', 'saude']).toContain(info.category);
      expect(info.evidenceLabel.length).toBeGreaterThan(5);
      expect(info.periodicityLabel.length).toBeGreaterThan(5);
      expect(info.source.length).toBeGreaterThan(0);
      expect(['comparable', 'not_comparable']).toContain(info.crossSourceComparability);
    }
  });

  it('classificacoes representativas', () => {
    const category = (id: string) => explorerCategoryOf(getVariableDefinition(id)!);
    expect(category('workout.preSleepQuality')).toBe('sono');
    expect(category('workout.perceivedEffort')).toBe('treinos');
    expect(category('training.volumeCompletedTotalKm')).toBe('treinos');
    expect(category('activity.avgPaceSecondsKm')).toBe('treinos');
    expect(category('workout.prePhysicalFatigue')).toBe('bem_estar');
    expect(category('workout.postPhysicalFatigue')).toBe('bem_estar');
    expect(category('workout.painFlag')).toBe('saude');
    expect(category('cycle.moodLevel')).toBe('saude');
    const wearables = listVariableIds().filter((id) => id.startsWith('wearable.'));
    expect(wearables.length).toBeGreaterThan(0);
    for (const id of wearables) expect(['sono', 'recuperacao']).toContain(category(id));
    expect(category('wearable.hrvLastNightAvg')).toBe('recuperacao');
  });
});

describe('snapshot com referencias e disponibilidade (servico)', () => {
  const obs = (value: number | string, offset: number, variableId = 'training.volumeCompletedTotalKm') => ({
    athleteId: 'a1', variableId, value, timestamp: new Date(Date.UTC(2026, 8, 1 + offset * 7)), source: 'weekly_training_load', instrumentVersion: 1, context: { modality: 'global' },
  });
  const build = (rows: unknown[]) => {
    const reader = { getObservations: jest.fn().mockResolvedValue(rows) };
    const mathLayer = new MathLayerService();
    const { TrainingIntelligenceQueryService } = jest.requireActual('../src/training-intelligence/training-intelligence-query.service') as typeof import('../src/training-intelligence/training-intelligence-query.service');
    return new TrainingIntelligenceQueryService(reader as never, mathLayer, new LongitudinalDynamicsService(mathLayer));
  };

  it('as referencias so vem quando pedidas: o Atlas e os demais consumidores nao recebem o campo nem pagam o custo', async () => {
    const service = build([obs(10, 0), obs(11, 1), obs(10, 2), obs(12, 3), obs(11, 4), obs(30, 5)]);
    expect((await service.getVariableSnapshot('a1', 'training.volumeCompletedTotalKm')).reference).toBeUndefined();
    const withReference = await service.getVariableSnapshot('a1', 'training.volumeCompletedTotalKm', undefined, undefined, { withReference: true });
    expect(withReference.reference?.points).toHaveLength(6);
    expect(withReference.reference?.points[5].historicalMean.n).toBe(5); // a ultima observacao nao entra na propria referencia
    expect(withReference.reference?.unit).toBe('semanas');
  });

  it('variavel categorica nao recebe referencias numericas', async () => {
    const service = build([obs('leve', 0, 'workout.painFlag'), obs('none', 1, 'workout.painFlag')]);
    const result = await service.getVariableSnapshot('a1', 'workout.painFlag', undefined, undefined, { withReference: true });
    expect(result.mathApplicable).toBe(false);
    expect(result.reference).toBeUndefined();
  });

  it('disponibilidade: conta, primeiro e ultimo registro por indicador; id desconhecido e ignorado', async () => {
    const service = build([obs(10, 0), obs(11, 2)]);
    const rows = await service.getVariablesAvailability('a1', ['training.volumeCompletedTotalKm', 'nao.existe', 'training.volumeCompletedTotalKm']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'training.volumeCompletedTotalKm', n: 2, mathApplicable: true });
    expect(rows[0].firstObservationAt).toBe(new Date(Date.UTC(2026, 8, 1)).toISOString());
    expect(rows[0].lastObservationAt).toBe(new Date(Date.UTC(2026, 8, 15)).toISOString());
    const empty = await build([]).getVariablesAvailability('a1', ['workout.painFlag']);
    expect(empty[0]).toMatchObject({ n: 0, firstObservationAt: null, lastObservationAt: null, mathApplicable: false });
  });
});
