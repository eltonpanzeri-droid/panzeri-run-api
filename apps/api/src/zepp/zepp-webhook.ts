import { createHash } from 'node:crypto';
import { InboundEventDraft } from '../provider-hub/provider-connector';

// Webhook da Zepp (Lote 3, 20/10/2026). Formato oficial (devopen.zepp.com): POST `text/plain`, corpo = ARRAY JSON de STRINGS; cada string e' um objeto JSON.
//  - Activity Events: `{ activityFiles: [ { userId, summaryId ("{activityId}-file"), fileType: "FIT", callbackURL, activityType?, deviceName?, startTimeInSeconds?,
//    activityId?, manual? } ] }`. `summaryId` e' a chave de idempotencia; `callbackURL` tem token de uso unico valido por 24 h.
//  - Authorization change: `{ userId, eventType: "authorizationChange", changeType: "delete", eventTime }` (o aluno revogou).
// A Zepp NAO assina as requisicoes (sem HMAC/allowlist de IP). Defesas do Panzeri Run, em camadas: segredo longo no caminho da URL (comparado em tempo constante),
// corpo pequeno e estrito, callbackURL so' aceita o host oficial (o token do aluno nunca vai para outro destino), evento so' vira trabalho se o userId e' de uma
// conexao ativa e o download exige o token do PROPRIO aluno (a Zepp valida) — alguem que descubra a URL nao consegue criar atividade falsa.

export const ZEPP_WEBHOOK_MAX_BYTES = 64 * 1024;
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
export interface ZeppAuthorizationChange {
  userId: string;
  changeType: string;
  eventTime: number | null;
}
export interface ZeppWebhookContent {
  activityFiles: ZeppActivityFileRecord[];
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

export function parseZeppWebhook(rawBody: string): ZeppWebhookContent {
  if (typeof rawBody !== 'string' || rawBody.length === 0 || Buffer.byteLength(rawBody, 'utf8') > ZEPP_WEBHOOK_MAX_BYTES) throw new ZeppWebhookParseError('Corpo ausente ou grande demais.');
  let outer: unknown;
  try { outer = JSON.parse(rawBody); } catch { throw new ZeppWebhookParseError('Corpo nao e JSON.'); }
  if (!Array.isArray(outer) || outer.length > MAX_RECORDS) throw new ZeppWebhookParseError('Corpo deve ser um array de strings JSON.');
  const result: ZeppWebhookContent = { activityFiles: [], authorizationChanges: [], ignored: 0 };
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
