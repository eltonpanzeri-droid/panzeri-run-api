import { boundsOf, cardStats, formatDurationSec, projectToBox, replayPosition, routeFromRecording, type RouteData, type RoutePoint } from '../../mobile/src/run/route';
import { applyPoints, finishRun, startRun } from '../../mobile/src/run/engine';
import type { TrackPoint } from '../../mobile/src/run/activity';

// 21/11/2026 — cartao de compartilhamento e replay: funcoes puras do percurso.
const base = (over: Partial<RouteData> = {}): RouteData => ({
  activityLogId: 'a1', provider: 'garmin', startedAt: '2026-10-23T22:14:00Z', utcOffsetMinutes: -180, sport: 'corrida', distanceKm: 5.06, durationSec: 1607, avgPaceSecondsKm: 318, elevationGainMeters: 36.4,
  attribution: 'Garmin Forerunner 265', points: [], ...over,
});

describe('textos do cartao', () => {
  it('distancia com virgula, tempo, ritmo, elevacao e a data no fuso de quem gravou', () => {
    expect(cardStats(base())).toEqual({ distance: '5,06', time: '26:47', pace: '5:18/km', elevation: '36 m', date: '23/10/2026' });
  });
  it('a data respeita o fuso do aparelho: treino as 23h30 de Brasilia nao vira o dia seguinte (UTC)', () => {
    expect(cardStats(base({ startedAt: '2026-10-24T02:30:00Z', utcOffsetMinutes: -180 })).date).toBe('23/10/2026');
    expect(cardStats(base({ startedAt: '2026-10-23T22:00:00Z', utcOffsetMinutes: 60 })).date).toBe('23/10/2026');
  });
  it('dado ausente aparece como "--", nunca como zero; horas quando passa de 60 minutos', () => {
    const empty = cardStats(base({ distanceKm: null, durationSec: null, avgPaceSecondsKm: null, elevationGainMeters: null }));
    expect(empty).toMatchObject({ distance: '--', time: '--', pace: '--', elevation: '--' });
    expect(formatDurationSec(3725)).toBe('01:02:05');
    expect(formatDurationSec(59)).toBe('00:59');
    expect(cardStats(base({ startedAt: 'lixo' })).date).toBe('');
  });
});

describe('enquadramento e replay', () => {
  const pts: RoutePoint[] = [{ t: 0, lat: -19.9, lon: -43.9, alt: null }, { t: 10, lat: -19.91, lon: -43.9, alt: null }, { t: 20, lat: -19.91, lon: -43.89, alt: null }];
  it('limites do percurso inteiro (do inicio ao fim, sem aparar)', () => {
    expect(boundsOf(pts)).toEqual({ minLat: -19.91, maxLat: -19.9, minLon: -43.9, maxLon: -43.89 });
    expect(boundsOf([])).toBeNull();
  });
  it('posicao no replay: interpola entre pontos, comeca no primeiro e termina no ultimo', () => {
    expect(replayPosition(pts, 0)).toMatchObject({ lat: -19.9, lon: -43.9, index: 0 });
    expect(replayPosition(pts, 1)).toMatchObject({ lat: -19.91, lon: -43.89 });
    const mid = replayPosition(pts, 0.25)!; // t = 5 s: metade do primeiro trecho
    expect(mid.lat).toBeCloseTo(-19.905, 6);
    expect(replayPosition(pts, -3)).toMatchObject({ lat: -19.9 });
    expect(replayPosition(pts, 7)).toMatchObject({ lat: -19.91, lon: -43.89 });
    expect(replayPosition([], 0.5)).toBeNull();
  });
  it('lacuna de sinal no replay: nao inventa deslocamento (fica no ultimo ponto conhecido)', () => {
    const gap: RoutePoint[] = [{ t: 0, lat: -19.9, lon: -43.9, alt: null }, { t: 100, lat: -19.95, lon: -43.9, alt: null }];
    expect(replayPosition(gap, 0.5)).toMatchObject({ lat: -19.9 });
  });
});

describe('percurso do treino recem-gravado', () => {
  it('monta o mesmo formato do servidor, do primeiro ao ultimo ponto gravado', () => {
    const T0 = Date.parse('2026-11-21T09:00:00Z');
    const pts: TrackPoint[] = Array.from({ length: 30 }, (_, i) => ({ latitude: -19.93 + i * 3.7e-5, longitude: -44.05, altitude: 800, accuracy: 5, speed: 3, timestamp: T0 + i * 4000 }));
    const r = applyPoints(startRun({ runId: 'r1', now: T0 }), pts, T0 + 120_000);
    const done = finishRun(r.state, T0 + 120_000).state;
    const route = routeFromRecording(done, r.accepted, -180);
    expect(route).toMatchObject({ activityLogId: null, provider: 'panzeri_run', attribution: null, utcOffsetMinutes: -180 });
    expect(route.points).toHaveLength(30);
    expect(route.points[0].t).toBe(0);
    expect(route.points[29].t).toBe(116);
    expect(route.distanceKm).toBeGreaterThan(0.1);
    expect(route.avgPaceSecondsKm).toBeGreaterThan(0);
    expect(cardStats(route).date).toBe('21/11/2026');
  });
});

describe('desenho do percurso sem mapa', () => {
  it('cabe na caixa, mantem a proporcao e o norte para cima (latitude maior = y menor)', () => {
    const pts = [{ lat: -19.90, lon: -43.90 }, { lat: -19.91, lon: -43.90 }, { lat: -19.91, lon: -43.89 }];
    const out = projectToBox(pts, 300, 200, 10);
    for (const p of out) { expect(p.x).toBeGreaterThanOrEqual(9.999); expect(p.x).toBeLessThanOrEqual(290.001); expect(p.y).toBeGreaterThanOrEqual(9.999); expect(p.y).toBeLessThanOrEqual(190.001); }
    expect(out[0].y).toBeLessThan(out[1].y); // norte em cima
    expect(out[2].x).toBeGreaterThan(out[1].x); // leste a direita
    // proporcao: 0,01 grau de latitude x ~0,0094 de longitude (cos da latitude) -> quase quadrado
    const w = out[2].x - out[1].x; const h = out[1].y - out[0].y;
    expect(w / h).toBeGreaterThan(0.9);
    expect(w / h).toBeLessThan(1.0);
  });
  it('um ponto so ou lista vazia nao quebra', () => {
    expect(projectToBox([], 100, 100)).toEqual([]);
    const one = projectToBox([{ lat: -19.9, lon: -43.9 }], 100, 100);
    expect(one).toHaveLength(1);
    expect(Number.isFinite(one[0].x)).toBe(true);
  });
});
