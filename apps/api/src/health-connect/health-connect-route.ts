// Percurso GPS do Health Connect (22/10/2026). Fronteira pura: valida o que o app enviou (pontos compactos [deslocamentoSeg, latitude, longitude, altitude|null]) e devolve linhas prontas para
// ActivityTimeSeriesPoint. Localizacao e' dado sensivel: so' e' gravada com a categoria `activity_route` autorizada AGORA pela aluna; nunca vai a IA (GPS e series ficam fora do escopo
// da IA, ver ai-scope) e e' apagada quando a aluna retira a autorizacao. Nada e' estimado: o app so' reduz o numero de pontos (amostragem uniforme) quando passam do limite.

export const MAX_ROUTES_PER_REQUEST = 5;
export const MAX_POINTS_PER_ROUTE = 2500;
const MAX_OFFSET_SEC = 48 * 3600;

export interface NormalizedRoutePoint { offsetSec: number; latitude: number; longitude: number; elevationMeters: number | null }
export interface NormalizedRoute { recordId: string; points: NormalizedRoutePoint[] }
export type NormalizeRoutesResult = { ok: true; routes: NormalizedRoute[]; dropped: number } | { ok: false; reason: string };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function normalizeRoutes(body: unknown): NormalizeRoutesResult {
  const routes = (body as { routes?: unknown } | null)?.routes;
  if (!Array.isArray(routes) || routes.length === 0) return { ok: false, reason: 'lista_vazia' };
  if (routes.length > MAX_ROUTES_PER_REQUEST) return { ok: false, reason: 'rotas_demais' };
  const out: NormalizedRoute[] = [];
  let dropped = 0;
  for (const input of routes) {
    const recordId = typeof (input as { recordId?: unknown })?.recordId === 'string' ? ((input as { recordId: string }).recordId.trim().slice(0, 128)) : '';
    const rawPoints = (input as { points?: unknown })?.points;
    if (!recordId || !Array.isArray(rawPoints) || rawPoints.length === 0 || rawPoints.length > MAX_POINTS_PER_ROUTE) { dropped += 1; continue; }
    const points: NormalizedRoutePoint[] = [];
    let last = -1;
    for (const raw of rawPoints) {
      if (!Array.isArray(raw) || raw.length < 3) continue;
      const [offset, lat, lng, alt] = raw as unknown[];
      if (!finite(offset) || offset < 0 || offset > MAX_OFFSET_SEC || !finite(lat) || lat < -90 || lat > 90 || !finite(lng) || lng < -180 || lng > 180) continue;
      if (offset <= last) continue; // ordem estritamente crescente: pontos repetidos ou fora de ordem sao ignorados
      last = offset;
      points.push({ offsetSec: offset, latitude: lat, longitude: lng, elevationMeters: finite(alt) && alt > -500 && alt < 10_000 ? alt : null });
    }
    if (points.length < 2) { dropped += 1; continue; }
    out.push({ recordId, points });
  }
  if (out.length === 0) return { ok: false, reason: 'nenhuma_rota_valida' };
  return { ok: true, routes: out, dropped };
}
