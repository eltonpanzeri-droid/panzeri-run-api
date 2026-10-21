import { createHash } from 'node:crypto';
import { InboundEventDraft } from '../provider-hub/provider-connector';

// Webhook da Zepp (Lote 3, 20/10/2026). Formato oficial (devopen.zepp.com): POST `text/plain`, corpo = ARRAY JSON de STRINGS; cada string e' um objeto JSON.
//  - Activity Events: `{ activityFiles: [ { userId, summaryId ("{activityId}-file"), fileType: "FIT", callbackURL, activityType?, deviceName?, startTimeInSeconds?,
//    activityId?, manual? } ] }`. `summaryId` e' a chave de idempotencia; `callbackURL` tem token de uso unico valido por 24 h.
//  - Sleep Events: `{ sleeps: [ { userId, summaryId (pode ser null), calendarDate, startTimeInSeconds, startTimeOffsetInSeconds, durationInSeconds, ... } ] }`; HRV Events: `{ hrv: [...] }`;
//    Dailies: `{ dailies: [...] }` (21/10/2026). Os tres chegam por PUSH (o corpo ja' traz o dado, sem download) e `summaryId` pode ser nulo: a chave de idempotencia e' composta.
//  - Authorization change: `{ userId, eventType: "authorizationChange", changeType: "delete", eventTime }` (o aluno revogou).
// A Zepp NAO assina as requisicoes (sem HMAC/allowlist de IP). Defesas do Panzeri Run, em camadas: segredo longo no caminho da URL (comparado em tempo constante),
// corpo pequeno e estrito, callbackURL so' aceita o host oficial (o token do aluno nunca vai para outro destino), evento so' vira trabalho se o userId e' de uma
// conexao ativa e o download exige o token do PROPRIO aluno (a Zepp valida) — alguem que descubra a URL nao consegue criar atividade falsa.

// Sono (com segmentos de etapas) e lotes diarios cabem com folga em 512 KB; ainda e' um teto estrito para um endpoint publico.
export const ZEPP_WEBHOOK_MAX_BYTES = 512 * 1024;
export const ZEPP_ALLOWED_CALLBACK_HOST = 'api-open.zepp.com';
export const ZEPP_ALLOWED_CALLBACK_PATH = '/api/activity/file';
const MAX_RECORDS = 50;
const SUMMARY_ID = /^[A-Za-z0-9_-]{1,100}$/;
const USER_ID = /^[A-Za-z0-9_-]{1,100}$/;

export class ZeppWebhookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZeppWebhookParseError';
  }
}

export interface ZeppActivityFileRecord {
  userId: string;
  summaryId: string;
  callbackURL: string;
  activityType: string | null;
  deviceName: string | null;
  startTimeInSeconds: number | null;
  activityId: string | null;
  manual: boolean;
}
// ── Saude e recuperacao (21/10/2026): so' o que a Zepp mede e entrega. Campo ausente/invalido => null, nunca zero nem estimativa. ──────────────────────────────────────────────────────
export type ZeppHealthKind = 'sleep' | 'daily' | 'hrv';
export interface ZeppHealthBase { kind: ZeppHealthKind; userId: string; summaryId: string | null; calendarDate: string; startTimeSec: number; startOffsetSec: number }
export interface ZeppSleepRecord extends ZeppHealthBase {
  kind: 'sleep';
  durationSec: number | null;
  deepSleepSec: number | null;
  lightSleepSec: number | null;
  remSleepSec: number | null;
  awakeSec: number | null;
  napTotalSec: number | null;
  unmeasurableSec: number | null;
  scoreValue: number | null;
  scoreQualifier: string | null;
  validation: string | null;
  // Maior fim entre os segmentos de etapas (null quando a Zepp nao informou segmentos): o fim da noite nunca e' calculado por estimativa.
  endTimeSec: number | null;
  levels: Record<string, Array<{ startTimeSec: number; endTimeSec: number }>> | null;
  naps: Array<{ durationSec: number; startTimeSec: number; validation: string | null; offsetSec: number | null }> | null;
}
export interface ZeppDailyRecord extends ZeppHealthBase {
  kind: 'daily';
  durationSec: number | null;
  steps: number | null;
  distanceMeters: number | null;
  activeKilocalories: number | null;
  restingHeartRateBpm: number | null;
  stepsGoal: number | null;
}
export interface ZeppHrvRecord extends ZeppHealthBase {
  kind: 'hrv';
  durationSec: number | null;
  // Unidade NAO especificada pela Zepp: guardada como veio.
  lastNightAvg: number;
  hrvValues: unknown;
}
export type ZeppHealthRecord = ZeppSleepRecord | ZeppDailyRecord | ZeppHrvRecord;

export interface ZeppAuthorizationChange {
  userId: string;
  changeType: string;
  eventTime: number | null;
}
export interface ZeppWebhookContent {
  activityFiles: ZeppActivityFileRecord[];
  healthRecords: ZeppHealthRecord[];
  authorizationChanges: ZeppAuthorizationChange[];
  // Quantos itens vieram invalidos/desconhecidos e foram ignorados (nunca lanca por causa de um item).
  ignored: number;
}

// So' o host oficial, HTTPS, sem credenciais/porta e o caminho do arquivo de atividade: o Bearer do aluno e' enviado a esta URL, entao ela nunca pode apontar para outro lugar.
export function isAllowedCallbackUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && url.hostname === ZEPP_ALLOWED_CALLBACK_HOST && url.port === '' && url.username === '' && url.password === '' && url.pathname === ZEPP_ALLOWED_CALLBACK_PATH && url.hash === '';
}

const str = (value: unknown, max = 200): string | null => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SEGMENTS = 500;
const MAX_HRV_JSON_BYTES = 20_000;
// Numero dentro de uma faixa fisicamente possivel; fora dela (ou nao numerico) vira null — o valor nunca e' corrigido, arredondado nem substituido.
const numIn = (value: unknown, min: number, max: number): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null);
const intIn = (value: unknown, min: number, max: number): number | null => { const n = numIn(value, min, max); return n === null ? null : Math.round(n); };

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  if (typeof value === 'string') return value.length <= 60 ? value : null;
  if (depth >= 4) return null;
  if (Array.isArray(value)) return value.slice(0, 1500).map((item) => sanitizeJson(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) if (/^[A-Za-z0-9_.:-]{1,40}$/.test(key)) out[key] = sanitizeJson(item, depth + 1);
    return out;
  }
  return null;
}

function healthBase(kind: ZeppHealthKind, record: Record<string, unknown>): ZeppHealthBase | null {
  const userId = str(record.userId, 100);
  const calendarDate = typeof record.calendarDate === 'string' && CALENDAR_DATE.test(record.calendarDate) ? record.calendarDate : null;
  const startTimeSec = intIn(record.startTimeInSeconds, 946_684_800, 4_102_444_800); // 2000-01-01 .. 2100-01-01
  const startOffsetSec = intIn(record.startTimeOffsetInSeconds, -64_800, 64_800);
  if (!userId || !USER_ID.test(userId) || !calendarDate || startTimeSec === null || startOffsetSec === null) return null;
  const rawSummary = typeof record.summaryId === 'string' || typeof record.summaryId === 'number' ? String(record.summaryId) : null;
  return { kind, userId, summaryId: rawSummary && rawSummary.length <= 100 ? rawSummary : null, calendarDate, startTimeSec, startOffsetSec };
}

function parseSleep(record: Record<string, unknown>): ZeppSleepRecord | null {
  const base = healthBase('sleep', record);
  if (!base) return null;
  const levels: NonNullable<ZeppSleepRecord['levels']> = {};
  let endTimeSec: number | null = null;
  const map = record.sleepLevelsMap && typeof record.sleepLevelsMap === 'object' ? (record.sleepLevelsMap as Record<string, unknown>) : null;
  for (const stage of ['deep', 'light', 'rem', 'awake']) {
    const segments = map && Array.isArray(map[stage]) ? (map[stage] as unknown[]).slice(0, MAX_SEGMENTS) : [];
    const valid = segments
      .map((segment) => (segment && typeof segment === 'object' ? (segment as Record<string, unknown>) : {}))
      .map((segment) => ({ startTimeSec: intIn(segment.startTimeInSeconds, 946_684_800, 4_102_444_800), endTimeSec: intIn(segment.endTimeInSeconds, 946_684_800, 4_102_444_800) }))
      .filter((segment): segment is { startTimeSec: number; endTimeSec: number } => segment.startTimeSec !== null && segment.endTimeSec !== null && segment.endTimeSec >= segment.startTimeSec);
    if (valid.length > 0) {
      levels[stage] = valid;
      for (const segment of valid) endTimeSec = endTimeSec === null ? segment.endTimeSec : Math.max(endTimeSec, segment.endTimeSec);
    }
  }
  const napsRaw = Array.isArray(record.naps) ? (record.naps as unknown[]).slice(0, 20) : [];
  const naps = napsRaw
    .map((nap) => (nap && typeof nap === 'object' ? (nap as Record<string, unknown>) : {}))
    .map((nap) => ({ durationSec: intIn(nap.napDurationInSeconds, 0, 86_400), startTimeSec: intIn(nap.napStartTimeInSeconds, 946_684_800, 4_102_444_800), validation: str(nap.napValidation, 40), offsetSec: intIn(nap.napOffsetInSeconds, -64_800, 64_800) }))
    .filter((nap): nap is { durationSec: number; startTimeSec: number; validation: string | null; offsetSec: number | null } => nap.durationSec !== null && nap.startTimeSec !== null);
  const score = record.overallSleepScore && typeof record.overallSleepScore === 'object' ? (record.overallSleepScore as Record<string, unknown>) : null;
  return {
    ...base,
    kind: 'sleep',
    durationSec: intIn(record.durationInSeconds, 0, 172_800),
    deepSleepSec: intIn(record.deepSleepDurationInSeconds, 0, 172_800),
    lightSleepSec: intIn(record.lightSleepDurationInSeconds, 0, 172_800),
    remSleepSec: intIn(record.remSleepInSeconds, 0, 172_800),
    awakeSec: intIn(record.awakeDurationInSeconds, 0, 172_800),
    napTotalSec: intIn(record.totalNapDurationInSeconds, 0, 172_800),
    unmeasurableSec: intIn(record.unmeasurableSleepInSeconds, 0, 172_800),
    scoreValue: score ? intIn(score.value, 0, 100) : null,
    scoreQualifier: score ? str(score.qualifierKey, 40) : null,
    validation: str(record.validation, 40),
    endTimeSec,
    levels: Object.keys(levels).length > 0 ? levels : null,
    naps: naps.length > 0 ? naps : null,
  };
}

function parseDaily(record: Record<string, unknown>): ZeppDailyRecord | null {
  const base = healthBase('daily', record);
  if (!base) return null;
  return {
    ...base,
    kind: 'daily',
    durationSec: intIn(record.durationInSeconds, 0, 172_800),
    steps: intIn(record.steps, 0, 300_000),
    distanceMeters: numIn(record.distanceInMeters, 0, 1_000_000),
    activeKilocalories: numIn(record.activeKilocalories, 0, 50_000),
    // FC de repouso vem SO' do evento diario (null quando nao medida); o evento de sono nunca a fornece.
    restingHeartRateBpm: intIn(record.restingHeartRateInBeatsPerMinute, 20, 250),
    stepsGoal: intIn(record.stepsGoal, 0, 300_000),
  };
}

function parseHrv(record: Record<string, unknown>): ZeppHrvRecord | null {
  const base = healthBase('hrv', record);
  const lastNightAvg = numIn(record.lastNightAvg, 0.000001, 100_000);
  if (!base || lastNightAvg === null) return null;
  let hrvValues: unknown = null;
  if (record.hrvValues && typeof record.hrvValues === 'object') {
    const cleaned = sanitizeJson(record.hrvValues);
    hrvValues = JSON.stringify(cleaned).length <= MAX_HRV_JSON_BYTES ? cleaned : null;
  }
  return { ...base, kind: 'hrv', durationSec: intIn(record.durationInSeconds, 0, 172_800), lastNightAvg, hrvValues };
}

const HEALTH_PARSERS: Array<{ key: 'sleeps' | 'dailies' | 'hrv'; parse: (record: Record<string, unknown>) => ZeppHealthRecord | null }> = [
  { key: 'sleeps', parse: parseSleep },
  { key: 'dailies', parse: parseDaily },
  { key: 'hrv', parse: parseHrv },
];

export function parseZeppWebhook(rawBody: string): ZeppWebhookContent {
  if (typeof rawBody !== 'string' || rawBody.length === 0 || Buffer.byteLength(rawBody, 'utf8') > ZEPP_WEBHOOK_MAX_BYTES) throw new ZeppWebhookParseError('Corpo ausente ou grande demais.');
  let outer: unknown;
  try { outer = JSON.parse(rawBody); } catch { throw new ZeppWebhookParseError('Corpo nao e JSON.'); }
  if (!Array.isArray(outer) || outer.length > MAX_RECORDS) throw new ZeppWebhookParseError('Corpo deve ser um array de strings JSON.');
  const result: ZeppWebhookContent = { activityFiles: [], healthRecords: [], authorizationChanges: [], ignored: 0 };
  for (const item of outer) {
    let parsed: unknown = null;
    if (typeof item === 'string') { try { parsed = JSON.parse(item); } catch { parsed = null; } }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { result.ignored += 1; continue; }
    const event = parsed as Record<string, unknown>;
    if (Array.isArray(event.activityFiles)) {
      for (const entry of event.activityFiles.slice(0, MAX_RECORDS)) {
        const record = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
        const userId = str(record.userId, 100);
        const summaryId = str(record.summaryId, 100);
        if (!userId || !USER_ID.test(userId) || !summaryId || !SUMMARY_ID.test(summaryId) || record.fileType !== 'FIT' || !isAllowedCallbackUrl(record.callbackURL)) { result.ignored += 1; continue; }
        result.activityFiles.push({
          userId,
          summaryId,
          callbackURL: record.callbackURL as string,
          activityType: str(record.activityType, 60),
          deviceName: str(record.deviceName, 100),
          startTimeInSeconds: typeof record.startTimeInSeconds === 'number' && Number.isFinite(record.startTimeInSeconds) ? record.startTimeInSeconds : null,
          activityId: typeof record.activityId === 'number' || typeof record.activityId === 'string' ? String(record.activityId).slice(0, 40) : null,
          manual: record.manual === true,
        });
      }
      continue;
    }
    const healthKey = HEALTH_PARSERS.find((parser) => Array.isArray(event[parser.key]));
    if (healthKey) {
      for (const entry of (event[healthKey.key] as unknown[]).slice(0, MAX_RECORDS)) {
        const parsedRecord = entry && typeof entry === 'object' && !Array.isArray(entry) ? healthKey.parse(entry as Record<string, unknown>) : null;
        if (parsedRecord) result.healthRecords.push(parsedRecord); else result.ignored += 1;
      }
      continue;
    }
    if (event.eventType === 'authorizationChange') {
      const userId = str(event.userId, 100);
      const changeType = str(event.changeType, 30);
      if (!userId || !USER_ID.test(userId) || !changeType) { result.ignored += 1; continue; }
      result.authorizationChanges.push({ userId, changeType, eventTime: typeof event.eventTime === 'number' ? event.eventTime : null });
      continue;
    }
    result.ignored += 1;
  }
  return result;
}

// Eventos para a fila duravel. So' o que o processamento precisa (nenhum dado de saude). A categoria 'activity' / 'profile' e' conferida na fila contra o consentimento.
export function toInboundDrafts(content: ZeppWebhookContent): InboundEventDraft[] {
  const drafts: InboundEventDraft[] = [];
  for (const file of content.activityFiles) {
    drafts.push({
      category: 'activity',
      // O mesmo arquivo reenviado (mesma callbackURL) e' o MESMO evento; um novo link para o mesmo summaryId (ex.: reentrega do Backfill depois que o link anterior expirou)
      // e' um evento NOVO, senao a recuperacao seria engolida pela linha antiga ja' descartada. A gravacao continua idempotente por summaryId.
      dedupeKey: `activity:${file.summaryId}:${createHash('sha256').update(file.callbackURL).digest('hex').slice(0, 16)}`,
      eventType: 'activity_file',
      externalAccountId: file.userId,
      payload: { summaryId: file.summaryId, callbackURL: file.callbackURL, activityType: file.activityType, deviceName: file.deviceName, startTimeInSeconds: file.startTimeInSeconds, activityId: file.activityId, manual: file.manual },
    });
  }
  for (const record of content.healthRecords) {
    // Dado de saude entra na fila so' quando a categoria correspondente esta autorizada (a fila confere). `summaryId` pode ser nulo: a identidade e' aluno + dia + inicio, e o hash do
    // conteudo faz uma versao ATUALIZADA do mesmo resumo virar evento novo (a gravacao e' idempotente por aluno + dia + inicio) enquanto o mesmo envio repetido e' o mesmo evento.
    const { userId, kind, ...payload } = record;
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
    drafts.push({
      category: kind === 'sleep' ? 'sleep' : kind === 'hrv' ? 'hrv' : 'daily_activity',
      dedupeKey: `${kind}:${userId}:${record.calendarDate}:${record.startTimeSec}:${hash}`,
      eventType: `${kind}_summary`,
      externalAccountId: userId,
      payload: payload as Record<string, unknown>,
    });
  }
  for (const change of content.authorizationChanges) {
    drafts.push({
      category: 'profile',
      dedupeKey: `auth:${change.userId}:${change.changeType}:${change.eventTime ?? 'na'}`,
      eventType: 'authorization_change',
      externalAccountId: change.userId,
      payload: { changeType: change.changeType, eventTime: change.eventTime },
    });
  }
  return drafts;
}
