import { readFitActivity, type FitActivity } from '../fit/fit-reader';

// FIT do treino Wahoo (10/11/2026, varredura "pegar tudo"): o resumo do treino traz `workout_summary.file.url` (arquivo FIT em CDN publico, sem autenticacao — conforme a documentacao de
// terceiros; NAO validado com um treino real: nao ha aluna Wahoo conectada). O arquivo e' lido com o leitor de FIT neutro (padrao FIT) e gravado como serie por segundo (FC, ritmo, cadencia,
// potencia, elevacao, distancia) + voltas e dinamica de corrida em medias. REGRA: percurso GPS NAO e' guardado (GPS adiado por Elton: so' a Garmin tem); o filtro de consentimento retira as coordenadas.
export const WAHOO_FIT_MAX_BYTES = 15 * 1024 * 1024;

// Endereco do arquivo: https, sem credenciais nem porta, host com nome (nunca IP nem nome interno). Qualquer outra coisa nao e' baixada (protecao contra SSRF).
export function isSafeFitUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return false;
  return true;
}

export function fitUrlOf(summary: unknown): string | null {
  const file = (summary as { file?: { url?: unknown } | null } | null)?.file;
  return isSafeFitUrl(file?.url) ? file!.url as string : null;
}

// Le o FIT e remove o GPS: latitude/longitude nunca sao guardadas (GPS adiado por Elton; so' a Garmin tem).
export async function readWahooFit(buffer: Buffer): Promise<FitActivity> {
  const fit = await readFitActivity(buffer);
  return { ...fit, hasRoute: false, points: fit.points.map((point) => ({ ...point, latitude: null, longitude: null })) };
}

export function seriesRows(activity: FitActivity, activityLogId: string) {
  return activity.points.map((p) => ({
    activityLogId, provider: 'wahoo', offsetSec: p.offsetSec, normalizationVersion: 1,
    heartRateBpm: p.heartRateBpm !== null ? Math.round(p.heartRateBpm) : null, speedKmh: p.speedKmh, distanceMeters: p.distanceMeters,
    cadenceSpm: p.cadenceSpm !== null ? Math.round(p.cadenceSpm) : null, powerWatts: p.powerWatts !== null ? Math.round(p.powerWatts) : null, elevationMeters: p.elevationMeters,
  }));
}
