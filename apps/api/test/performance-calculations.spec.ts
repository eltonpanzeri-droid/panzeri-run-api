import { calculateThreeKmMetrics, formatPace } from '../src/fitness-tests/performance-calculations';

describe('performance calculations', () => {
  it('calculates 3km metrics from total seconds', () => {
    const metrics = calculateThreeKmMetrics(1200);

    expect(metrics.vo2maxEstimated).toBe(27.65);
    expect(metrics.vvo2Kmh).toBe(9);
    expect(metrics.paceSecondsPerKm).toBe(400);
    expect(formatPace(metrics.paceSecondsPerKm)).toBe('6:40/km');
  });
});
