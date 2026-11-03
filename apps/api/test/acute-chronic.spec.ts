import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACUTE_SIZE, CHRONIC_SIZE, buildAcuteChronic } from '../src/training-intelligence/acute-chronic';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { READING_GUIDE, readingFor } from '../src/training-intelligence/variable-reading-guide';
import { getVariableDefinition } from '../src/training-intelligence/variable-registry';
import { TrainingIntelligenceQueryService } from '../src/training-intelligence/training-intelligence-query.service';
import { LongitudinalDynamicsService } from '../src/training-intelligence/longitudinal-dynamics.service';
import { acuteChronicSentence } from '../../mobile/home/insights';

// 03/11/2026 — aguda × cronica (7 × 28 registros mais recentes) para qualquer indicador, na mesma camada longitudinal. Descritiva: sem limite de risco, sem "bom/ruim".
const math = new MathLayerService();
const perWorkout = { variableId: 'workout.perceivedEffort', expectedFrequency: 'per_workout' as const };
const perNight = { variableId: 'wearable.hrvLastNightAvg', expectedFrequency: 'per_night' as const };
const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i, 12));
const seriesOf = (values: number[]) => values.map((value, i) => ({ value, timestamp: day(i) }));
const range = { lower: 3, upper: 6 };

describe('aguda × cronica — calculo', () => {
  it('janelas de 7 e 28 registros mais recentes; diferenca = aguda − cronica; a aguda esta contida na cronica', () => {
    // 28 registros: 21 valores 4 e os 7 mais recentes valendo 7
    const values = [...Array(21).fill(4), ...Array(7).fill(7)];
    const result = buildAcuteChronic(math, seriesOf(values), perWorkout, range);
    expect(ACUTE_SIZE).toBe(7);
    expect(CHRONIC_SIZE).toBe(28);
    expect(result.acute).toMatchObject({ value: 7, n: 7, size: 7, complete: true });
    expect(result.chronic).toMatchObject({ n: 28, size: 28, complete: true });
    expect(result.chronic.value).toBeCloseTo((21 * 4 + 7 * 7) / 28, 10);
    expect(result.difference).toBeCloseTo(7 - 133 / 28, 10);
    expect(result.relativeDifferencePct).toBeCloseTo((100 * (7 - 133 / 28)) / (133 / 28), 8);
    expect(result.direction).toBe('acute_above');
    expect(result.unit).toBe('registros');
    expect(result.windowKind).toBe('observation_count');
  });

  it('mostra de quando a quando cada janela vai (independe do tempo que cobre)', () => {
    const result = buildAcuteChronic(math, seriesOf(Array(40).fill(5)), perWorkout, range);
    expect(result.acute.windowStart).toBe(day(33).toISOString());
    expect(result.acute.windowEnd).toBe(day(39).toISOString());
    expect(result.chronic.windowStart).toBe(day(12).toISOString());
  });

  it('aguda abaixo da cronica e igual', () => {
    expect(buildAcuteChronic(math, seriesOf([...Array(21).fill(6), ...Array(7).fill(3)]), perWorkout, range).direction).toBe('acute_below');
    const equal = buildAcuteChronic(math, seriesOf(Array(28).fill(5)), perWorkout, range);
    expect(equal.direction).toBe('equal');
    expect(equal.difference).toBe(0);
    expect(equal.reading).toBeNull();
  });

  it('com menos de 28 registros NAO compara (insuficiente), mesmo tendo os 7 da aguda', () => {
    const result = buildAcuteChronic(math, seriesOf(Array(27).fill(5)), perWorkout, range);
    expect(result).toMatchObject({ direction: 'insufficient', difference: null, relativeDifferencePct: null, reading: null });
    expect(result.acute.complete).toBe(true);
    expect(result.chronic.complete).toBe(false);
    expect(buildAcuteChronic(math, [], perWorkout, range)).toMatchObject({ direction: 'insufficient', acute: { value: null, n: 0 } });
  });

  it('cronica igual a zero nao gera percentual (sem dividir por zero)', () => {
    const result = buildAcuteChronic(math, seriesOf([...Array(21).fill(-1), ...Array(7).fill(3)].map((v, i) => (i < 21 ? (i % 2 ? 1 : -1) * 3 : v))), perWorkout, null);
    expect(Number.isFinite(result.relativeDifferencePct ?? 0)).toBe(true);
  });

  it('posicao da media aguda em relacao a faixa habitual: acima, abaixo, dentro; sem faixa nao inventa', () => {
    const base = Array(21).fill(5);
    expect(buildAcuteChronic(math, seriesOf([...base, ...Array(7).fill(9)]), perWorkout, range).acuteVsHabitualRange).toBe('above');
    expect(buildAcuteChronic(math, seriesOf([...base, ...Array(7).fill(1)]), perWorkout, range).acuteVsHabitualRange).toBe('below');
    expect(buildAcuteChronic(math, seriesOf([...base, ...Array(7).fill(5)]), perWorkout, range).acuteVsHabitualRange).toBe('within');
    expect(buildAcuteChronic(math, seriesOf([...base, ...Array(7).fill(5)]), perWorkout, { lower: null, upper: null }).acuteVsHabitualRange).toBe('no_reference');
    expect(buildAcuteChronic(math, seriesOf([...base, ...Array(7).fill(5)]), perWorkout, null).acuteVsHabitualRange).toBe('no_reference');
  });

  it('indicadores diarios/noturnos usam 7 e 28 DIAS corridos (nao registros)', () => {
    const result = buildAcuteChronic(math, seriesOf(Array(40).fill(60)), perNight, range);
    expect(result).toMatchObject({ unit: 'noites', windowKind: 'calendar_days', direction: 'equal' });
    // historico de 20 dias: a janela de 28 dias e' parcial → nao compara
    expect(buildAcuteChronic(math, seriesOf(Array(20).fill(60)), perNight, range).direction).toBe('insufficient');
  });

  it('sem vazamento de dados futuros: so entra o que existe na serie recebida (a janela termina no ultimo registro)', () => {
    const values = [...Array(28).fill(5)];
    const withFuture = buildAcuteChronic(math, seriesOf(values), perWorkout, range);
    const longer = buildAcuteChronic(math, seriesOf([...values, 50]), perWorkout, range);
    expect(withFuture.acute.value).toBe(5);
    expect(longer.acute.value).not.toBe(5); // o novo registro passa a compor a aguda, e so' a partir dele
  });
});

describe('aguda × cronica — leitura cadastrada (rascunho a revisar)', () => {
  it('traz a leitura da direcao atual, marcada como rascunho enquanto Elton nao revisar', () => {
    const above = buildAcuteChronic(math, seriesOf([...Array(21).fill(4), ...Array(7).fill(7)]), perWorkout, range);
    expect(above.reading?.status).toBe('rascunho_a_revisar');
    expect(above.reading?.text).toBe(READING_GUIDE['workout.perceivedEffort'].above);
    const below = buildAcuteChronic(math, seriesOf([...Array(21).fill(7), ...Array(7).fill(4)]), perWorkout, range);
    expect(below.reading?.text).toBe(READING_GUIDE['workout.perceivedEffort'].below);
  });

  it('indicador sem cadastro nao traz leitura (so os numeros)', () => {
    expect(readingFor('indicador.inexistente', 'acute_above')).toBeNull();
    expect(buildAcuteChronic(math, seriesOf([...Array(21).fill(4), ...Array(7).fill(7)]), { variableId: 'sem.cadastro', expectedFrequency: 'per_workout' }, range).reading).toBeNull();
  });

  it('todo id cadastrado existe no registro de variaveis; cada leitura e uma frase, sem causa direta, diagnostico, risco ou nome proibido', () => {
    for (const [id, entry] of Object.entries(READING_GUIDE)) {
      expect({ id, exists: getVariableDefinition(id) != null }).toEqual({ id, exists: true });
      for (const text of [entry.above, entry.below]) {
        expect({ id, ok: text.length >= 20 && text.length <= 330 }).toEqual({ id, ok: true });
        expect({ id, hit: /vai se lesionar|vai lesionar|causa les|diagn[oó]stico|certamente|com certeza|garante|desacoplamento a[eé]robio|\bmotor\b|plano de treino/i.test(text) }).toEqual({ id, hit: false });
      }
    }
  });

  it('o desacoplamento tem leitura nas cinco faixas e nao conclui melhora de desempenho nem risco', () => {
    for (const category of ['d30', 'd60', 'd90', 'd120', 'd150']) {
      const entry = READING_GUIDE[`activity.hrDecoupling.${category}`];
      expect(entry).toBeDefined();
      expect(`${entry.above} ${entry.below}`).not.toMatch(/sistema nervoso|risco|les[aã]o|piora de desempenho/i);
    }
  });
});

describe('aguda × cronica — onde aparece', () => {
  const snapshotService = () => {
    const observation = (i: number, value: number, partial = false) => ({ athleteId: 's1', variableId: 'workout.perceivedEffort', value, timestamp: day(i), source: 'student_report', instrumentVersion: 1, context: partial ? { isPartialWeek: true } : {} });
    const observations = Array.from({ length: 30 }, (_, i) => observation(i, 5));
    observations.push(observation(30, 99, true));
    const reader = { getObservations: jest.fn().mockResolvedValue(observations) };
    return new TrainingIntelligenceQueryService(reader as never, math, new LongitudinalDynamicsService(math));
  };

  it('so vem nas leituras das telas (?reference=1); o contexto da IA nao recebe o bloco nem paga o custo', async () => {
    const service = snapshotService();
    expect((await service.getVariableSnapshot('s1', 'workout.perceivedEffort')).acuteChronic).toBeUndefined();
    const withRef = await service.getVariableSnapshot('s1', 'workout.perceivedEffort', undefined, undefined, { withReference: true });
    expect(withRef.acuteChronic).toMatchObject({ direction: 'equal', acute: { n: 7 }, chronic: { n: 28 } });
  });

  it('a semana em andamento (isPartialWeek) fica de fora da aguda e da cronica', async () => {
    const withRef = await snapshotService().getVariableSnapshot('s1', 'workout.perceivedEffort', undefined, undefined, { withReference: true });
    expect(withRef.acuteChronic?.acute.value).toBe(5); // o 99 parcial nao entrou
  });

  it('a tela da aluna descreve em frase neutra e so quando as duas janelas estao completas', () => {
    const base = { unit: 'registros', acute: { value: 6, n: 7, size: 7, windowStart: null, windowEnd: null, complete: true }, chronic: { value: 5, n: 28, size: 28, windowStart: null, windowEnd: null, complete: true } };
    const text = acuteChronicSentence({ acuteChronic: { ...base, direction: 'acute_above' } } as never, (v) => String(v));
    expect(text).toContain('7 registros mais recentes é 6');
    expect(text).toContain('28 mais recentes é 5');
    expect(text).toContain('acima da do seu hábito');
    expect(text).not.toMatch(/melhor|pior|risco|bom|ruim|queda de prontid/i);
    expect(acuteChronicSentence({ acuteChronic: { ...base, direction: 'insufficient' } } as never, String)).toBeNull();
    expect(acuteChronicSentence({} as never, String)).toBeNull();
    expect(acuteChronicSentence(null, String)).toBeNull();
  });

  it('o painel do treinador mostra o cartao e a tela da aluna usa a frase nos dois blocos de grafico', () => {
    const root = join(__dirname, '..', '..');
    expect(readFileSync(join(root, 'admin', 'app', 'ti', 'explorer.tsx'), 'utf8')).toContain('<AcuteChronicCard');
    expect(readFileSync(join(root, 'mobile', 'home', 'FeelingsDetailScreen.tsx'), 'utf8')).toContain('acuteChronicSentence(snapshot');
    expect(readFileSync(join(root, 'mobile', 'home', 'EvolutionObjective.tsx'), 'utf8')).toContain('acuteChronicSentence(snapshot');
  });
});
