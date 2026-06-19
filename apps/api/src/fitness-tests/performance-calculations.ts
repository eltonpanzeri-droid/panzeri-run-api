export interface ThreeKmMetrics {
  vo2maxEstimated: number;
  vvo2Kmh: number;
  paceSecondsPerKm: number;
}

export function calculateThreeKmMetrics(totalSeconds: number): ThreeKmMetrics {
  const timeMinutes = totalSeconds / 60;
  const vo2maxEstimated = 483 / timeMinutes + 3.5;
  const vvo2Kmh = 3 / (totalSeconds / 3600);
  const paceSecondsPerKm = Math.round(totalSeconds / 3);

  return {
    vo2maxEstimated: round(vo2maxEstimated, 2),
    vvo2Kmh: round(vvo2Kmh, 2),
    paceSecondsPerKm,
  };
}

export function formatPace(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
