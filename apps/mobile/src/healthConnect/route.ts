// Percurso GPS do Health Connect (22/10/2026). Modulo PURO. O Health Connect entrega o trajeto de um exercicio como lista de localizacoes; aqui ele vira pontos compactos
// [deslocamentoSeg desde o inicio do exercicio, latitude, longitude, altitude|null] para o servidor. Nada e' estimado ou suavizado: se passar do limite, so' reduz o NUMERO de
// pontos por amostragem uniforme (mantendo sempre o primeiro e o ultimo).

export const MAX_ROUTE_POINTS = 1200; // ~50 KB: folga sob o limite de ~100 KB do corpo no servidor
export const MAX_ROUTES_PER_POST = 3;
// O modulo nativo devolve o tipo do percurso como TEXTO ("DATA" | "NO_DATA" | "CONSENT_REQUIRED"); aceitamos tambem os numeros do enum do TypeScript (0 | 1 | 2).
export type RouteKind = 'data' | 'consent' | 'none';
export function routeKind(type: unknown): RouteKind {
  if (type === 'DATA' || type === 0) return 'data';
  if (type === 'CONSENT_REQUIRED' || type === 2) return 'consent';
  return 'none';
}

export interface HcLocation { time: string; latitude: number; longitude: number; altitude?: { inMeters?: number } | null }
export interface HcExerciseRoute { type?: string | number; route?: HcLocation[] }
export type RoutePoint = [number, number, number, number | null];
export interface RoutePayload { recordId: string; points: RoutePoint[] }

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

export function buildRoutePayload(recordId: string, sessionStartIso: string, locations: HcLocation[], maxPoints = MAX_ROUTE_POINTS): RoutePayload | null {
  const start = new Date(sessionStartIso).getTime();
  if (!recordId || Number.isNaN(start)) return null;
  const valid: RoutePoint[] = [];
  let last = -1;
  for (const location of [...locations].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())) {
    const t = new Date(location.time).getTime();
    const offset = (t - start) / 1000;
    if (Number.isNaN(t) || offset < 0 || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || offset <= last) continue;
    last = offset;
    const altitude = typeof location.altitude?.inMeters === 'number' && Number.isFinite(location.altitude.inMeters) ? round(location.altitude.inMeters, 1) : null;
    valid.push([round(offset, 1), round(location.latitude, 6), round(location.longitude, 6), altitude]);
  }
  if (valid.length < 2) return null;
  if (valid.length <= maxPoints) return { recordId, points: valid };
  const step = (valid.length - 1) / (maxPoints - 1);
  const picked: RoutePoint[] = [];
  for (let i = 0; i < maxPoints; i += 1) picked.push(valid[Math.round(i * step)]);
  return { recordId, points: picked };
}
