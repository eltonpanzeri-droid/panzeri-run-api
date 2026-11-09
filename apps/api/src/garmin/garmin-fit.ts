import FitParser from 'fit-file-parser';
import { InboundEventDraft } from '../provider-hub/provider-connector';

// Arquivo FIT da Garmin (Activity Files, push de aviso + download unico; 09/11/2026). So' le o que o arquivo contem — nao interpreta treino, nao calcula prescricao.
//  - O aviso (`activityFiles`) traz so' metadados e o `callbackURL`; o arquivo so' existe nesse endereco, por 24 h e com UM download (o segundo recebe 410). O endereco carrega um `token` proprio
//    (NAO e' o token da aluna) e por isso nunca vai para log, RawExternalActivity nem documento.
//  - O FIT ORIGINAL NUNCA e' guardado: o buffer existe so' em memoria; saem daqui as voltas (com metricas) e a dinamica de corrida resumida (medias). Coordenadas e temperatura ja vem do JSON dos detalhes.
//  - Leitura ESTRITA (`force: false`). Campo ausente ou fora de limite fisico vira null (nunca zero). Unidades conforme o perfil FIT (tempo de contato em ms, oscilacao vertical e passada em mm,
//    razao vertical em %): NAO conferidas com um FIT real de corrida Garmin — ver PRONTUARIO.
export const GARMIN_FIT_MAX_BYTES = 25 * 1024 * 1024;
const GARMIN_FILE_HOST = 'apis.garmin.com';
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface GarminFileNotice {
  userId: string;
  summaryId: string;
  activityId: string;
  fileType: 'FIT';
  callbackURL: string;
  startedAtSec: number | null;
}

// So' https no host oficial, sem credenciais embutidas: o endereco vem de um corpo de webhook e nunca pode apontar para outro lugar (SSRF).
export function isGarminCallbackUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === GARMIN_FILE_HOST && !url.username && !url.password && url.port === '';
  } catch {
    return false;
  }
}

export function parseGarminActivityFiles(body: unknown): { notices: GarminFileNotice[]; ignored: number } {
  const notices: GarminFileNotice[] = [];
  let ignored = 0;
  const list = body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).activityFiles) ? ((body as Record<string, unknown>).activityFiles as unknown[]).slice(0, 500) : [];
  for (const entry of list) {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    const userId = item && typeof item.userId === 'string' ? item.userId.trim() : '';
    const summaryId = item && typeof item.summaryId === 'string' ? item.summaryId.trim() : '';
    const rawActivityId = item?.activityId;
    const activityId = typeof rawActivityId === 'number' && Number.isFinite(rawActivityId) ? String(Math.trunc(rawActivityId)) : typeof rawActivityId === 'string' ? rawActivityId.trim() : '';
    const startedAtSec = item && typeof item.startTimeInSeconds === 'number' && Number.isFinite(item.startTimeInSeconds) ? item.startTimeInSeconds : null;
    if (!item || !ID_PATTERN.test(userId) || !ID_PATTERN.test(summaryId) || !ID_PATTERN.test(activityId) || item.manual === true || String(item.fileType).toUpperCase() !== 'FIT' || !isGarminCallbackUrl(item.callbackURL)) { ignored += 1; continue; }
    notices.push({ userId, summaryId, activityId, fileType: 'FIT', callbackURL: item.callbackURL as string, startedAtSec });
  }
  return { notices, ignored };
}

export function toFileDrafts(notices: GarminFileNotice[]): InboundEventDraft[] {
  return notices.map((notice) => ({
    category: 'activity',
    dedupeKey: `file:${notice.summaryId}`.slice(0, 200),
    eventType: 'activity_file',
    externalAccountId: notice.userId,
    payload: notice as unknown as Record<string, unknown>,
  }));
}

export interface GarminFitLap {
  index: number;
  startOffsetSec: number | null;
  durationSec: number | null;
  distanceMeters: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  avgPowerWatts: number | null;
  avgSpeedKmh: number | null;
  ascentMeters: number | null;
}

export interface GarminFitDynamics {
  // Registros que trouxeram pelo menos um dos quatro indicadores.
  samples: number;
  groundContactTimeMsAvg: number | null;
  verticalOscillationMmAvg: number | null;
  strideLengthMmAvg: number | null;
  verticalRatioPctAvg: number | null;
}

export interface GarminFitExtras {
  laps: GarminFitLap[];
  dynamics: GarminFitDynamics | null;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const within = (value: number | null, min: number, max: number): number | null => (value !== null && value >= min && value <= max ? value : null);
const round = (value: number, digits = 2): number => Math.round(value * 10 ** digits) / 10 ** digits;

// PURA (testada sem arquivo): resume registros e voltas ja' lidos do FIT. startMs = inicio da sessao (para o deslocamento de cada volta).
export function summarizeFitExtras(records: Array<Record<string, unknown>>, laps: Array<Record<string, unknown>>, startMs: number): GarminFitExtras {
  const sums = { gct: [0, 0], vo: [0, 0], sl: [0, 0], vr: [0, 0] };
  let samples = 0;
  for (const record of records.slice(0, 200_000)) {
    const gct = within(num(record.stance_time), 50, 1500);
    const vo = within(num(record.vertical_oscillation), 1, 300);
    const sl = within(num(record.step_length), 100, 3000);
    const vr = within(num(record.vertical_ratio), 0.5, 30);
    if (gct === null && vo === null && sl === null && vr === null) continue;
    samples += 1;
    if (gct !== null) { sums.gct[0] += gct; sums.gct[1] += 1; }
    if (vo !== null) { sums.vo[0] += vo; sums.vo[1] += 1; }
    if (sl !== null) { sums.sl[0] += sl; sums.sl[1] += 1; }
    if (vr !== null) { sums.vr[0] += vr; sums.vr[1] += 1; }
  }
  const avg = (pair: number[]): number | null => (pair[1] > 0 ? round(pair[0] / pair[1]) : null);
  const dynamics: GarminFitDynamics | null = samples > 0 ? { samples, groundContactTimeMsAvg: avg(sums.gct), verticalOscillationMmAvg: avg(sums.vo), strideLengthMmAvg: avg(sums.sl), verticalRatioPctAvg: avg(sums.vr) } : null;
  const out: GarminFitLap[] = laps.slice(0, 2000).map((lap, index) => {
    const startMsLap = lap.start_time instanceof Date ? lap.start_time.getTime() : null;
    const speed = within(num(lap.enhanced_avg_speed) ?? num(lap.avg_speed), 0, 12.5);
    return {
      index,
      startOffsetSec: startMsLap === null ? null : Math.max(0, Math.round((startMsLap - startMs) / 1000)),
      durationSec: within(num(lap.total_timer_time), 0, 7 * 24 * 3600),
      distanceMeters: within(num(lap.total_distance), 0, 1_000_000),
      avgHeartRateBpm: within(num(lap.avg_heart_rate), 30, 250),
      maxHeartRateBpm: within(num(lap.max_heart_rate), 30, 250),
      avgPowerWatts: within(num(lap.avg_power), 0, 2500),
      avgSpeedKmh: speed === null ? null : round(speed * 3.6),
      ascentMeters: within(num(lap.total_ascent), 0, 20_000),
    };
  });
  return { laps: out, dynamics };
}

export class GarminFitError extends Error {
  constructor(public readonly code: 'invalid_fit' | 'no_session' | 'too_large', message: string) {
    super(message);
    this.name = 'GarminFitError';
  }
}

export async function readGarminFit(buffer: Buffer): Promise<GarminFitExtras> {
  if (buffer.length === 0) throw new GarminFitError('invalid_fit', 'Arquivo FIT vazio.');
  if (buffer.length > GARMIN_FIT_MAX_BYTES) throw new GarminFitError('too_large', 'Arquivo FIT grande demais.');
  const parser = new FitParser({ force: false, mode: 'list', speedUnit: 'm/s', lengthUnit: 'm', elapsedRecordField: true });
  let data: Awaited<ReturnType<FitParser['parseAsync']>>;
  try {
    data = await parser.parseAsync(Uint8Array.from(buffer).buffer);
  } catch (error) {
    throw new GarminFitError('invalid_fit', `Arquivo FIT invalido ou corrompido: ${typeof error === 'string' ? error : error instanceof Error ? error.message : 'erro'}`.slice(0, 200));
  }
  const sessions = (data.sessions ?? []) as Array<Record<string, unknown>>;
  if (sessions.length === 0) throw new GarminFitError('no_session', 'FIT sem mensagem de sessao.');
  const session = sessions[0];
  const start = session.start_time instanceof Date ? session.start_time : null;
  if (!start || Number.isNaN(start.getTime())) throw new GarminFitError('no_session', 'FIT sem horario de inicio.');
  return summarizeFitExtras((data.records ?? []) as Array<Record<string, unknown>>, (data.laps ?? []) as Array<Record<string, unknown>>, start.getTime());
}
