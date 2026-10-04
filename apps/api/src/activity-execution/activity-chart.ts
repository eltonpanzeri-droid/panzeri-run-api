// Serie para os graficos do treino completo (Bloco 1, 04/10/2026). Sai exclusivamente de
// ActivityTimeSeriesPoint. Para caber no mobile, os pontos sao AGREGADOS em baldes (media por balde)
// — agregacao, nao interpolacao: nenhum valor e' criado onde nao houve leitura, e metrica sem leitura
// no balde continua null. Eixo X: distancia quando a serie tem distancia (corrida), senao tempo.

export interface ChartInputPoint {
  offsetSec: number;
  distanceMeters: number | null;
  heartRateBpm: number | null;
  speedKmh: number | null;
  cadenceSpm: number | null;
}

export interface ChartPoint {
  offsetSec: number;
  distanceMeters: number | null;
  heartRateBpm: number | null;
  speedKmh: number | null;
  cadenceSpm: number | null;
}

export interface ChartSeries {
  xAxis: 'distance' | 'time';
  points: ChartPoint[];
}

const MAX_BUCKETS = 300;

function avg(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
}

export function buildChartSeries(points: ChartInputPoint[], maxBuckets = MAX_BUCKETS): ChartSeries {
  const sorted = [...points].sort((a, b) => a.offsetSec - b.offsetSec);
  const distances = sorted.map((p) => p.distanceMeters).filter((v): v is number => v != null);
  const useDistance = distances.length > 1 && Math.max(...distances) > 0;
  const xOf = (p: ChartInputPoint) => (useDistance ? p.distanceMeters : p.offsetSec);

  const withX = sorted.filter((p) => xOf(p) != null);
  if (withX.length === 0) return { xAxis: useDistance ? 'distance' : 'time', points: [] };

  const xMin = xOf(withX[0]) as number;
  const xMax = xOf(withX[withX.length - 1]) as number;
  const span = Math.max(xMax - xMin, 1e-9);
  const bucketCount = Math.min(maxBuckets, withX.length);
  const buckets: ChartInputPoint[][] = Array.from({ length: bucketCount }, () => []);
  for (const p of withX) {
    const idx = Math.min(bucketCount - 1, Math.floor((((xOf(p) as number) - xMin) / span) * bucketCount));
    buckets[idx].push(p);
  }

  const out: ChartPoint[] = [];
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    const hr = avg(bucket.map((p) => p.heartRateBpm).filter((v): v is number => v != null));
    // Velocidade 0 = parado, sem pace definido: fora da media (nunca vira pace infinito).
    const speed = avg(bucket.map((p) => p.speedKmh).filter((v): v is number => v != null && v > 0));
    // Cadencia 0 = sem sinal de movimento, mesma regra da cadencia media.
    const cad = avg(bucket.map((p) => p.cadenceSpm).filter((v): v is number => v != null && v > 0));
    const dist = avg(bucket.map((p) => p.distanceMeters).filter((v): v is number => v != null));
    out.push({
      offsetSec: Math.round(avg(bucket.map((p) => p.offsetSec)) as number),
      distanceMeters: dist != null ? Math.round(dist) : null,
      heartRateBpm: hr != null ? Math.round(hr) : null,
      speedKmh: speed != null ? Math.round(speed * 100) / 100 : null,
      cadenceSpm: cad != null ? Math.round(cad) : null,
    });
  }
  return { xAxis: useDistance ? 'distance' : 'time', points: out };
}
