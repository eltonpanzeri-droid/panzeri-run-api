import { buildSplits, SeriesPoint } from '../src/activity-execution/activity-splits';

// Parciais por km (03/10/2026): sem interpolacao silenciosa, parcial final fracionaria, null nunca zero.

function series(distances: number[], step = 1, extra: Partial<SeriesPoint> = {}): SeriesPoint[] {
  return distances.map((d, i) => ({
    offsetSec: i * step,
    distanceMeters: d,
    heartRateBpm: null,
    cadenceSpm: null,
    ...extra,
  }));
}

describe('buildSplits', () => {
  it('fecha cada km no primeiro sample que atinge o marco, com o tempo do intervalo', () => {
    // 1 m por segundo: km 1 fecha em t=1000s, km 2 em t=2000s
    const points = series(Array.from({ length: 2001 }, (_, i) => i));
    const splits = buildSplits(points);
    expect(splits.filter((s) => !s.isPartial)).toHaveLength(2);
    expect(splits[0]).toMatchObject({ kmIndex: 1, distanceKm: 1, durationSec: 1000, paceSecondsKm: 1000, isPartial: false });
    expect(splits[1]).toMatchObject({ kmIndex: 2, durationSec: 1000, paceSecondsKm: 1000 });
  });

  it('respeita recording-rate diferente de 1s (5s): duracao vem dos offsets reais', () => {
    // 5 s por amostra, 4 m por amostra: km 1 atingido na amostra 250 (offset 1250s)
    const points = series(Array.from({ length: 300 }, (_, i) => i * 4), 5);
    const splits = buildSplits(points);
    expect(splits[0].durationSec).toBe(1250);
    expect(splits[0].paceSecondsKm).toBe(1250);
  });

  it('parcial final fracionaria: distancia real restante e pace derivado de tempo/distancia', () => {
    // termina em 1500 m: 1 km fechado + 0.5 km parcial
    const points = series(Array.from({ length: 1501 }, (_, i) => i));
    const splits = buildSplits(points);
    const partial = splits[splits.length - 1];
    expect(partial.isPartial).toBe(true);
    expect(partial.kmIndex).toBe(2);
    expect(partial.distanceKm).toBe(0.5);
    expect(partial.durationSec).toBe(500);
    expect(partial.paceSecondsKm).toBe(1000);
  });

  it('FC e cadencia por parcial: media da janela; sem nenhum sample vira null, nunca zero', () => {
    const points = series(Array.from({ length: 1001 }, (_, i) => i)).map((p, i) => ({
      ...p,
      heartRateBpm: i > 0 && i <= 1000 ? 150 : null,
      cadenceSpm: null,
    }));
    const splits = buildSplits(points);
    expect(splits[0].avgHeartRateBpm).toBe(150);
    expect(splits[0].avgCadenceSpm).toBeNull(); // nenhum valor de cadencia — null, nao 0
  });

  it('cadencia 0 (sem sinal de movimento) nao entra na media da parcial', () => {
    const points = series(Array.from({ length: 1001 }, (_, i) => i)).map((p, i) => ({
      ...p,
      cadenceSpm: i < 500 ? 0 : 170,
    }));
    const splits = buildSplits(points);
    expect(splits[0].avgCadenceSpm).toBe(170);
  });

  it('sem distancia nenhuma (esteira/forca) devolve lista vazia — nunca parcial inventada', () => {
    const points = series([null as unknown as number, null as unknown as number, null as unknown as number]).map((p) => ({ ...p, distanceMeters: null }));
    expect(buildSplits(points)).toEqual([]);
    expect(buildSplits([])).toEqual([]);
  });
});
