// Ritmo ESTIMADO pelo GPS (13/11/2026, ordem de Elton). Quando o relogio NAO entrega a serie de ritmo/distancia ao longo do treino, mas o percurso (GPS) chegou, a distancia acumulada e o ritmo
// segundo a segundo sao calculados DE FORMA INDIRETA a partir das posicoes. NUNCA e' gravado (calculado na leitura), NUNCA alimenta recordes pessoais nem qualquer indicador alem do grafico e da
// analise da faixa prescrita, e SEMPRE vem marcado como estimado (menos preciso). Funcao PURA: e' a unica matematica desse calculo (uma so', sem copia no app).
export interface RoutePointInput { offsetSec: number; latitude: number; longitude: number }
export interface EstimatedPoint { offsetSec: number; distanceMeters: number; speedKmh: number | null; heartRateBpm: number | null; cadenceSpm: number | null }

export const GPS_ESTIMATE = {
  minPoints: 20,
  minSpanSec: 60,
  // salto de GPS: velocidade acima disso entre dois pontos consecutivos e' descartada (nao conta distancia nem ritmo)
  maxSpeedMps: 12,
  // lacuna (pausa/falha de sinal): acima disso nao se interpola entre dois pontos
  maxGapSec: 15,
  // janela de suavizacao do ritmo (segundos para cada lado do instante)
  smoothingHalfWindowSec: 5,
  // quando ha' distancia medida pelo relogio, o GPS so' e' aceito se concordar com ela dentro desta faixa; dentro dela, a distancia acumulada e' escalada para fechar no total medido
  minRatioToMeasured: 0.8,
  maxRatioToMeasured: 1.25,
} as const;

const EARTH_RADIUS_M = 6_371_000;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;

export function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const valid = (p: RoutePointInput) => Number.isFinite(p.offsetSec) && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

// Devolve um ponto por segundo (offset inteiro) com distancia acumulada e ritmo suavizado, ou null quando o percurso nao permite uma estimativa confiavel
// (poucos pontos, trecho curto, ou distancia do GPS muito diferente da distancia medida pelo relogio).
export function estimatePointsFromRoute(route: RoutePointInput[], options: { measuredTotalMeters?: number | null } = {}): EstimatedPoint[] | null {
  const sorted = route.filter(valid).sort((a, b) => a.offsetSec - b.offsetSec);
  const unique: RoutePointInput[] = [];
  for (const point of sorted) if (unique.length === 0 || point.offsetSec > unique[unique.length - 1].offsetSec) unique.push(point);
  if (unique.length < GPS_ESTIMATE.minPoints) return null;
  if (unique[unique.length - 1].offsetSec - unique[0].offsetSec < GPS_ESTIMATE.minSpanSec) return null;

  // distancia acumulada nos pontos do GPS; segmento com salto impossivel nao soma
  const cumulative: number[] = [0];
  const usable: boolean[] = [true];
  for (let i = 1; i < unique.length; i += 1) {
    const dt = unique[i].offsetSec - unique[i - 1].offsetSec;
    const d = haversineMeters(unique[i - 1], unique[i]);
    const jump = dt > 0 && d / dt > GPS_ESTIMATE.maxSpeedMps;
    cumulative.push(cumulative[i - 1] + (jump ? 0 : d));
    usable.push(!jump && dt <= GPS_ESTIMATE.maxGapSec);
  }
  const gpsTotal = cumulative[cumulative.length - 1];
  if (gpsTotal <= 0) return null;

  // calibracao com a distancia medida pelo relogio (quando existe)
  let scale = 1;
  const measured = options.measuredTotalMeters;
  if (measured != null && Number.isFinite(measured) && measured > 0) {
    const ratio = measured / gpsTotal;
    if (ratio < GPS_ESTIMATE.minRatioToMeasured || ratio > GPS_ESTIMATE.maxRatioToMeasured) return null;
    scale = ratio;
  }

  // distancia por segundo inteiro: interpolacao linear entre pontos vizinhos (so' quando o segmento e' utilizavel)
  const first = Math.ceil(unique[0].offsetSec);
  const last = Math.floor(unique[unique.length - 1].offsetSec);
  const distanceAt = new Map<number, number>();
  const segmentOk = new Map<number, boolean>();
  let cursor = 1;
  for (let second = first; second <= last; second += 1) {
    while (cursor < unique.length - 1 && unique[cursor].offsetSec < second) cursor += 1;
    const a = unique[cursor - 1];
    const b = unique[cursor];
    const span = b.offsetSec - a.offsetSec;
    const t = span > 0 ? (second - a.offsetSec) / span : 0;
    distanceAt.set(second, (cumulative[cursor - 1] + (cumulative[cursor] - cumulative[cursor - 1]) * Math.min(1, Math.max(0, t))) * scale);
    segmentOk.set(second, usable[cursor] === true);
  }

  const half = GPS_ESTIMATE.smoothingHalfWindowSec;
  const points: EstimatedPoint[] = [];
  for (let second = first; second <= last; second += 1) {
    const distance = distanceAt.get(second);
    if (distance === undefined) continue;
    const before = distanceAt.get(second - half);
    const after = distanceAt.get(second + half);
    let speedKmh: number | null = null;
    if (before !== undefined && after !== undefined && segmentOk.get(second) === true) {
      // todo o trecho da janela precisa ser utilizavel (sem lacuna nem salto)
      let clean = true;
      for (let s = second - half; s <= second + half; s += 1) if (segmentOk.get(s) !== true) { clean = false; break; }
      if (clean) speedKmh = Math.round(((after - before) / (2 * half)) * 3.6 * 100) / 100;
    }
    points.push({ offsetSec: second, distanceMeters: Math.round(distance * 10) / 10, speedKmh, heartRateBpm: null, cadenceSpm: null });
  }
  return points.length >= GPS_ESTIMATE.minSpanSec ? points : null;
}
