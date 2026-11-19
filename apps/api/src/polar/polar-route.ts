// Percurso GPS da Polar (19/11/2026, ordem de Elton; a licenca da AccessLink nao proibe GPS, mas exige autorizacao explicita da aluna). PARTE PURA: le o arquivo GPX que a AccessLink devolve
// (GET .../exercises/{id}/gpx) e devolve os pontos prontos para a serie temporal. Nao acessa rede nem banco. Valores fora do mundo real sao descartados; pontos demais sao reduzidos.
export interface PolarRoutePoint { offsetSec: number; latitude: number; longitude: number; elevationMeters: number | null }

export const POLAR_ROUTE_MAX_POINTS = 3000;
const POINT = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
const attr = (attrs: string, name: string): number | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`, 'i').exec(attrs);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
};
const tag = (body: string, name: string): string | null => {
  const match = new RegExp(`<${name}>([^<]+)</${name}>`, 'i').exec(body);
  return match ? match[1].trim() : null;
};

// `startedAt` = inicio da atividade no Panzeri Run; o deslocamento de cada ponto e' contado dele (segundos inteiros, nunca negativo).
export function parsePolarGpx(gpx: string, startedAt: Date): PolarRoutePoint[] {
  if (typeof gpx !== 'string' || gpx.length === 0 || gpx.length > 20_000_000) return [];
  const raw: PolarRoutePoint[] = [];
  for (const match of gpx.matchAll(POINT)) {
    const latitude = attr(match[1], 'lat');
    const longitude = attr(match[1], 'lon');
    const timeText = tag(match[2], 'time');
    const time = timeText ? Date.parse(timeText) : NaN;
    if (latitude === null || longitude === null || !Number.isFinite(time)) continue;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) continue;
    const eleText = tag(match[2], 'ele');
    const ele = eleText === null ? NaN : Number(eleText);
    raw.push({ offsetSec: Math.max(0, Math.round((time - startedAt.getTime()) / 1000)), latitude, longitude, elevationMeters: Number.isFinite(ele) && ele > -500 && ele < 9000 ? ele : null });
  }
  // um ponto por segundo no maximo (o primeiro de cada segundo)
  const seen = new Set<number>();
  const unique = raw.filter((point) => (seen.has(point.offsetSec) ? false : (seen.add(point.offsetSec), true))).sort((a, b) => a.offsetSec - b.offsetSec);
  if (unique.length <= POLAR_ROUTE_MAX_POINTS) return unique;
  const step = unique.length / POLAR_ROUTE_MAX_POINTS;
  const reduced: PolarRoutePoint[] = [];
  for (let i = 0; i < POLAR_ROUTE_MAX_POINTS; i += 1) reduced.push(unique[Math.floor(i * step)]);
  if (reduced[reduced.length - 1] !== unique[unique.length - 1]) reduced[reduced.length - 1] = unique[unique.length - 1];
  return reduced;
}

export const polarRouteEnabled = (env: { get<T = string>(key: string): T | undefined } | NodeJS.ProcessEnv = process.env): boolean => {
  const value = typeof (env as { get?: unknown }).get === 'function' ? (env as { get(key: string): string | undefined }).get('POLAR_ROUTE_ENABLED') : (env as NodeJS.ProcessEnv).POLAR_ROUTE_ENABLED;
  return value?.trim().toLowerCase() === 'true';
};
