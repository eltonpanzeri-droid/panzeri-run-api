import { DuplicateScanRow, findSameObserverDuplicates } from '../src/activity-execution/same-observer-duplicates';

// 02/11/2026 — simulacao so' de leitura das copias do mesmo app (usa o mesmo comparador da identidade fisica).
const GARMIN = { source: { bundleId: 'com.garmin.connect.mobile', name: 'Connect' } };
const APPLE = { source: { bundleId: 'com.apple.health.ABC', name: 'Treino' } };

function r(id: string, start: string, over: Partial<DuplicateScanRow> = {}): DuplicateScanRow {
  return {
    id, userId: 'u', provider: 'apple_health', providerMetrics: GARMIN, sport: 'corrida', startedAt: new Date(start), durationSec: 2512, distanceMeters: 7010,
    caloriesKcal: 378, avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: 25, hasRoute: false, physicalIdentityStatus: 'unique', ...over,
  };
}

describe('findSameObserverDuplicates', () => {
  it('semana da Ju: 5,54 km (esteira) e 7,01 km (corrida) duplicados -> 2 grupos, 12,55 km a mais, vence a copia com FC', () => {
    const scan = findSameObserverDuplicates([
      r('c1', '2026-10-27T20:49:23Z', { durationSec: 2107, distanceMeters: 6010, avgHeartRateBpm: 130 }),
      r('e1', '2026-10-29T20:48:25Z', { sport: 'esteira', durationSec: 2007, distanceMeters: 5540 }),
      r('e2', '2026-10-29T20:48:25Z', { sport: 'esteira', durationSec: 2007, distanceMeters: 5540, avgHeartRateBpm: 140 }),
      r('c2', '2026-10-31T11:31:05Z', { distanceMeters: 7010 }),
      r('c3', '2026-10-31T11:31:05Z', { distanceMeters: 7010, avgHeartRateBpm: 132 }),
    ]);
    expect(scan.groups).toHaveLength(2);
    expect(scan.groups.map((g) => g.canonicalActivityLogId)).toEqual(['e2', 'c3']);
    expect(scan.groups.reduce((sum, g) => sum + (g.inflatedKm ?? 0), 0)).toBeCloseTo(12.55, 2);
    expect(scan.nearMisses).toEqual([]);
  });

  it('forca: tres copias -> um grupo de 3; km nao soma (nao e corrida)', () => {
    const base = { sport: 'forca', distanceMeters: 0, durationSec: 3326 };
    const scan = findSameObserverDuplicates([r('f1', '2026-10-29T10:40:15Z', base), r('f2', '2026-10-29T10:40:15Z', base), r('f3', '2026-10-29T10:40:15Z', { ...base, avgHeartRateBpm: 95 })]);
    expect(scan.groups).toHaveLength(1);
    expect(scan.groups[0].members).toHaveLength(3);
    expect(scan.groups[0].canonicalActivityLogId).toBe('f3');
    expect(scan.groups[0].inflatedKm).toBeNull();
  });

  it('apps de origem diferentes, usuarios diferentes e horarios diferentes nunca viram grupo desta simulacao', () => {
    const scan = findSameObserverDuplicates([
      r('a', '2026-10-31T11:31:05Z'),
      r('b', '2026-10-31T11:31:05Z', { providerMetrics: APPLE }),
      r('c', '2026-10-31T11:31:05Z', { userId: 'v' }),
      r('d', '2026-10-31T18:00:00Z'),
    ]);
    expect(scan.groups).toEqual([]);
  });

  it('quase iguais (mesmo app, inicio 30 s depois): NAO agrupa, so aparece na lista de quase', () => {
    const scan = findSameObserverDuplicates([r('a', '2026-10-31T11:31:05Z'), r('b', '2026-10-31T11:31:35Z')]);
    expect(scan.groups).toEqual([]);
    expect(scan.nearMisses).toEqual([expect.objectContaining({ activityLogIds: ['a', 'b'], startDiffSec: 30 })]);
  });

  it('corridas seguidas (fim de uma = inicio da outra, fora da janela) nao aparecem nem como quase', () => {
    const scan = findSameObserverDuplicates([r('a', '2026-10-31T11:00:00Z', { durationSec: 1800 }), r('b', '2026-10-31T11:30:00Z', { durationSec: 1800 })]);
    expect(scan).toEqual({ groups: [], nearMisses: [] });
  });
});
