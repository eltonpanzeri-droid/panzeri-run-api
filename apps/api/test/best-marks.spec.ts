import { bestSegmentSeconds, candidateFor, computeBestMarks, MARK_DISTANCES, MarkActivity, selfReportedRuns, SeriesPoint } from '../src/best-marks/best-marks';

// 09/11/2026 — Melhores marcas (Lote 1): regras de Elton. Serie sintetica: 1 ponto a cada 10 s, ritmo constante (m/s).
function series(totalMeters: number, speedMps: number, opts: { pauseAtMeters?: number; pauseSec?: number; step?: number } = {}): SeriesPoint[] {
  const step = opts.step ?? 10;
  const points: SeriesPoint[] = [];
  let t = 0;
  let d = 0;
  let paused = false;
  while (true) {
    points.push({ offsetSec: t, distanceMeters: d });
    const remaining = totalMeters - d;
    if (remaining <= speedMps * step + 1e-9) { points.push({ offsetSec: t + remaining / speedMps, distanceMeters: totalMeters }); break; }
    t += step;
    d += speedMps * step;
    if (!paused && opts.pauseAtMeters !== undefined && d >= opts.pauseAtMeters) { t += opts.pauseSec ?? 300; paused = true; }
  }
  return points;
}
const act = (over: Partial<MarkActivity>): MarkActivity => ({ id: 'a', source: 'device', provider: 'zepp', startedAt: new Date('2026-10-01T10:00:00Z'), localDate: '2026-10-01', distanceMeters: null, durationSec: null, series: [], ...over });
const dist = (id: string) => MARK_DISTANCES.find((d) => d.id === id)!;

describe('lista de distancias', () => {
  it('tem as 15 marcas, em ordem de distancia, com 5/10/15 milhas corretas', () => {
    expect(MARK_DISTANCES.map((d) => d.id)).toEqual(['1km', '3km', '5km', '5mi', '10km', '15km', '16km', '10mi', 'half', '15mi', '30km', 'marathon', '50km', '60km', '75km']);
    expect(Math.round(dist('10mi').meters)).toBe(16093);
    expect(dist('half').meters).toBe(21097.5);
    expect(dist('marathon').meters).toBe(42195);
  });
});

describe('corrida inteira: tempo TOTAL, sem tolerancia', () => {
  it('10 km em 65 min (com 5 min de pausa) = 65 min, pace 6:30, e NAO 60 min', () => {
    const pts = series(10000, 10000 / 3600, { pauseAtMeters: 5000, pauseSec: 300 }); // 60 min andando + 5 min pausado = 65 min de relogio
    const mark = candidateFor(act({ distanceMeters: 10000, durationSec: 3600, series: pts }), dist('10km'))!;
    expect(mark.method).toBe('whole');
    expect(mark.seconds).toBe(3900);
    expect(mark.paceSecondsKm).toBe(390);
    expect(mark.timeBasis).toBe('series_clock');
  });
  it('sem serie usa a duracao informada e marca timeBasis=duration', () => {
    const mark = candidateFor(act({ distanceMeters: 10000, durationSec: 3900 }), dist('10km'))!;
    expect(mark).toMatchObject({ seconds: 3900, method: 'whole', timeBasis: 'duration' });
  });
  it('menor que a distancia NAO conta; igual ou maior conta (qualquer fonte)', () => {
    expect(candidateFor(act({ distanceMeters: 4950, durationSec: 1500 }), dist('5km'))).toBeNull();
    expect(candidateFor(act({ distanceMeters: 5000, durationSec: 1500 }), dist('5km'))).toMatchObject({ seconds: 1500, extraMeters: 0 });
    for (const source of ['device', 'manual', 'test'] as const) {
      expect(candidateFor(act({ source, distanceMeters: 4999, durationSec: 1500 }), dist('5km'))).toBeNull();
      expect(candidateFor(act({ source, distanceMeters: 5010, durationSec: 1500 }), dist('5km'))).toMatchObject({ seconds: 1500, extraMeters: 10 });
    }
  });
  it('corrida maior sem serie: vale o tempo da corrida TODA (limite superior), com o excesso registrado e o pace da corrida', () => {
    const mark = candidateFor(act({ source: 'manual', provider: null, distanceMeters: 12000, durationSec: 3600 }), dist('10km'))!;
    expect(mark).toMatchObject({ method: 'whole', seconds: 3600, extraMeters: 2000, paceSecondsKm: 300 });
  });
  it('meia maratona digitada a mao: 21,1 km conta; 21,097 km (ao metro) conta; 21,09 km nao', () => {
    const half = dist('half');
    expect(candidateFor(act({ source: 'manual', provider: null, distanceMeters: 21100, durationSec: 5854 }), half)).toMatchObject({ seconds: 5854 });
    expect(candidateFor(act({ source: 'manual', provider: null, distanceMeters: 21097, durationSec: 5854 }), half)).not.toBeNull();
    expect(candidateFor(act({ source: 'manual', provider: null, distanceMeters: 21090, durationSec: 5854 }), half)).toBeNull();
  });
  it('corrida maior com serie usa o trecho exato quando ele e menor que a corrida toda', () => {
    const pts = series(12000, 3, { step: 5 });
    const mark = candidateFor(act({ distanceMeters: 12000, durationSec: 4000, series: pts }), dist('5km'))!;
    expect(mark.method).toBe('segment');
    expect(mark.seconds).toBeLessThan(1675);
    expect(mark.extraMeters).toBe(0);
    expect(mark.runMeters).toBe(12000);
    expect(mark.windowStartMeters).not.toBeNull();
    expect((mark.windowEndMeters as number) - (mark.windowStartMeters as number)).toBe(5000);
    expect(mark.localDate).toBe('2026-10-01');
  });
});

describe('trecho dentro de uma corrida maior (serie do relogio)', () => {
  it('acha o melhor 5 km dentro de 12 km, com tempo de relogio do trecho', () => {
    const pts = series(12000, 3, { step: 5 }); // 3 m/s => 5 km em 1667 s
    const best = bestSegmentSeconds(pts, 5000)!;
    expect(best).toBeGreaterThan(1660);
    expect(best).toBeLessThan(1675);
  });
  it('trecho que atravessa a pausa do relogio NAO conta; trecho sem pausa conta', () => {
    const pts = series(12000, 3, { pauseAtMeters: 6000, pauseSec: 400, step: 5 });
    const seconds = bestSegmentSeconds(pts, 5000)!;
    expect(seconds).toBeLessThan(1700); // um 5 km inteiro antes ou depois da pausa, sem os 400 s
    expect(bestSegmentSeconds(pts, 10000)).toBeNull(); // todo 10 km de uma corrida de 12 km atravessa a pausa
  });
  it('andar conta como tempo: trecho com parte lenta e valido e usa o tempo todo', () => {
    const slow = series(3000, 1, { step: 5 }); // 1 m/s = andando
    expect(bestSegmentSeconds(slow, 3000)).toBeGreaterThan(2900);
  });
  it('corrida mais curta que a distancia, ou sem serie, nao gera trecho', () => {
    expect(bestSegmentSeconds(series(4000, 3, { step: 5 }), 5000)).toBeNull();
    expect(bestSegmentSeconds([], 5000)).toBeNull();
  });
  it('trecho so vale para atividade do relogio; manual e teste nao geram trecho', () => {
    const pts = series(12000, 3, { step: 5 });
    expect(candidateFor(act({ source: 'manual', distanceMeters: 12000, durationSec: 4000, series: pts }), dist('5km'))).toMatchObject({ method: 'whole', source: 'manual', extraMeters: 7000 }); // manual nunca gera trecho: so' o tempo da corrida toda
  });
});

describe('ranking, manual, teste e relato', () => {
  it('uma atividade gera no maximo uma marca por distancia e o ranking vem do menor tempo', () => {
    const a = act({ id: 'lenta', distanceMeters: 5000, durationSec: 1800 });
    const b = act({ id: 'rapida', distanceMeters: 5000, durationSec: 1500, startedAt: new Date('2026-10-05T10:00:00Z') });
    const m = computeBestMarks([a, b]).find((x) => x.distanceId === '5km')!;
    expect(m.ranking.map((r) => r.activityId)).toEqual(['rapida', 'lenta']);
    expect(m.best?.seconds).toBe(1500);
  });
  it('registro manual e teste de 3 km entram, com a origem etiquetada', () => {
    const manual = act({ id: 'manual:1', source: 'manual', provider: null, distanceMeters: 10000, durationSec: 3300 });
    const test = act({ id: 'test:1', source: 'test', provider: null, distanceMeters: 3000, durationSec: 780 });
    const marks = computeBestMarks([manual, test]);
    expect(marks.find((x) => x.distanceId === '10km')!.best).toMatchObject({ source: 'manual', seconds: 3300 });
    expect(marks.find((x) => x.distanceId === '3km')!.best).toMatchObject({ source: 'test', seconds: 780 });
  });
  it('distancia sem nenhuma marca fica vazia (nunca zero)', () => {
    const m = computeBestMarks([]).find((x) => x.distanceId === '75km')!;
    expect(m.best).toBeNull();
    expect(m.ranking).toEqual([]);
  });
  it('relato da entrevista: 3 maiores distancias, tempo so na primeira, nunca entra nas marcas', () => {
    const runs = selfReportedRuns({ longest_distance: 21, longest_distance_recent_count: 2, longest_distance_recent_time: '1:50:30', second_longest_distance_recent: '16', second_longest_distance_recent_count: 3, third_longest_distance_recent: 0 });
    expect(runs).toEqual([
      { rank: 1, distanceKm: 21, distanceRaw: null, timesRun: 2, timeSeconds: 6630 },
      { rank: 2, distanceKm: 16, distanceRaw: null, timesRun: 3, timeSeconds: null },
    ]);
    expect(computeBestMarks([]).every((m) => m.best === null)).toBe(true);
  });
  it('resposta em faixa (texto) e preservada como veio e tempo invalido vira null', () => {
    const runs = selfReportedRuns({ longest_distance: 'entre_10_e_15', longest_distance_recent_time: '99:99' });
    expect(runs[0]).toMatchObject({ distanceKm: null, distanceRaw: 'entre_10_e_15', timeSeconds: null });
  });
});
