import { GPS_ESTIMATE, estimatePointsFromRoute, haversineMeters, type RoutePointInput } from '../src/activity-execution/gps-estimated-pace';

// Ritmo estimado pelo GPS (13/11/2026): trilhas SINTETICAS no equador (1 grau de longitude ~ 111.195 m).
const M_PER_DEG = 111_195;
function track(opts: { seconds: number; step: number; mps: number; noiseM?: number; skip?: (t: number) => boolean; jumpAt?: number }): RoutePointInput[] {
  const out: RoutePointInput[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let t = 0; t <= opts.seconds; t += opts.step) {
    if (opts.skip?.(t)) continue;
    const noise = (opts.noiseM ?? 0) * rnd() * 2;
    const jump = opts.jumpAt !== undefined && t === opts.jumpAt ? 400 : 0;
    out.push({ offsetSec: t, latitude: 0 + (noise / M_PER_DEG) * 0.3, longitude: (opts.mps * t + noise + jump) / M_PER_DEG });
  }
  return out;
}
const paceOf = (kmh: number) => 3600 / kmh;

describe('haversine', () => {
  it('1 grau de longitude no equador ~ 111,2 km', () => {
    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeGreaterThan(111_000);
    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeLessThan(111_400);
  });
});

describe('ritmo estimado pelo GPS', () => {
  it('ritmo constante (4:30/km = 3,7 m/s): distancia acumulada e ritmo batem dentro de 2%', () => {
    const points = estimatePointsFromRoute(track({ seconds: 600, step: 3, mps: 1000 / 270 }))!;
    expect(points).not.toBeNull();
    const last = points[points.length - 1];
    expect(last.distanceMeters).toBeGreaterThan((1000 / 270) * 600 * 0.99);
    expect(last.distanceMeters).toBeLessThan((1000 / 270) * 600 * 1.01);
    const mid = points.find((p) => p.offsetSec === 300)!;
    expect(Math.abs(paceOf(mid.speedKmh!) - 270)).toBeLessThan(270 * 0.02);
    expect(points.every((p) => p.heartRateBpm === null && p.cadenceSpm === null)).toBe(true); // so' ritmo/distancia: nunca FC ou cadencia
  });

  it('calibra a distancia com o total medido pelo relogio quando concorda (ate 25%) e recusa quando nao concorda', () => {
    const route = track({ seconds: 600, step: 3, mps: 3.7 });
    const gps = 3.7 * 600;
    const scaled = estimatePointsFromRoute(route, { measuredTotalMeters: gps * 1.05 })!;
    expect(Math.abs(scaled[scaled.length - 1].distanceMeters - gps * 1.05)).toBeLessThan(3);
    expect(estimatePointsFromRoute(route, { measuredTotalMeters: gps * 1.6 })).toBeNull();
    expect(estimatePointsFromRoute(route, { measuredTotalMeters: gps * 0.5 })).toBeNull();
  });

  it('ruido de GPS (+-4 m): a suavizacao mantem o ritmo medio perto do real e sem picos absurdos', () => {
    const points = estimatePointsFromRoute(track({ seconds: 900, step: 2, mps: 3.5, noiseM: 4 }))!;
    const speeds = points.map((p) => p.speedKmh).filter((v): v is number => v != null);
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    expect(Math.abs(mean - 3.5 * 3.6)).toBeLessThan(0.6);
    expect(Math.max(...speeds)).toBeLessThan(3.5 * 3.6 * 1.6);
  });

  it('salto impossivel de GPS nao soma distancia; pausa/lacuna nao e interpolada (ritmo nulo ali)', () => {
    const jumped = estimatePointsFromRoute(track({ seconds: 300, step: 3, mps: 3, jumpAt: 150 }))!;
    const total = jumped[jumped.length - 1].distanceMeters;
    expect(total).toBeLessThan(3 * 300 * 1.05 + 5); // os 400 m do salto nao entram
    const paused = estimatePointsFromRoute(track({ seconds: 300, step: 3, mps: 3, skip: (t) => t >= 120 && t <= 180 }))!;
    expect(paused.find((p) => p.offsetSec === 150)?.speedKmh ?? null).toBeNull();
    expect(paused.find((p) => p.offsetSec === 60)?.speedKmh).not.toBeNull();
  });

  it('percurso curto ou com poucos pontos nao gera estimativa (nunca inventa)', () => {
    expect(estimatePointsFromRoute(track({ seconds: 40, step: 2, mps: 3 }))).toBeNull();
    expect(estimatePointsFromRoute(track({ seconds: 600, step: 60, mps: 3 }))).toBeNull();
    expect(estimatePointsFromRoute([])).toBeNull();
    expect(estimatePointsFromRoute([{ offsetSec: 0, latitude: 999, longitude: 0 }, ...track({ seconds: 30, step: 1, mps: 0 })])).toBeNull(); // parado: distancia zero
    expect(GPS_ESTIMATE.minPoints).toBeGreaterThan(5);
  });
});
