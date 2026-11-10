// Series do treino do Apple Saude (10/11/2026, regra "pegar TUDO"): frequencia cardiaca, velocidade, potencia, passos (base da cadencia) e distancia AO LONGO do treino, lidas no aparelho e enviadas
// em amostras [inicio, fim, valor] (segundos desde o inicio do treino). Aqui so' se valida e se junta tudo numa linha por segundo (ActivityTimeSeriesPoint). Funcoes puras.
// Nada e' calculado alem de conversao de unidade e de reorganizar o que o aparelho mediu: cadencia = passos / duracao da amostra; velocidade so' e' derivada da distancia quando o aparelho nao mandou velocidade.

export const SERIES_METRICS = ['heartRate', 'runningSpeed', 'runningPower', 'stepCount', 'distance'] as const;
export type SeriesMetric = (typeof SERIES_METRICS)[number];
export type SeriesSample = [number, number, number];
export interface NormalizedSeries { recordId: string; metrics: Partial<Record<SeriesMetric, SeriesSample[]>> }

export const APPLE_SERIES_LIMITS = { maxSeriesPerRequest: 5, maxSamplesPerMetric: 800, maxRequestBytes: 95_000, maxPendingIds: 100 } as const;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function appleSeriesBodyBytes(body: unknown): number {
  try { return JSON.stringify(body).length; } catch { return Number.MAX_SAFE_INTEGER; }
}

export function normalizeSeries(body: unknown, limits = APPLE_SERIES_LIMITS): { ok: true; series: NormalizedSeries[]; dropped: number } | { ok: false; reason: string } {
  const raw = (body as { series?: unknown } | null)?.series;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, reason: 'informe series (lista nao vazia)' };
  if (raw.length > limits.maxSeriesPerRequest) return { ok: false, reason: `no maximo ${limits.maxSeriesPerRequest} treinos por envio` };
  const series: NormalizedSeries[] = [];
  let dropped = 0;
  for (const item of raw) {
    const recordId = typeof (item as { recordId?: unknown })?.recordId === 'string' ? (item as { recordId: string }).recordId.trim().toLowerCase().slice(0, 64) : '';
    const metricsRaw = (item as { metrics?: unknown })?.metrics;
    if (!recordId || !metricsRaw || typeof metricsRaw !== 'object' || Array.isArray(metricsRaw)) { dropped += 1; continue; }
    const metrics: Partial<Record<SeriesMetric, SeriesSample[]>> = {};
    for (const metric of SERIES_METRICS) {
      const samples = (metricsRaw as Record<string, unknown>)[metric];
      if (samples === undefined) continue;
      if (!Array.isArray(samples)) return { ok: false, reason: `${metric} deve ser uma lista` };
      if (samples.length > limits.maxSamplesPerMetric) return { ok: false, reason: `${metric} tem ${samples.length} amostras (maximo ${limits.maxSamplesPerMetric})` };
      const clean: SeriesSample[] = [];
      for (const sample of samples) {
        if (!Array.isArray(sample) || sample.length !== 3 || !sample.every(finite) || sample[1] < sample[0]) { dropped += 1; continue; }
        clean.push([sample[0], sample[1], sample[2]]);
      }
      if (clean.length > 0) metrics[metric] = clean;
    }
    if (Object.keys(metrics).length === 0) { dropped += 1; continue; }
    series.push({ recordId, metrics });
  }
  return { ok: true, series, dropped };
}

export interface SeriesPoint { offsetSec: number; heartRateBpm?: number; speedKmh?: number; powerWatts?: number; cadenceSpm?: number; distanceMeters?: number }

const round = (value: number, places = 0) => { const f = 10 ** places; return Math.round(value * f) / f; };

// Uma linha por segundo inteiro do treino. Valor fora do limite fisico plausivel e' descartado (ausencia nunca vira zero; zero medido segue zero).
export function buildSeriesPoints(metrics: Partial<Record<SeriesMetric, SeriesSample[]>>): SeriesPoint[] {
  const byTime = new Map<number, SeriesPoint>();
  const at = (seconds: number): SeriesPoint | null => {
    const key = Math.round(seconds);
    if (key < 0) return null;
    let point = byTime.get(key);
    if (!point) { point = { offsetSec: key }; byTime.set(key, point); }
    return point;
  };
  for (const [start, end, value] of metrics.heartRate ?? []) {
    if (value >= 25 && value <= 250) { const p = at((start + end) / 2); if (p) p.heartRateBpm = Math.round(value); }
  }
  for (const [start, end, value] of metrics.runningSpeed ?? []) {
    if (value >= 0 && value <= 15) { const p = at((start + end) / 2); if (p) p.speedKmh = round(value * 3.6, 2); }
  }
  for (const [start, end, value] of metrics.runningPower ?? []) {
    if (value >= 0 && value <= 2500) { const p = at((start + end) / 2); if (p) p.powerWatts = Math.round(value); }
  }
  for (const [start, end, value] of metrics.stepCount ?? []) {
    const duration = end - start;
    if (duration < 1 || value < 0) continue;
    const spm = (value / duration) * 60;
    if (spm <= 300) { const p = at((start + end) / 2); if (p) p.cadenceSpm = Math.round(spm); }
  }
  let cumulative = 0;
  const hasSpeed = (metrics.runningSpeed?.length ?? 0) > 0;
  for (const [start, end, value] of metrics.distance ?? []) {
    if (value < 0) continue;
    cumulative += value;
    const p = at(end);
    if (p) p.distanceMeters = round(cumulative, 1);
    const duration = end - start;
    if (!hasSpeed && duration >= 1) {
      const kmh = (value / duration) * 3.6;
      const mid = at((start + end) / 2);
      if (mid && kmh <= 54 && mid.speedKmh === undefined) mid.speedKmh = round(kmh, 2);
    }
  }
  return [...byTime.values()].sort((a, b) => a.offsetSec - b.offsetSec);
}
