import { buildSplits } from '../src/activity-execution/activity-splits';
import { extractPrescribedSegments } from '../src/activity-execution/prescribed-segments';
import { assignSegments, summarizeSegments } from '../src/activity-execution/activity-segments';
import { buildChartSeries } from '../src/activity-execution/activity-chart';

// Caso real do Bloco 1 (Polar 512122061, 03/10/2026): 30 km prescritos em 2 partes — 24 km a
// 5:25-5:40/km e 6 km a 4:55-5:00/km — executados como 30,08 km. Estrutura no formato REAL gravado
// por TrainingPlansService.runPrescription.
const STRUCTURE = {
  type: 'run',
  blocks: [
    { label: 'Parte 1', distanceValue: 24, distanceUnit: 'km', durationType: 'distance', paceRange: '5:25/km a 5:40/km' },
    { label: 'Parte 2', distanceValue: 6, distanceUnit: 'km', durationType: 'distance', paceRange: '4:55/km a 5:00/km' },
  ],
};

function series() {
  const pts: Array<{ offsetSec: number; distanceMeters: number; heartRateBpm: number; speedKmh: number; cadenceSpm: number }> = [];
  let d = 0;
  for (let t = 0; d < 30080; t++) {
    const fast = d >= 24000;
    const pace = fast ? 298 : 332;
    const speed = 3600 / pace;
    pts.push({ offsetSec: t, distanceMeters: d, heartRateBpm: fast ? 165 : 148, speedKmh: speed, cadenceSpm: fast ? 180 : 172 });
    d += speed / 3.6;
  }
  pts.push({ offsetSec: pts.length, distanceMeters: 30080, heartRateBpm: 165, speedKmh: 12, cadenceSpm: 180 });
  return pts;
}

describe('extractPrescribedSegments', () => {
  it('le 0-24 km e 24-30 km com os paces prescritos, sem hardcode', () => {
    const segs = extractPrescribedSegments(STRUCTURE)!;
    expect(segs.map((s) => [s.startKm, s.endKm])).toEqual([[0, 24], [24, 30]]);
    expect(segs[0]).toMatchObject({ paceFastSecondsKm: 325, paceSlowSecondsKm: 340 });
    expect(segs[1]).toMatchObject({ paceFastSecondsKm: 295, paceSlowSecondsKm: 300 });
  });

  it('funciona para outra prescricao (3 partes 2+10+3 km)', () => {
    const segs = extractPrescribedSegments({ blocks: [
      { label: 'A', distanceValue: 2, distanceUnit: 'km', paceRange: '7:00/km a 7:30/km' },
      { label: 'B', distanceValue: 10, distanceUnit: 'km', paceRange: '5:00/km a 5:10/km' },
      { label: 'C', distanceValue: 3, distanceUnit: 'km', paceRange: '7:00/km a 7:30/km' },
    ] })!;
    expect(segs.map((s) => [s.startKm, s.endKm])).toEqual([[0, 2], [2, 12], [12, 15]]);
  });

  it('bloco intervalado expande repeticoes em km acumulados', () => {
    const step = (label: string, km: number, pace: string) => ({ label, distanceValue: km, distanceUnit: 'km', paceRange: pace });
    const segs = extractPrescribedSegments({ blocks: [
      { label: 'Serie', repeatCount: 2, steps: [step('Tiro', 1, '4:00/km a 4:10/km'), step('Trote', 0.5, '6:00/km a 6:20/km')] },
    ] })!;
    expect(segs.map((s) => [s.startKm, s.endKm])).toEqual([[0, 1], [1, 1.5], [1.5, 2.5], [2.5, 3]]);
  });

  it('estrutura sem distancia em km (por tempo) ou ausente => null (sem agrupamento artificial)', () => {
    expect(extractPrescribedSegments({ blocks: [{ label: 'x', distanceValue: 30, distanceUnit: 'min' }] })).toBeNull();
    expect(extractPrescribedSegments({})).toBeNull();
    expect(extractPrescribedSegments(null)).toBeNull();
  });
});

describe('parciais agrupadas pelas partes prescritas (caso 512122061)', () => {
  const points = series();
  const segs = extractPrescribedSegments(STRUCTURE);
  const splits = assignSegments(buildSplits(points), segs);

  it('30 parciais inteiras + 1 fracionaria de ~0,08 km', () => {
    expect(splits.length).toBe(31);
    expect(splits[30].isPartial).toBe(true);
    expect(splits[30].distanceKm).toBeCloseTo(0.08, 2);
  });

  it('km 1-24 na Parte 1, km 25-30 na Parte 2, excedente fora de qualquer bloco', () => {
    expect(splits.slice(0, 24).every((s) => s.segmentIndex === 0)).toBe(true);
    expect(splits.slice(24, 30).every((s) => s.segmentIndex === 1)).toBe(true);
    expect(splits[30].segmentIndex).toBeNull();
  });

  it('resumo por parte: paces/FC/cadencia realizados objetivos, excedente nao entra no bloco', () => {
    const summary = summarizeSegments(splits, points, segs);
    expect(summary[0].realized!.distanceKm).toBe(24);
    expect(summary[1].realized!.distanceKm).toBe(6);
    expect(summary[0].realized!.paceSecondsKm).toBeGreaterThan(325);
    expect(summary[0].realized!.paceSecondsKm).toBeLessThan(340);
    expect(summary[1].realized!.paceSecondsKm).toBeGreaterThanOrEqual(295);
    expect(summary[1].realized!.paceSecondsKm).toBeLessThanOrEqual(300);
    expect(summary[0].realized!.avgHeartRateBpm).toBe(148);
    expect(summary[1].realized!.avgHeartRateBpm).toBe(165);
    expect(summary[1].realized!.avgCadenceSpm).toBe(180);
  });

  it('sem estrutura compativel: parciais normais, nenhum segmento', () => {
    const plain = assignSegments(buildSplits(points), null);
    expect(plain.every((s) => s.segmentIndex === null)).toBe(true);
    expect(summarizeSegments(plain, points, null)).toEqual([]);
  });
});

describe('buildChartSeries', () => {
  it('serie real de 30 km cabe em <=300 pontos com eixo por distancia', () => {
    const chart = buildChartSeries(series());
    expect(chart.xAxis).toBe('distance');
    expect(chart.points.length).toBeLessThanOrEqual(300);
    expect(chart.points[chart.points.length - 1].distanceMeters!).toBeGreaterThan(29900);
  });

  it('sem distancia usa eixo de tempo', () => {
    const chart = buildChartSeries([
      { offsetSec: 0, distanceMeters: null, heartRateBpm: 100, speedKmh: null, cadenceSpm: null },
      { offsetSec: 5, distanceMeters: null, heartRateBpm: 110, speedKmh: null, cadenceSpm: null },
    ]);
    expect(chart.xAxis).toBe('time');
  });
});
