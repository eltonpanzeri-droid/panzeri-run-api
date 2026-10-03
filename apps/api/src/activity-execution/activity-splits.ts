// Parciais por km derivadas da serie canonica (ActivityTimeSeriesPoint), 03/10/2026. Sem interpolacao:
// cada parcial fecha no PRIMEIRO sample cujo distanceMeters atinge o km seguinte, entao a precisao
// de tempo e' a do intervalo de amostragem (recording-rate). A parcial final (fracionaria) vai do
// ultimo km fechado ate o ultimo sample. FC/cadencia de cada parcial: media dos samples na janela,
// null quando nao houve nenhum (nunca zero). Cadencia 0 = sem sinal de movimento, nao entra.

export interface SeriesPoint {
  offsetSec: number;
  distanceMeters: number | null;
  heartRateBpm: number | null;
  cadenceSpm: number | null;
}

export interface SplitRow {
  kmIndex: number;
  isPartial: boolean;
  distanceKm: number;
  durationSec: number;
  paceSecondsKm: number | null;
  avgHeartRateBpm: number | null;
  avgCadenceSpm: number | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export function buildSplits(points: SeriesPoint[]): SplitRow[] {
  const withDistance = points
    .filter((p) => p.distanceMeters != null)
    .sort((a, b) => a.offsetSec - b.offsetSec);
  if (withDistance.length === 0) return [];

  const splits: SplitRow[] = [];
  let previousOffset = withDistance[0].offsetSec;
  let closedKm = 0;

  const windowStats = (fromExclusive: number, toInclusive: number) => {
    const inWindow = points.filter((p) => p.offsetSec > fromExclusive && p.offsetSec <= toInclusive);
    const hr = inWindow.map((p) => p.heartRateBpm).filter((v): v is number => v != null);
    const cad = inWindow.map((p) => p.cadenceSpm).filter((v): v is number => v != null && v > 0);
    return { avgHeartRateBpm: average(hr), avgCadenceSpm: average(cad) };
  };

  for (const point of withDistance) {
    while ((point.distanceMeters as number) >= (closedKm + 1) * 1000) {
      closedKm++;
      const durationSec = point.offsetSec - previousOffset;
      const stats = windowStats(previousOffset, point.offsetSec);
      splits.push({
        kmIndex: closedKm,
        isPartial: false,
        distanceKm: 1,
        durationSec,
        paceSecondsKm: durationSec > 0 ? durationSec : null,
        ...stats,
      });
      previousOffset = point.offsetSec;
    }
  }

  const last = withDistance[withDistance.length - 1];
  const remainderMeters = (last.distanceMeters as number) - closedKm * 1000;
  if (remainderMeters > 0) {
    const distanceKm = remainderMeters / 1000;
    const durationSec = last.offsetSec - previousOffset;
    splits.push({
      kmIndex: closedKm + 1,
      isPartial: true,
      distanceKm: Math.round(distanceKm * 100) / 100,
      durationSec,
      paceSecondsKm: durationSec > 0 ? Math.round(durationSec / distanceKm) : null,
      ...windowStats(previousOffset, last.offsetSec),
    });
  }

  return splits;
}
