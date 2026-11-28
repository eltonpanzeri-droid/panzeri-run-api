// Percurso de um treino para o mapa, o cartao de compartilhamento e o replay (21/11/2026). Funcoes PURAS (sem React Native): formatacao do cartao, enquadramento do mapa, posicao no replay e o percurso de um treino
// recem-gravado no celular. O percurso mostra EXATAMENTE de onde a aluna saiu ate onde chegou (decisao de Elton): nenhum trecho e' escondido ou aparado.
import { RecordedPoint, RunState, timerMs } from './engine';

// hr (bpm) e d (distancia acumulada, m) so' existem quando o relogio mandou; ausentes = "--" no replay.
export type RoutePoint = { t: number; lat: number; lon: number; alt: number | null; hr?: number | null; d?: number | null };
export type RouteData = {
  activityLogId: string | null;
  provider: string;
  startedAt: string;
  utcOffsetMinutes: number | null;
  sport: string | null;
  distanceKm: number | null;
  durationSec: number | null;
  avgPaceSecondsKm: number | null;
  elevationGainMeters: number | null;
  // credito que o cartao precisa mostrar quando o fabricante exige ("Garmin [modelo]", Polar); null = nenhum
  attribution: string | null;
  // fonte da coleta do dado ("Garmin Forerunner 265", "Polar", "Panzeri Run"): vai em todo cartao de TREINO como "FONTE: ..."
  sourceLabel?: string | null;
  points: RoutePoint[];
};

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDurationSec(totalSec: number): string {
  const safe = Math.max(0, Math.round(totalSec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export type CardStats = { distance: string; time: string; pace: string; elevation: string; date: string };

// Textos do cartao. Dado que nao existe aparece como "--" (nunca zero inventado). A data e' a do treino NO FUSO do aparelho que gravou (utcOffsetMinutes), nao a de quem compartilha.
export function cardStats(route: RouteData): CardStats {
  const offsetMs = (route.utcOffsetMinutes ?? 0) * 60_000;
  const local = new Date(new Date(route.startedAt).getTime() + offsetMs);
  const valid = Number.isFinite(local.getTime());
  return {
    distance: route.distanceKm !== null ? route.distanceKm.toFixed(2).replace('.', ',') : '--',
    time: route.durationSec !== null ? formatDurationSec(route.durationSec) : '--',
    pace: route.avgPaceSecondsKm !== null ? `${Math.floor(route.avgPaceSecondsKm / 60)}:${pad(route.avgPaceSecondsKm % 60)}/km` : '--',
    elevation: route.elevationGainMeters !== null ? `${Math.round(route.elevationGainMeters)} m` : '--',
    date: valid ? `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}` : '',
  };
}

export type Bounds = { minLat: number; maxLat: number; minLon: number; maxLon: number };
export function boundsOf(points: Array<{ lat: number; lon: number }>): Bounds | null {
  if (points.length === 0) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
  }
  return { minLat, maxLat, minLon, maxLon };
}

// Posicao no replay: fraction 0..1 do tempo do treino. Dentro de uma lacuna de sinal (mais de 15 s entre dois pontos) fica no ultimo ponto conhecido em vez de inventar deslocamento.
export function replayPosition(points: RoutePoint[], fraction: number): { lat: number; lon: number; index: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { lat: points[0].lat, lon: points[0].lon, index: 0 };
  const f = Math.min(1, Math.max(0, fraction));
  const start = points[0].t;
  const total = points[points.length - 1].t - start;
  if (total <= 0) return { lat: points[0].lat, lon: points[0].lon, index: 0 };
  const target = start + f * total;
  for (let i = 1; i < points.length; i += 1) {
    if (target > points[i].t) continue;
    const a = points[i - 1];
    const b = points[i];
    const span = b.t - a.t;
    if (span <= 0 || span > 15) return { lat: a.lat, lon: a.lon, index: i - 1 };
    const ratio = (target - a.t) / span;
    return { lat: a.lat + (b.lat - a.lat) * ratio, lon: a.lon + (b.lon - a.lon) * ratio, index: i - 1 };
  }
  const last = points[points.length - 1];
  return { lat: last.lat, lon: last.lon, index: points.length - 1 };
}

// Relogio do replay (28/11/2026, Elton): em cada instante do replay, o tempo decorrido, a distancia percorrida, o ritmo do momento (ultimos 30 s) e a frequencia cardiaca. Tudo vem dos pontos do treino; o que
// o relogio nao mandou fica null ("--"), nunca inventado. A distancia acaba exatamente na distancia do cartao.
export type ReplayStats = { elapsedSec: number; distanceKm: number | null; paceSecondsKm: number | null; heartRate: number | null };
const EARTH_M = 6_371_000;
const haversine = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad; const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
};
// Distancia acumulada (m) de cada ponto: a do relogio (d) quando todos os pontos a tem; senao soma das coordenadas. Ajustada para terminar na distancia do cartao.
export function cumulativeDistances(route: Pick<RouteData, 'points' | 'distanceKm'>): number[] {
  const pts = route.points;
  const fromDevice = pts.length > 1 && pts.every((p) => typeof p.d === 'number');
  const cum: number[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const raw = fromDevice ? (pts[i].d as number) : (i === 0 ? 0 : cum[i - 1] + haversine(pts[i - 1], pts[i]));
    cum.push(i === 0 ? (fromDevice ? Math.max(0, raw) : 0) : Math.max(cum[i - 1], raw));
  }
  const total = cum[cum.length - 1] ?? 0;
  if (route.distanceKm != null && route.distanceKm > 0 && total > 0) { const factor = (route.distanceKm * 1000) / total; return cum.map((m) => m * factor); }
  return cum;
}
function distanceAt(points: RoutePoint[], cum: number[], target: number): number {
  if (target <= points[0].t) return cum[0];
  for (let i = 1; i < points.length; i += 1) {
    if (target > points[i].t) continue;
    const span = points[i].t - points[i - 1].t;
    return span <= 0 ? cum[i] : cum[i - 1] + ((target - points[i - 1].t) / span) * (cum[i] - cum[i - 1]);
  }
  return cum[cum.length - 1];
}
export function replayStats(route: RouteData, fraction: number): ReplayStats {
  const pts = route.points;
  const empty: ReplayStats = { elapsedSec: 0, distanceKm: null, paceSecondsKm: null, heartRate: null };
  if (pts.length < 2) return empty;
  const f = Math.min(1, Math.max(0, fraction));
  const start = pts[0].t;
  const total = pts[pts.length - 1].t - start;
  if (total <= 0) return empty;
  const target = start + f * total;
  const cum = cumulativeDistances(route);
  const meters = distanceAt(pts, cum, target);
  const windowStart = Math.max(start, target - 30);
  const windowMeters = meters - distanceAt(pts, cum, windowStart);
  const windowSec = target - windowStart;
  const pace = windowSec >= 10 && windowMeters >= 20 ? Math.round(windowSec / (windowMeters / 1000)) : null;
  let heartRate: number | null = null; let best = Infinity;
  for (const p of pts) { if (typeof p.hr !== 'number') continue; const gap = Math.abs(p.t - target); if (gap <= 15 && gap < best) { best = gap; heartRate = p.hr; } }
  return { elapsedSec: f * (route.durationSec ?? total), distanceKm: meters / 1000, paceSecondsKm: pace, heartRate };
}

// Percurso do treino recem-gravado no Panzeri Run (ainda no celular), no mesmo formato do que o servidor devolve.
export function routeFromRecording(state: RunState, points: RecordedPoint[], utcOffsetMinutes: number): RouteData {
  const duration = Math.round(timerMs(state, state.endedAt ?? state.startedAt) / 1000);
  const distanceKm = state.distanceM / 1000;
  return {
    activityLogId: null, provider: 'panzeri_run', startedAt: new Date(state.startedAt).toISOString(), utcOffsetMinutes, sport: 'corrida',
    distanceKm, durationSec: duration, avgPaceSecondsKm: distanceKm > 0.02 && duration > 0 ? Math.round(duration / distanceKm) : null, elevationGainMeters: null, attribution: null, sourceLabel: 'Panzeri Run',
    points: points.map((point) => ({ t: Math.max(0, Math.round((point.timestamp - state.startedAt) / 1000)), lat: point.latitude, lon: point.longitude, alt: point.altitude })),
  };
}

// Desenho do percurso SEM mapa (cartao "sem fundo", celulares sem mapa nativo): projeta as coordenadas numa caixa w x h mantendo a proporcao real (corrige o encolhimento da longitude pela latitude).
export function projectToBox(points: Array<{ lat: number; lon: number }>, width: number, height: number, padding = 12): Array<{ x: number; y: number }> {
  const bounds = boundsOf(points);
  if (!bounds) return [];
  const midLat = ((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180);
  const spanX = Math.max((bounds.maxLon - bounds.minLon) * Math.cos(midLat), 1e-9);
  const spanY = Math.max(bounds.maxLat - bounds.minLat, 1e-9);
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return points.map((p) => ({ x: offsetX + (p.lon - bounds.minLon) * Math.cos(midLat) * scale, y: offsetY + (bounds.maxLat - p.lat) * scale }));
}
