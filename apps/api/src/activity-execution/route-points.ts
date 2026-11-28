// Percurso de uma atividade para o mapa e o cartao de compartilhamento (21/11/2026). Funcao PURA: descarta coordenadas invalidas e reduz a quantidade de pontos por amostragem uniforme, mantendo sempre o primeiro
// e o ultimo (o mapa mostra EXATAMENTE de onde a aluna saiu ate onde chegou: decisao de Elton, nenhum trecho e' escondido). Nao altera o que foi gravado.
export interface RoutePointRow { offsetSec: number; latitude: number | null; longitude: number | null; elevationMeters: number | null; heartRateBpm?: number | null; distanceMeters?: number | null }
// hr = frequencia cardiaca do ponto (bpm) e d = distancia acumulada (m), quando o relogio mandou; null quando nao existe (nunca zero inventado). Servem ao relogio do replay.
export interface RoutePoint { t: number; lat: number; lon: number; alt: number | null; hr: number | null; d: number | null }

export const ROUTE_MAX_POINTS = 900;

export function simplifyRoute(rows: RoutePointRow[], max: number = ROUTE_MAX_POINTS): RoutePoint[] {
  const valid = rows
    .filter((row) => typeof row.latitude === 'number' && typeof row.longitude === 'number' && Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && Math.abs(row.latitude) <= 90 && Math.abs(row.longitude) <= 180 && !(row.latitude === 0 && row.longitude === 0))
    .map((row) => ({ t: row.offsetSec, lat: row.latitude as number, lon: row.longitude as number, alt: row.elevationMeters !== null && Number.isFinite(row.elevationMeters) ? Math.round(row.elevationMeters * 10) / 10 : null,
      hr: row.heartRateBpm != null && Number.isFinite(row.heartRateBpm) && row.heartRateBpm >= 30 && row.heartRateBpm <= 250 ? Math.round(row.heartRateBpm) : null,
      d: row.distanceMeters != null && Number.isFinite(row.distanceMeters) && row.distanceMeters >= 0 ? Math.round(row.distanceMeters) : null }));
  if (valid.length <= max || max < 2) return max < 2 ? valid.slice(0, 1) : valid;
  const step = (valid.length - 1) / (max - 1);
  const reduced: RoutePoint[] = [];
  for (let i = 0; i < max; i += 1) reduced.push(valid[Math.round(i * step)]);
  return reduced;
}
