import 'reflect-metadata';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { getVariableDefinition } from '../src/training-intelligence/variable-registry';
import { READING_CATALOG } from '../src/training-intelligence/evolution-reading-catalog';
import { buildAreaSummary, buildIndicatorResult, groupedIndicatorLines } from '../src/training-intelligence/evolution-summary';

// 26/11/2026 — ordem de Elton: a aluna quer saber se esta bem em CADA indicador, como ele esta ficando e o que isso representa para ela
// ("voce esta regular e isso e bom"; "em tendencia de piora, merece atencao"). Series sinteticas, uma observacao por dia.
const math = new MathLayerService();
const entry = (id: string) => READING_CATALOG.find((e) => e.variableId === id)!;
const definition = (id: string) => getVariableDefinition(id)!;
const DAY = 86_400_000;
const START = Date.UTC(2026, 8, 10, 12);
const series = (values: number[]) => values.map((value, i) => ({ value, timestamp: new Date(START + i * DAY) }));
const repeat = (value: number, n: number) => Array.from({ length: n }, () => value);
const result = (id: string, values: number[]) => buildIndicatorResult(entry(id), definition(id), series(values), math);

describe('regularidade do horario de dormir e de acordar', () => {
  it('desvio pequeno (relogio, ate 30 min em media): regular, e isso e bom, com o efeito sobre sono, prontidao, recuperacao e resposta ao treino', () => {
    const r = result('wearable.bedtimeDeviationMin', [5, -10, 12, -8, 3, -15, 9, -4, 7, -6, 10, -12, 4, -3, 8, -9, 6, -5, 11, -7, 2, -2, 9, -8, 5, -6, 4, -3, 7, -9, 3, -4]);
    expect(r.tone).toBe('good');
    expect(r.headline).toBe('você está regular, e isso é bom.');
    expect(r.valueText).toMatch(/^variação média de \d+ min$/);
    expect(r.texts.meaning).toContain('regularidade do horário ajuda a qualidade do sono');
    expect(r.texts.meaning).toContain('resposta aos treinos');
  });
  it('desvio grande: variou bastante, merece atencao, e diz como pode interferir', () => {
    const r = result('wearable.wakeDeviationMin', [60, -75, 90, -50, 45, -80, 70, -65, 55, -90, 80, -60, 50, -70, 65, -85, 75, -55, 60, -95, 85, -45, 70, -60, 80, -75, 55, -65, 90, -50, 60, -70]);
    expect(r.tone).toBe('attention');
    expect(r.headline).toBe('você tem variado bastante, e isso merece atenção.');
    expect(r.texts.meaning).toContain('irregularidade tende a piorar a qualidade do sono');
  });
  it('relato (escala -3 a +3): media do desvio absoluto ate 1 = regular', () => {
    const r = result('workout.bedtimeShiftScore', [0, 1, -1, 0, 0, 1, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1]);
    expect(r.tone).toBe('good');
    expect(r.valueText).toMatch(/^variação média de [0-9,]+ pontos?$/);
  });
});

describe('HRV pela tendencia individual', () => {
  it('subindo em relacao ao proprio padrao: bom sinal', () => {
    const r = result('wearable.hrvLastNightAvg', [...repeat(50, 40), ...repeat(60, 10)]);
    expect(r.tone).toBe('good');
    expect(r.headline).toContain('está bom');
    expect(r.texts.meaning).toContain('boa recuperação');
  });
  it('caindo em relacao ao proprio padrao: merece atencao', () => {
    const r = result('wearable.hrvLastNightAvg', [...repeat(60, 40), ...repeat(45, 10)]);
    expect(r.tone).toBe('attention');
    expect(r.headline).toContain('merece atenção');
  });
  it('estavel: situacao estavel, sem julgar', () => {
    const r = result('wearable.hrvLastNightAvg', repeat(55, 50));
    expect(r.tone).toBe('steady');
  });
});

describe('indicadores sem bom/ruim continuam so acompanhados (nao julgamos fase do sono nem volume)', () => {
  it('sono REM e volume: tom neutro', () => {
    expect(result('wearable.sleepRemMin', [...repeat(90, 40), ...repeat(60, 10)]).tone).toBe('neutral');
    expect(result('training.volumeCompletedTotalKm', repeat(30, 30)).tone).toBe('neutral');
  });
});

describe('o card da area lista cada indicador, agrupado por situacao', () => {
  it('sono: horario, HRV e qualidade aparecem um a um, atencao primeiro (nada de lista unica entre parenteses)', () => {
    const indicators = [
      result('workout.preSleepQuality', repeat(2, 60)),
      result('wearable.bedtimeDeviationMin', repeat(5, 40)),
      result('wearable.hrvLastNightAvg', repeat(55, 50)),
      result('wearable.sleepRemMin', repeat(90, 40)),
    ];
    const lines = groupedIndicatorLines(indicators);
    expect(lines[0]).toBe('Merecem atenção:');
    expect(lines.some((l) => l.startsWith('Qualidade do sono (2): merece atenção'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Horário de dormir (relógio)') && l.includes('você está regular, e isso é bom.'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Variabilidade da frequência cardíaca (HRV) da noite'))).toBe(true);
    expect(lines).toContain('Apenas acompanhados (não são bons nem ruins por si só):');
    const area = buildAreaSummary('sleep', indicators);
    expect(area.guide.howYouAre.join('\n')).not.toContain('Os indicadores que apenas acompanhamos (');
    expect(area.guide.howYouAre).toEqual(expect.arrayContaining(lines));
  });
  it('areas de treinamento e carga tambem listam indicador por indicador', () => {
    const load = buildAreaSummary('load', [result('workout.perceivedEffort', repeat(5, 40))]);
    expect(load.guide.howYouAre).toContain('Apenas acompanhados (não são bons nem ruins por si só):');
    const training = buildAreaSummary('training', [result('training.volumeCompletedTotalKm', repeat(30, 30))]);
    expect(training.guide.howYouAre.some((l) => l.startsWith('Volume semanal realizado'))).toBe(true);
  });
});

describe('o "Como voce esta?" de cada indicador comeca pela situacao', () => {
  it('"Em resumo: ..." vem primeiro', () => {
    const r = result('workout.preMentalFatigue', repeat(1.2, 60));
    expect(r.guide.howYouAre[0]).toMatch(/^Em resumo: está bom/);
  });
});
