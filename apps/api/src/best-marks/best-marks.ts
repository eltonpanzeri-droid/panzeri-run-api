// Melhores marcas (09/11/2026, Elton): marcas da aluna por distancia, calculadas SOMENTE de dados registrados. Modulo PURO (sem banco): recebe atividades/series e devolve fatos.
// Nao interpreta, nao classifica e nao diz se a marca e' boa ou ruim; e' dado derivado, recalculado a cada leitura (nada e' guardado como texto).
//
// REGRAS (decididas por Elton em 09/11/2026):
//  - Qualquer fonte (relogio, manual, teste): corrida MENOR que a distancia NAO conta (4,95 km nao vale como 5 km); IGUAL OU MAIOR conta (ordem de Elton, 09/11/2026). "Igual" = arredondado ao
//    metro (21.097 m e 21.098 m contam como meia, de 21.097,5 m).
//  - Corrida INTEIRA: vale o tempo TOTAL da atividade (10 km em 65 min = 6:30/km, nunca 6:00), mesmo com o relogio pausado. Se a corrida e' MAIOR que D e nao ha serie, o tempo e' o da corrida
//    toda (um limite superior: percorrer D levou no maximo isso) e a marca carrega `extraMeters` para a tela avisar "tempo da corrida inteira de X km".
//  - TRECHO dentro de uma corrida maior (so' com a serie do relogio): vale o tempo corrido de relogio do trecho, e o relogio NAO pode ter sido pausado dentro dele. Andar conta como tempo.
//  - Registro manual conta, sempre etiquetado como manual. O teste de 3 km conta (origem "teste").

export interface MarkDistance { id: string; label: string; meters: number }

const MILE = 1609.344;
// Ordenadas por distancia. 5, 10 e 15 milhas sao as tradicionais em milhas.
export const MARK_DISTANCES: MarkDistance[] = ([
  { id: '1km', label: '1 km', meters: 1000 },
  { id: '3km', label: '3 km', meters: 3000 },
  { id: '5km', label: '5 km', meters: 5000 },
  { id: '5mi', label: '5 milhas', meters: 5 * MILE },
  { id: '10km', label: '10 km', meters: 10000 },
  { id: '15km', label: '15 km', meters: 15000 },
  { id: '16km', label: '16 km', meters: 16000 },
  { id: '10mi', label: '10 milhas', meters: 10 * MILE },
  { id: 'half', label: 'Meia maratona', meters: 21097.5 },
  { id: '15mi', label: '15 milhas', meters: 15 * MILE },
  { id: '30km', label: '30 km', meters: 30000 },
  { id: 'marathon', label: 'Maratona', meters: 42195 },
  { id: '50km', label: '50 km', meters: 50000 },
  { id: '60km', label: '60 km', meters: 60000 },
  { id: '75km', label: '75 km', meters: 75000 },
] as MarkDistance[]).sort((a, b) => a.meters - b.meters);

// Descontinuidade da serie: dois pontos seguidos separados por mais que isto indicam relogio pausado (ou dado faltando). Conferencia de INTEGRIDADE do dado, nao regra de treino.
// Limite tecnico inicial (ainda nao medido em series reais de todas as marcas de relogio): max(30 s, 5x o intervalo tipico entre pontos da propria atividade).
export const PAUSE_GAP_MIN_SEC = 30;
export const PAUSE_GAP_FACTOR = 5;

export interface SeriesPoint { offsetSec: number; distanceMeters: number | null }

export type MarkSource = 'device' | 'manual' | 'test';
// Como o tempo foi obtido: 'series_clock' = relogio corrido pela serie (confirmado); 'duration' = duracao informada pelo provedor/aluna (pode nao incluir pausas em alguns provedores).
export type MarkTimeBasis = 'series_clock' | 'duration';
export type MarkMethod = 'whole' | 'segment';

export interface MarkActivity {
  id: string;
  source: MarkSource;
  provider: string | null;
  startedAt: Date;
  // Dia local da atividade (YYYY-MM-DD): a tela abre o treino/semana por ele.
  localDate: string;
  distanceMeters: number | null;
  durationSec: number | null;
  series: SeriesPoint[];
}

export interface BestMark {
  distanceId: string;
  seconds: number;
  paceSecondsKm: number;
  // Metros da corrida alem da distancia da marca quando vale o tempo da corrida INTEIRA (0 quando o trecho e exato).
  extraMeters: number;
  activityId: string;
  startedAt: string;
  localDate: string;
  // Como o tempo foi coletado (a tela explica): distancia total da corrida e, nos trechos, onde ele comeca e termina dentro dela.
  runMeters: number | null;
  windowStartMeters: number | null;
  windowEndMeters: number | null;
  source: MarkSource;
  provider: string | null;
  method: MarkMethod;
  timeBasis: MarkTimeBasis;
}

export interface DistanceMarks { distanceId: string; label: string; meters: number; best: BestMark | null; ranking: BestMark[] }

function cleanSeries(points: SeriesPoint[]): Array<{ t: number; d: number }> {
  const rows = points
    .filter((p) => Number.isFinite(p.offsetSec) && p.distanceMeters != null && Number.isFinite(p.distanceMeters))
    .map((p) => ({ t: p.offsetSec, d: p.distanceMeters as number }))
    .sort((a, b) => a.t - b.t);
  const out: Array<{ t: number; d: number }> = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && row.t === last.t) continue;
    if (last && row.d < last.d) continue; // distancia nao anda para tras
    out.push(row);
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Tempo (s) em que a distancia acumulada atinge `target` (interpolacao linear dentro do trecho); null se a serie nao chega la.
function timeAtDistance(points: Array<{ t: number; d: number }>, target: number): number | null {
  if (points.length === 0 || target > points[points.length - 1].d) return null;
  if (target <= points[0].d) return points[0].t;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].d >= target) hi = mid;
    else lo = mid;
  }
  const a = points[lo];
  const b = points[hi];
  if (b.d === a.d) return b.t;
  return a.t + ((target - a.d) / (b.d - a.d)) * (b.t - a.t);
}

// Menor tempo de relogio para cobrir EXATAMENTE `meters` sem pausa dentro do trecho. Null se a serie nao tem esse trecho.
export function bestSegmentSeconds(rawPoints: SeriesPoint[], meters: number): number | null {
  return bestSegment(rawPoints, meters)?.seconds ?? null;
}

// Igual a bestSegmentSeconds, mas diz ONDE (em metros desde o inicio da corrida) o melhor trecho comecou.
export function bestSegment(rawPoints: SeriesPoint[], meters: number): { seconds: number; startMeters: number } | null {
  const points = cleanSeries(rawPoints);
  if (points.length < 2 || points[points.length - 1].d - points[0].d < meters) return null;
  const intervals: number[] = [];
  for (let i = 1; i < points.length; i++) intervals.push(points[i].t - points[i - 1].t);
  const gapLimit = Math.max(PAUSE_GAP_MIN_SEC, PAUSE_GAP_FACTOR * median(intervals));
  const gaps: Array<{ from: number; to: number }> = [];
  for (let i = 1; i < points.length; i++) if (points[i].t - points[i - 1].t > gapLimit) gaps.push({ from: points[i - 1].t, to: points[i].t });
  const valid = (start: number, end: number) => !gaps.some((g) => g.from < end && g.to > start);

  let best: { seconds: number; startMeters: number } | null = null;
  const consider = (start: number | null, end: number | null, startMeters: number) => {
    if (start === null || end === null || end <= start || !valid(start, end)) return;
    const seconds = end - start;
    if (best === null || seconds < best.seconds) best = { seconds, startMeters: Math.round(startMeters - first) };
  };
  const first = points[0].d;
  const last = points[points.length - 1].d;
  for (const p of points) {
    if (p.d + meters <= last) consider(p.t, timeAtDistance(points, p.d + meters), p.d); // trecho que COMECA num ponto
    if (p.d - meters >= first) consider(timeAtDistance(points, p.d - meters), p.t, p.d - meters); // trecho que TERMINA num ponto
  }
  return best;
}

function toMark(distance: MarkDistance, activity: MarkActivity, seconds: number, method: MarkMethod, timeBasis: MarkTimeBasis, coveredMeters: number = distance.meters, windowStartMeters: number | null = null): BestMark {
  return {
    distanceId: distance.id,
    seconds: Math.round(seconds),
    paceSecondsKm: Math.round(seconds / (coveredMeters / 1000)),
    extraMeters: Math.max(0, Math.round(coveredMeters - distance.meters)),
    activityId: activity.id,
    startedAt: activity.startedAt.toISOString(),
    localDate: activity.localDate,
    runMeters: activity.distanceMeters != null ? Math.round(activity.distanceMeters) : null,
    windowStartMeters,
    windowEndMeters: windowStartMeters !== null ? Math.round(windowStartMeters + distance.meters) : null,
    source: activity.source,
    provider: activity.provider,
    method,
    timeBasis,
  };
}

// Melhor candidato de UMA atividade para uma distancia (ou null).
export function candidateFor(activity: MarkActivity, distance: MarkDistance): BestMark | null {
  const reached = activity.distanceMeters != null && Math.round(activity.distanceMeters) >= Math.floor(distance.meters); // igual ou maior (ao metro)
  const points = cleanSeries(activity.series);
  const hasSeries = points.length >= 2;
  let whole: BestMark | null = null;
  if (reached) {
    const covered = activity.distanceMeters as number;
    if (hasSeries && points[points.length - 1].t - points[0].t > 0) whole = toMark(distance, activity, points[points.length - 1].t - points[0].t, 'whole', 'series_clock', covered);
    else if (activity.durationSec != null && activity.durationSec > 0) whole = toMark(distance, activity, activity.durationSec, 'whole', 'duration', covered);
  }
  let segment: BestMark | null = null;
  if (hasSeries && activity.source === 'device') {
    const found = bestSegment(activity.series, distance.meters);
    if (found !== null) segment = toMark(distance, activity, found.seconds, 'segment', 'series_clock', distance.meters, found.startMeters);
  }
  if (whole && segment) return whole.seconds <= segment.seconds ? whole : segment;
  return whole ?? segment;
}

export function computeBestMarks(activities: MarkActivity[], limitPerDistance = 200): DistanceMarks[] {
  return MARK_DISTANCES.map((distance) => {
    const ranking = activities
      .map((activity) => candidateFor(activity, distance))
      .filter((mark): mark is BestMark => mark !== null && mark.seconds > 0)
      .sort((a, b) => a.seconds - b.seconds || a.startedAt.localeCompare(b.startedAt))
      .slice(0, limitPerDistance);
    return { distanceId: distance.id, label: distance.label, meters: Math.round(distance.meters), best: ranking[0] ?? null, ranking };
  });
}

// Relato da entrevista (3 maiores distancias dos ultimos 6 meses). Mostrado a parte, SEMPRE rotulado como relato; nunca entra no ranking registrado.
export interface SelfReportedRun { rank: 1 | 2 | 3; distanceKm: number | null; distanceRaw: string | null; timesRun: number | null; timeSeconds: number | null }

function positive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hmsToSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p)) || (parts.length !== 2 && parts.length !== 3)) return null;
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (m >= 60 || s >= 60) return null;
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

export function selfReportedRuns(answers: Record<string, unknown>): SelfReportedRun[] {
  const slots: Array<{ rank: 1 | 2 | 3; distance: string; count: string; time: string | null }> = [
    { rank: 1, distance: 'longest_distance', count: 'longest_distance_recent_count', time: 'longest_distance_recent_time' },
    { rank: 2, distance: 'second_longest_distance_recent', count: 'second_longest_distance_recent_count', time: null },
    { rank: 3, distance: 'third_longest_distance_recent', count: 'third_longest_distance_recent_count', time: null },
  ];
  const out: SelfReportedRun[] = [];
  for (const slot of slots) {
    const raw = answers[slot.distance];
    const distanceKm = positive(raw);
    const distanceRaw = distanceKm === null && typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    if (distanceKm === null && distanceRaw === null) continue;
    out.push({ rank: slot.rank, distanceKm, distanceRaw, timesRun: positive(answers[slot.count]), timeSeconds: slot.time ? hmsToSeconds(answers[slot.time]) : null });
  }
  return out;
}
