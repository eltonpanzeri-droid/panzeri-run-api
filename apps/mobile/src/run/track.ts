// Metricas de GPS do treino gravado no Panzeri Run (copiado do Panz Fit, 21/11/2026): distancia, filtro de pontos, ritmo atual, qualidade do sinal, altimetria, trechos e interpolacao. Funcoes puras.
import { TrackPoint } from './activity';

const EARTH_RADIUS_M = 6_371_000;

export function distanceBetween(a: TrackPoint, b: TrackPoint) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const lat1 = a.latitude * rad;
  const lat2 = b.latitude * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Direção (0-360°, 0 = norte) do ponto a até o ponto b. Usada para orientar a
 * câmera no sobrevoo 3D no mesmo sentido em que o atleta correu.
 */
export function bearingBetween(a: Pick<TrackPoint, 'latitude' | 'longitude'>, b: Pick<TrackPoint, 'latitude' | 'longitude'>) {
  const rad = Math.PI / 180;
  const lat1 = a.latitude * rad;
  const lat2 = b.latitude * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const degrees = Math.atan2(y, x) * (180 / Math.PI);
  return (degrees + 360) % 360;
}

export function shouldAcceptPoint(previous: TrackPoint | undefined, next: TrackPoint) {
  if ((next.accuracy ?? 999) > 50) return false;
  if (!previous) return true;
  const dt = (next.timestamp - previous.timestamp) / 1000;
  if (dt <= 0) return false;
  const distance = distanceBetween(previous, next);
  if (distance < 2 && dt < 8) return false;
  return distance / dt <= 12;
}

export function normalizeTrack(points: TrackPoint[]) {
  return points.reduce<{ points: TrackPoint[]; distanceM: number }>((result, point) => {
    const previous = result.points.at(-1);
    if (!shouldAcceptPoint(previous, point)) return result;
    return {
      points: [...result.points, point],
      distanceM: result.distanceM + (previous ? distanceBetween(previous, point) : 0),
    };
  }, { points: [], distanceM: 0 });
}

export const formatDuration = (milliseconds: number) => {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const formatPace = (distanceM: number, elapsedMs: number) => {
  if (distanceM < 20 || elapsedMs <= 0) return '--:--';
  const secondsPerKm = Math.round((elapsedMs / 1000) / (distanceM / 1000));
  return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, '0')}`;
};

export function currentSpeedMps(points: TrackPoint[], now: number, windowMs = 15_000) {
  const latest = points.at(-1);
  if (!latest || now - latest.timestamp > 4_000) return 0;
  if (latest.speed != null && latest.speed >= 0 && latest.accuracy != null && latest.accuracy <= 25) {
    return latest.speed < 0.45 ? 0 : latest.speed;
  }
  const recent = points.filter((point) => latest.timestamp - point.timestamp <= windowMs);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const seconds = (latest.timestamp - first.timestamp) / 1000;
  if (seconds <= 0) return 0;
  const speed = distanceBetween(first, latest) / seconds;
  return speed < 0.45 ? 0 : speed;
}

export function formatCurrentPace(points: TrackPoint[], now: number) {
  const speed = currentSpeedMps(points, now);
  if (speed <= 0) return '--:--';
  const secondsPerKm = Math.round(1000 / speed);
  if (secondsPerKm > 3600) return '--:--';
  return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, '0')}`;
}

export function gpsSignal(accuracy: number | null | undefined, pointTimestamp: number | undefined, now: number) {
  if (accuracy == null || pointTimestamp == null || now - pointTimestamp > 10_000) return { label: 'BUSCANDO GPS', level: 'waiting' as const };
  if (accuracy <= 10) return { label: 'GPS EXCELENTE', level: 'excellent' as const };
  if (accuracy <= 20) return { label: 'GPS BOM', level: 'good' as const };
  if (accuracy <= 35) return { label: 'GPS FRACO', level: 'weak' as const };
  return { label: 'GPS INSTÁVEL', level: 'weak' as const };
}

export function elevationGain(points: TrackPoint[]) {
  let gain = 0;
  let previous: number | null = null;
  for (const point of points) {
    if (point.altitude == null || (point.accuracy ?? 999) > 30) continue;
    if (previous != null) {
      const delta = point.altitude - previous;
      if (delta >= 1.5 && delta <= 20) gain += delta;
    }
    previous = point.altitude;
  }
  return Math.round(gain);
}

// Mesmo limite usado por gpsQuality (src/domain/analysis.ts) para contar lacunas.
export const ROUTE_GAP_MS = 15_000;

/**
 * Divide a trilha em trechos contínuos, cortando sempre que o intervalo entre dois
 * pontos consecutivos ultrapassa ROUTE_GAP_MS. Cada corte é uma lacuna real de sinal
 * (segundo plano indisponível, prédios, túnel, pausa) — desenhar uma linha reta sobre
 * essa lacuna faria parecer que o GPS mediu um trajeto que na verdade não registrou.
 */
export function splitIntoSegments(points: TrackPoint[], gapMs = ROUTE_GAP_MS): TrackPoint[][] {
  if (!points.length) return [];
  const segments: TrackPoint[][] = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const point = points[i];
    if (point.timestamp - previous.timestamp > gapMs) segments.push([point]);
    else segments[segments.length - 1].push(point);
  }
  return segments;
}

/**
 * Interpola a posição geográfica da trilha num instante decorrido desde o primeiro
 * ponto (em ms). Usado para animar o replay do percurso. Dentro de uma lacuna maior
 * que ROUTE_GAP_MS, mantém a última posição conhecida em vez de inventar um
 * deslocamento contínuo entre dois pontos distantes no tempo.
 */
export function interpolatePosition(points: TrackPoint[], elapsedMs: number): { latitude: number; longitude: number } | null {
  if (!points.length) return null;
  const targetTs = points[0].timestamp + Math.max(0, elapsedMs);
  const first = points[0];
  if (targetTs <= first.timestamp) return { latitude: first.latitude, longitude: first.longitude };
  const last = points[points.length - 1];
  if (targetTs >= last.timestamp) return { latitude: last.latitude, longitude: last.longitude };
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const point = points[i];
    if (targetTs > point.timestamp) continue;
    const span = point.timestamp - previous.timestamp;
    if (span <= 0 || span > ROUTE_GAP_MS) return { latitude: previous.latitude, longitude: previous.longitude };
    const ratio = (targetTs - previous.timestamp) / span;
    return {
      latitude: previous.latitude + (point.latitude - previous.latitude) * ratio,
      longitude: previous.longitude + (point.longitude - previous.longitude) * ratio,
    };
  }
  return { latitude: last.latitude, longitude: last.longitude };
}
