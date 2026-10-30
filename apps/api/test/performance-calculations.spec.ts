import { calculateThreeKmMetrics, formatPace } from '../src/fitness-tests/performance-calculations';

describe('performance calculations', () => {
  it('calcula as métricas dos 3 km pelo modelo de Daniels e Gilbert (30/10/2026)', () => {
    const metrics = calculateThreeKmMetrics(1200);

    expect(metrics.vo2maxEstimated).toBe(26.3);
    expect(metrics.vvo2Kmh).toBe(9.35);
    expect(metrics.paceSecondsPerKm).toBe(400);
    expect(formatPace(metrics.paceSecondsPerKm)).toBe('6:40/km');
  });

  it('não usa mais a equação 483/t + 3,5 (3 km em 12:00 dá 47,9, e não 43,8)', () => {
    expect(calculateThreeKmMetrics(720).vo2maxEstimated).toBe(47.9);
  });
});
