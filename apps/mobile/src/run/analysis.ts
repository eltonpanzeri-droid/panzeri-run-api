// Parciais por km, melhores trechos e qualidade do GPS de um treino gravado (copiado do Panz Fit, 21/11/2026). Funcoes puras sobre os pontos de GPS; lacunas de sinal sao SINALIZADAS (reliable=false), nunca escondidas.
import { TrackPoint } from './activity';
import { distanceBetween } from './track';

export type Split = { index: number; distanceM: number; elapsedMs: number; paceSecPerKm: number; elevationDeltaM: number | null; reliable: boolean };
export type BestEffort = { label: string; distanceM: number; elapsedMs: number; paceSecPerKm: number; reliable: boolean };

type Sample = TrackPoint & { cumulativeM: number };
const GAP_MS = 15_000;

function samples(points: TrackPoint[]): Sample[] {
  let cumulativeM = 0;
  return points.map((point, index) => {
    if (index) cumulativeM += distanceBetween(points[index - 1], point);
    return { ...point, cumulativeM };
  });
}

function interpolateAt(track: Sample[], distanceM: number) {
  if (!track.length || distanceM < 0 || distanceM > track.at(-1)!.cumulativeM) return null;
  const rightIndex = track.findIndex(point => point.cumulativeM >= distanceM);
  if (rightIndex <= 0) return { timestamp: track[0].timestamp, altitude: track[0].altitude, reliable: true };
  const left = track[rightIndex - 1]; const right = track[rightIndex];
  const span = right.cumulativeM - left.cumulativeM;
  const ratio = span > 0 ? (distanceM - left.cumulativeM) / span : 0;
  const altitude = left.altitude != null && right.altitude != null ? left.altitude + (right.altitude - left.altitude) * ratio : null;
  return { timestamp: left.timestamp + (right.timestamp - left.timestamp) * ratio, altitude, reliable: right.timestamp - left.timestamp <= GAP_MS };
}

function hasGap(track: Sample[], fromM: number, toM: number) {
  return track.some((point, index) => index > 0 && point.cumulativeM >= fromM && track[index - 1].cumulativeM <= toM && point.timestamp - track[index - 1].timestamp > GAP_MS);
}

export function kilometerSplits(points: TrackPoint[]): Split[] {
  const track = samples(points); const total = track.at(-1)?.cumulativeM ?? 0; const result: Split[] = [];
  for (let startM = 0, index = 1; startM < total - 20; startM += 1000, index++) {
    const endM = Math.min(startM + 1000, total); const start = interpolateAt(track, startM); const end = interpolateAt(track, endM);
    if (!start || !end) continue;
    const distanceM = endM - startM; const elapsedMs = Math.max(0, end.timestamp - start.timestamp);
    result.push({ index, distanceM, elapsedMs, paceSecPerKm: elapsedMs / 1000 / (distanceM / 1000), elevationDeltaM: start.altitude != null && end.altitude != null ? Math.round(end.altitude - start.altitude) : null, reliable: start.reliable && end.reliable && !hasGap(track, startM, endM) });
  }
  return result;
}

const EFFORTS = [{ label: '400 m', distanceM: 400 }, { label: '1 km', distanceM: 1000 }, { label: '1 milha', distanceM: 1609.344 }, { label: '5 km', distanceM: 5000 }, { label: '10 km', distanceM: 10000 }];
export function bestEfforts(points: TrackPoint[]): BestEffort[] {
  const track = samples(points); const total = track.at(-1)?.cumulativeM ?? 0;
  return EFFORTS.filter(target => total >= target.distanceM).map(target => {
    let best: BestEffort | null = null;
    for (const candidate of track) {
      const endM = candidate.cumulativeM + target.distanceM; if (endM > total) break;
      const start = interpolateAt(track, candidate.cumulativeM); const end = interpolateAt(track, endM); if (!start || !end) continue;
      const elapsedMs = end.timestamp - start.timestamp; const reliable = !hasGap(track, candidate.cumulativeM, endM);
      if (elapsedMs > 0 && (!best || elapsedMs < best.elapsedMs)) best = { ...target, elapsedMs, paceSecPerKm: elapsedMs / 1000 / (target.distanceM / 1000), reliable };
    }
    return best;
  }).filter((item): item is BestEffort => item != null);
}

export function gpsQuality(points: TrackPoint[]) {
  const gaps = points.slice(1).filter((point, index) => point.timestamp - points[index].timestamp > GAP_MS).length;
  const accuracies = points.map(p => p.accuracy).filter((v): v is number => v != null && Number.isFinite(v));
  const averageAccuracyM = accuracies.length ? accuracies.reduce((sum, v) => sum + v, 0) / accuracies.length : null;
  const score = Math.max(0, Math.round(100 - gaps * 7 - Math.max(0, (averageAccuracyM ?? 35) - 8) * 1.4));
  return { gaps, averageAccuracyM, score, label: score >= 85 ? 'Excelente' : score >= 70 ? 'Boa' : score >= 50 ? 'Atenção' : 'Fraca' };
}
