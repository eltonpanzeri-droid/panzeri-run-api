import { LongitudinalDynamicsService } from '../src/training-intelligence/longitudinal-dynamics.service';
import { MathLayerService, SeriesPoint, WindowSpec } from '../src/training-intelligence/math-layer.service';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { TrainingIntelligenceQueryService } from '../src/training-intelligence/training-intelligence-query.service';

// Classificacao individual da mudanca (10/2026): series controladas, sem alunos reais e sem IA.

const math = new MathLayerService();
const dynamics = new LongitudinalDynamicsService(math);
const W21: WindowSpec = { kind: 'calendar_days', size: 21 };
const END = Date.parse('2026-09-30T12:00:00Z');
const at = (daysAgo: number, value: number, hour = 0): SeriesPoint => ({ value, timestamp: new Date(END - daysAgo * 86_400_000 + hour * 3_600_000) });
const ORD = { step: 1, range: { min: 1, max: 5 } };
// n valores de referencia (a cada 2 dias, de 150 a 30 dias atras) alternando os valores dados
const reference = (values: number[], from = 150, to = 25, every = 2): SeriesPoint[] => {
  const out: SeriesPoint[] = [];
  for (let d = from, i = 0; d >= to; d -= every, i += 1) out.push(at(d, values[i % values.length]));
  return out;
};

describe('changePattern — mudanca em relacao ao proprio historico', () => {
  it('1) serie constante => estavel', () => {
    const series = [...reference([2]), ...[20, 16, 12, 8, 4, 0].map((d) => at(d, 2))];
    const p = dynamics.changePattern(series, W21, ORD);
    expect(p.kind).toBe('stable');
    expect(p.outsideDays).toBe(0);
    expect(p.referenceBasis).toBe('individual');
  });

  it('2) oscilacao isolada com retorno ao habitual => oscilacao pontual (a regressao pura chamaria de tendencia)', () => {
    const series = [...reference([2]), at(18, 2), at(15, 4), at(12, 2), at(9, 2), at(6, 4), at(3, 2), at(0, 2)];
    const p = dynamics.changePattern(series, W21, ORD);
    expect(p.kind).toBe('isolated_oscillation');
    expect(p.ongoing).toBe(false);
    expect(p.episodes).toBe(2);
    expect(p.supporting.map((s) => s.value)).toEqual([4, 4]);
    // criterio antigo: a regressao linear sobre estes 7 pontos estimaria um deslocamento acima de 5% da amplitude => "increasing"/"decreasing"
    expect(math.trend(series, W21).direction).not.toBe('stable');
  });

  it('3) mudanca persistente (varios dias, varias semanas) => sustentada, com as observacoes que a sustentam', () => {
    const series = [...reference([1, 2]), ...[18, 15, 12, 9, 6, 3, 0].map((d) => at(d, 3.5))];
    const p = dynamics.changePattern(series, W21, ORD);
    expect(p.kind).toBe('sustained_change');
    expect(p.side).toBe('above');
    expect(p.run?.days).toBe(7);
    expect(p.run!.spanDays).toBeGreaterThanOrEqual(7);
    expect(p.supporting.length).toBeGreaterThanOrEqual(3);
    expect(p.band).toEqual({ lower: 1, upper: 2 });
  });

  it('4) mudanca recente ainda nao consolidada => mudanca recente (nao "tendencia")', () => {
    const series = [...reference([1, 2]), at(18, 2), at(15, 1), at(10, 2), at(5, 1), at(2, 4), at(0, 4)];
    const p = dynamics.changePattern(series, W21, ORD);
    expect(p.kind).toBe('recent_change');
    expect(p.run).toEqual({ days: 2, spanDays: 2 });
  });

  it('5) dois alunos, mesma resposta atual (3): para o aluno habitualmente 1-2 e afastamento; para o 3-4 e estabilidade', () => {
    const recent = [at(14, 3), at(10, 3), at(7, 3), at(3, 3), at(0, 3)];
    const lowUsual = dynamics.changePattern([...reference([1, 2]), ...recent], W21, ORD);
    const highUsual = dynamics.changePattern([...reference([3, 4]), ...recent], W21, ORD);
    expect(lowUsual.kind).toBe('sustained_change');
    expect(lowUsual.side).toBe('above');
    expect(highUsual.kind).toBe('stable');
    expect(highUsual.band).toEqual({ lower: 3, upper: 4 });
  });

  it('6) poucos registros: sem referencia => dados insuficientes; referencia curta => faixa limitada e persistencia mais exigente', () => {
    const few = dynamics.changePattern([at(10, 2), at(6, 4), at(2, 3), at(0, 3)], W21, ORD);
    expect(few.kind).toBe('insufficient_data');
    expect(few.caution).toMatch(/suficientes/);
    // 6 dias de referencia (limitada) + 3 dias fora: exige 4 dias e 10 dias de duracao => ainda so' mudanca recente
    const limited = dynamics.changePattern([at(60, 2), at(55, 1), at(50, 2), at(45, 1), at(40, 2), at(35, 1), at(14, 4), at(7, 4), at(0, 4)], W21, ORD);
    expect(limited.referenceBasis).toBe('limited');
    expect(limited.kind).toBe('recent_change');
    expect(limited.caution).toMatch(/apenas 6 dias/);
    // sem historico anterior a janela: usa a primeira metade da propria janela e nunca passa de mudanca recente
    const within = dynamics.changePattern([at(20, 1), at(18, 2), at(16, 1), at(10, 4), at(6, 4), at(3, 4), at(0, 4)], W21, ORD);
    expect(within.referenceBasis).toBe('within_window');
    expect(['recent_change', 'sustained_change', 'stable', 'isolated_oscillation']).toContain(within.kind);
    expect(within.kind).not.toBe('insufficient_data');
  });

  it('7) dados ausentes nao viram zero: lacunas na serie nao criam afastamento', () => {
    const series = [...reference([3], 150, 25, 7), at(14, 3), at(0, 3)]; // registros esparsos (semanais)
    const p = dynamics.changePattern(series, W21, ORD);
    expect(p.kind).toBe('stable');
    expect(p.windowDays).toBe(2);
  });

  it('8) valores nos limites da escala: sempre 5 e caindo para 4 persistentemente e mudanca; sempre 1 e continuar em 1 e estabilidade', () => {
    const down = dynamics.changePattern([...reference([5]), at(16, 4), at(12, 4), at(8, 4), at(4, 4), at(0, 4)], W21, ORD);
    expect(down.kind).toBe('sustained_change');
    expect(down.side).toBe('below');
    const floor = dynamics.changePattern([...reference([1]), at(16, 1), at(8, 1), at(0, 1)], W21, ORD);
    expect(floor.kind).toBe('stable');
  });

  it('9) varias observacoes no mesmo dia contam como UM dia (mediana do dia): dois treinos no mesmo dia nao fabricam persistencia', () => {
    const oneDay = dynamics.changePattern([...reference([2]), at(10, 2), at(5, 2), at(0, 4, 0), at(0, 4, 5)], W21, ORD);
    expect(oneDay.kind).toBe('isolated_oscillation');
    expect(oneDay.ongoing).toBe(true);
    expect(oneDay.windowDays).toBe(3);
    const twoDays = dynamics.changePattern([...reference([2]), at(10, 2), at(5, 2), at(1, 4), at(0, 4)], W21, ORD);
    expect(twoDays.kind).toBe('recent_change');
    // a ordem das duas sessoes do mesmo dia nao muda o resultado
    const swapped = dynamics.changePattern([...reference([2]), at(10, 2), at(5, 2), at(0, 4, 5), at(0, 4, 0)], W21, ORD);
    expect(swapped).toEqual(oneDay);
  });

  it('10) o lado e' + ' numerico: acima/abaixo nao e melhora/piora (a polaridade da variavel e' + ' decidida por quem apresenta)', () => {
    const fatigueUp = dynamics.changePattern([...reference([1, 2]), ...[16, 12, 8, 4, 0].map((d) => at(d, 4))], W21, ORD);
    const motivationDown = dynamics.changePattern([...reference([4, 5]), ...[16, 12, 8, 4, 0].map((d) => at(d, 2))], W21, ORD);
    expect([fatigueUp.kind, fatigueUp.side]).toEqual(['sustained_change', 'above']);
    expect([motivationDown.kind, motivationDown.side]).toEqual(['sustained_change', 'below']);
  });
});

describe('snapshot: a direcao exposta aos agentes e as telas e a SUSTENTADA', () => {
  const build = (points: SeriesPoint[]) => {
    const reader = { getObservations: async () => points.map((p) => ({ athleteId: 'a', variableId: 'workout.prePhysicalFatigue', value: p.value, timestamp: p.timestamp, source: 'student_feedback_per_workout', instrumentVersion: 1, context: {} })) };
    return new TrainingIntelligenceQueryService(reader as never, math, dynamics);
  };

  it('pico isolado: direction=stable (antes: increasing/decreasing); pattern e slopeDirection preservam o detalhe', async () => {
    const series = [...reference([2]), at(18, 2), at(15, 4), at(12, 2), at(9, 2), at(6, 4), at(3, 2), at(0, 2)];
    const snapshot = await build(series).getVariableSnapshot('a', 'workout.prePhysicalFatigue');
    const t = snapshot.trend!.short_21d;
    expect(t.direction).toBe('stable');
    expect(t.pattern?.kind).toBe('isolated_oscillation');
    expect(t.slopeDirection).toBeDefined();
  });

  it('mudanca sustentada: direction=increasing; MM e faixa habitual inalteradas', async () => {
    const series = [...reference([1, 2]), ...[18, 15, 12, 9, 6, 3, 0].map((d) => at(d, 3.5))];
    const snapshot = await build(series).getVariableSnapshot('a', 'workout.prePhysicalFatigue');
    expect(snapshot.trend!.short_21d.direction).toBe('increasing');
    expect(snapshot.trend!.short_21d.pattern?.supporting.length).toBeGreaterThan(0);
    expect(snapshot.movingAverages!.short_21d.value).toBeCloseTo(3.5, 5);
    expect(snapshot.habitualRange?.lower).not.toBeNull();
  });

  it('sem dados suficientes: insufficient_data', async () => {
    const snapshot = await build([at(2, 3)]).getVariableSnapshot('a', 'workout.prePhysicalFatigue');
    expect(snapshot.trend!.short_21d.direction).toBe('insufficient_data');
  });
});

describe('ordem temporal: duas sessoes no mesmo dia', () => {
  it('desempate deterministico pelo id do registro de origem, independente da ordem devolvida pelo banco', async () => {
    const reader = new ObservationReaderService(null as never, null as never, null as never);
    const t = new Date('2026-09-30T00:00:00Z');
    const obs = (id: string, value: number) => ({ athleteId: 'a', variableId: 'v', value, timestamp: t, source: 'x', instrumentVersion: 1, context: { sessionId: id } });
    (reader as unknown as { readObservations: unknown }).readObservations = async () => [obs('sessao-b', 4), obs('sessao-a', 2)];
    const first = await reader.getObservations('a', 'v');
    (reader as unknown as { readObservations: unknown }).readObservations = async () => [obs('sessao-a', 2), obs('sessao-b', 4)];
    const second = await reader.getObservations('a', 'v');
    expect(first.map((o) => o.value)).toEqual([2, 4]);
    expect(second.map((o) => o.value)).toEqual([2, 4]);
  });
});
