import { buildSplits } from '../src/activity-execution/activity-splits';
import { extractPrescribedSegments } from '../src/activity-execution/prescribed-segments';
import { assignSegments, summarizeSegments } from '../src/activity-execution/activity-segments';
import { buildChartSeries } from '../src/activity-execution/activity-chart';
import { buildExecutionSummary } from '../src/activity-execution/execution-summary';

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
    const summary = summarizeSegments(points, segs);
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
    expect(summarizeSegments(points, null)).toEqual([]);
  });

  it('parciais (splits) explicitam o pace prescrito do bloco correspondente, lado a lado com o realizado', () => {
    expect(splits[0].prescribedPaceFastSecondsKm).toBe(325);
    expect(splits[0].prescribedPaceSlowSecondsKm).toBe(340);
    expect(splits[0].paceSecondsKm).toBeGreaterThan(325); // realizado, ja existente na propria linha
    expect(splits[24].prescribedPaceFastSecondsKm).toBe(295);
    expect(splits[24].prescribedPaceSlowSecondsKm).toBe(300);
    expect(splits[30].prescribedPaceFastSecondsKm).toBeNull(); // excedente, fora de qualquer bloco
  });

  it('resumo determinístico pos-treino (buildExecutionSummary): diferencas numericas, sem score', () => {
    const summary = buildExecutionSummary({
      prescribedDistanceKm: 30,
      prescribedDurationMin: null,
      realizedDistanceKm: 30.08,
      realizedDurationSec: points[points.length - 1].offsetSec,
      realizedPaceSecondsKm: Math.round(points[points.length - 1].offsetSec / 30.08),
      segments: summarizeSegments(points, segs),
    })!;
    expect(summary.distance).toEqual({ prescribedKm: 30, realizedKm: 30.08, deltaKm: 0.08 });
    expect(summary.duration).toEqual({ prescribedSec: null, realizedSec: points[points.length - 1].offsetSec, deltaSec: null });
    // 2 segmentos (24km + 6km): faixa de pace "geral" fica null de proposito — nao fabrica uma
    // faixa combinada que a prescricao nunca definiu como unica.
    expect(summary.pace.prescribedFastSecondsKm).toBeNull();
    expect(summary.segments).toHaveLength(2);
    expect(summary.segments[0].deltaDistanceKm).toBe(0); // 24 prescrito, 24 realizado
    expect(summary.segments[0].deltaPaceVsFastSecondsKm).toBeGreaterThan(0); // realizado mais lento que o limite rapido
    expect(summary.segments[0].deltaPaceVsSlowSecondsKm).toBeLessThan(0); // realizado mais rapido que o limite lento
  });

  it('sem prescricao nenhuma (link null): buildExecutionSummary retorna null, nunca inventa', () => {
    expect(buildExecutionSummary({
      prescribedDistanceKm: null,
      prescribedDurationMin: null,
      realizedDistanceKm: 10,
      realizedDurationSec: 3000,
      realizedPaceSecondsKm: 300,
      segments: [],
    })).toBeNull();
  });
});

describe('intervalado sub-km (3x400m/200m, generico — sem hardcode de distancia)', () => {
  // Estimulo a 4:05/km (245 s/km), recuperacao a 6:10/km (370 s/km) — repetido 3x. Cada bloco e'
  // menor que 1 km, o caso que motivou summarizeSegments deixar de depender de parciais de 1 km.
  const STRUCTURE_INTERVALS = {
    type: 'run',
    blocks: [
      {
        label: 'Tiros', repeatCount: 3, steps: [
          { label: 'Tiro', distanceValue: 0.4, distanceUnit: 'km', paceRange: '4:00/km a 4:10/km' },
          { label: 'Trote', distanceValue: 0.2, distanceUnit: 'km', paceRange: '6:00/km a 6:20/km' },
        ],
      },
    ],
  };

  function intervalPoints() {
    const plan = [{ km: 0.4, paceSecPerKm: 245, hr: 170 }, { km: 0.2, paceSecPerKm: 370, hr: 140 }];
    const pts: Array<{ offsetSec: number; distanceMeters: number; heartRateBpm: number; cadenceSpm: number }> = [];
    let d = 0;
    let t = 0;
    for (let rep = 0; rep < 3; rep++) {
      for (const seg of plan) {
        const targetD = d + seg.km * 1000;
        const speedMs = 1000 / seg.paceSecPerKm;
        while (d < targetD) {
          pts.push({ offsetSec: t, distanceMeters: Math.round(d), heartRateBpm: seg.hr, cadenceSpm: seg.hr > 150 ? 185 : 170 });
          d += speedMs;
          t += 1;
        }
      }
    }
    pts.push({ offsetSec: t, distanceMeters: Math.round(d), heartRateBpm: 140, cadenceSpm: 170 });
    return pts;
  }

  it('summarizeSegments compara estimulo e recuperacao corretamente, sem misturar os dois no mesmo balde de 1 km', () => {
    const pts = intervalPoints();
    const segs = extractPrescribedSegments(STRUCTURE_INTERVALS)!;
    expect(segs).toHaveLength(6); // 3 repeticoes x (tiro + trote)

    const summary = summarizeSegments(pts, segs);
    // Tiros (indices pares): ~0,4 km reais, pace dentro da faixa prescrita (4:00-4:10/km).
    // Trotes (indices impares): ~0,2 km reais, pace dentro da faixa prescrita (6:00-6:20/km).
    for (let i = 0; i < 6; i += 2) {
      expect(summary[i].realized!.distanceKm).toBeCloseTo(0.4, 1);
      expect(summary[i].realized!.paceSecondsKm).toBeGreaterThanOrEqual(240);
      expect(summary[i].realized!.paceSecondsKm).toBeLessThanOrEqual(250);
      // FC media claramente no patamar do tiro (170), nao misturada com o trote (140) — tolerancia
      // pequena so' pra absorver o sample exatamente na fronteira entre os dois blocos.
      expect(summary[i].realized!.avgHeartRateBpm).toBeGreaterThan(155);
    }
    for (let i = 1; i < 6; i += 2) {
      expect(summary[i].realized!.distanceKm).toBeCloseTo(0.2, 1);
      expect(summary[i].realized!.paceSecondsKm).toBeGreaterThanOrEqual(365);
      expect(summary[i].realized!.paceSecondsKm).toBeLessThanOrEqual(375);
      expect(summary[i].realized!.avgHeartRateBpm).toBeLessThan(155);
    }
  });

  it('buildExecutionSummary por segmento funciona igual para blocos sub-km, sem hardcode de 400/200', () => {
    const pts = intervalPoints();
    const segs = extractPrescribedSegments(STRUCTURE_INTERVALS)!;
    const totalDistanceKm = pts[pts.length - 1].distanceMeters / 1000;
    const summary = buildExecutionSummary({
      prescribedDistanceKm: 1.8,
      prescribedDurationMin: null,
      realizedDistanceKm: totalDistanceKm,
      realizedDurationSec: pts[pts.length - 1].offsetSec,
      realizedPaceSecondsKm: Math.round(pts[pts.length - 1].offsetSec / totalDistanceKm),
      segments: summarizeSegments(pts, segs),
    })!;
    expect(summary.segments).toHaveLength(6);
    expect(summary.segments[0].prescribedDistanceKm).toBe(0.4);
    expect(summary.segments[1].prescribedDistanceKm).toBe(0.2);
    expect(summary.segments[0].deltaPaceVsFastSecondsKm).not.toBeNull();
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
