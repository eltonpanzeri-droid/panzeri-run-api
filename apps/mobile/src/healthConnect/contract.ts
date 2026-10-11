// CONTRATO TECNICO do Health Connect no Panzeri Run (Android). Modulo PURO (sem React Native): testavel e compartilhado por todo o cliente.
//
// Fluxo: Health Connect (aparelho) -> leitura autorizada pelo aluno -> payload abaixo -> POST /health-connect/exercises (JWT) -> RawExternalActivity ->
// ActivityLog -> identidade fisica / canonica / reconciliacao / confirmacao ja' existentes. O app NAO classifica, NAO deduplica e NAO decide nada de
// treino: so' le, resume (distancia e FC da MESMA origem, dentro da sessao) e envia. Dado ausente fica null; nunca se inventa metrica.

// Somente leitura e somente o necessario na primeira versao (nada de rota GPS, sono, passos, calorias, peso ou nutricao).
export const HC_RECORD_TYPES = ['ExerciseSession', 'Distance', 'HeartRate'] as const;
export type HcRecordType = (typeof HC_RECORD_TYPES)[number];
// Sem ExerciseSession nao ha o que importar (insuficiente). Distancia e FC sao opcionais: sem elas a sessao e' importada sem essas metricas.
export const HC_REQUIRED_RECORD_TYPES: readonly HcRecordType[] = ['ExerciseSession'];
export const HC_PERMISSIONS = HC_RECORD_TYPES.map((recordType) => ({ accessType: 'read' as const, recordType }));

// O Health Connect so' entrega os 30 dias anteriores a primeira autorizacao (sem a permissao de historico, que NAO pedimos): 29 dias fica dentro do limite.
export const LOOKBACK_DAYS = 29;
// Sobreposicao entre sincronizacoes: reler o final da janela anterior cobre registros recebidos fora de ordem e modificados depois; o servidor e' idempotente.
export const OVERLAP_MS = 24 * 60 * 60 * 1000;
// Intervalo minimo entre sincronizacoes AUTOMATICAS (a manual nunca e' limitada).
export const MIN_AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
// Igual ao limite do servidor (MAX_EXERCISES_PER_BATCH).
export const BATCH_SIZE = 50;
const SESSION_TOLERANCE_MS = 60 * 1000;

export type HealthConnectStatus = 'not_connected' | 'connected' | 'syncing' | 'done' | 'insufficient_permissions' | 'unavailable' | 'error';
export type SdkStatus = 'available' | 'update_required' | 'unavailable';

// ---- Textos de estado exibidos ao aluno (UI) ----------------------------------------------------------------------------------------
export const STATUS_LABEL: Record<HealthConnectStatus, string> = {
  not_connected: 'Não conectado',
  connected: 'Conectado',
  syncing: 'Sincronizando...',
  done: 'Sincronização concluída',
  insufficient_permissions: 'Permissões insuficientes',
  unavailable: 'Health Connect indisponível',
  error: 'Erro de sincronização',
};

export function formatLastSync(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---- Registros brutos do Health Connect (so' os campos usados) --------------------------------------------------------------------
export interface HcMetadata {
  id?: string;
  dataOrigin?: string;
  lastModifiedTime?: string;
  clientRecordId?: string;
  device?: { manufacturer?: string; model?: string; type?: number };
  recordingMethod?: number;
}
export interface HcRawSession {
  metadata?: HcMetadata;
  exerciseType: number;
  startTime: string;
  endTime: string;
  startZoneOffset?: { id?: string; totalSeconds: number } | null;
}
export interface HcRawDistance { metadata?: HcMetadata; startTime: string; endTime: string; distance: { inMeters: number } }
export interface HcRawHeartRate { metadata?: HcMetadata; startTime: string; endTime: string; samples: Array<{ time: string; beatsPerMinute: number }> }

// ---- Payload enviado ao servidor (ver HealthConnectIngestionService / normalizeHealthConnectExercise) ----------------------------------
export interface ExercisePayload {
  recordId: string; // metadata.id do Health Connect: chave de idempotencia
  clientRecordId: string | null;
  dataOrigin: string | null; // pacote do app que escreveu o registro (NAO o canal); null se nao informado
  lastModifiedTime: string | null;
  exerciseType: number;
  startTime: string;
  endTime: string;
  startZoneOffsetSeconds: number | null;
  device: { manufacturer: string | null; model: string | null; type: number | null } | null; // so' se a origem informou
  recordingMethod: number | null;
  distanceMeters: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  heartRateSampleCount: number | null;
}

export interface ImportResponse {
  created: number;
  updated: number;
  alreadyImported: number;
  rejected: number;
  items?: Array<{ recordId: string | null; status: string; reason?: string }>;
}

const ms = (iso: string) => new Date(iso).getTime();

// Soma a distancia dos registros de Distance da MESMA origem cujo intervalo esta DENTRO da sessao (com tolerancia). Registro que atravessa a sessao
// (ex.: distancia diaria) nunca entra. Nenhum registro, ou soma zero => null (nunca zero inventado).
export function sumDistanceMeters(records: HcRawDistance[], session: Pick<HcRawSession, 'startTime' | 'endTime'>): number | null {
  const start = ms(session.startTime) - SESSION_TOLERANCE_MS;
  const end = ms(session.endTime) + SESSION_TOLERANCE_MS;
  let total = 0;
  let any = false;
  for (const record of records) {
    const inMeters = record.distance?.inMeters;
    if (typeof inMeters !== 'number' || !Number.isFinite(inMeters) || inMeters < 0) continue;
    if (!(ms(record.startTime) >= start && ms(record.endTime) <= end)) continue;
    total += inMeters;
    any = true;
  }
  return any && total > 0 ? Math.round(total * 100) / 100 : null;
}

// Frequencia cardiaca da MESMA origem, so' das amostras dentro da sessao: media simples e maxima das amostras entregues (numero de amostras junto,
// para transparencia). Sem amostras validas => tudo null.
export function summarizeHeartRate(records: HcRawHeartRate[], session: Pick<HcRawSession, 'startTime' | 'endTime'>): { avg: number | null; max: number | null; count: number | null } {
  const start = ms(session.startTime);
  const end = ms(session.endTime);
  const values: number[] = [];
  for (const record of records) {
    for (const sample of record.samples ?? []) {
      const t = ms(sample.time);
      if (typeof sample.beatsPerMinute === 'number' && Number.isFinite(sample.beatsPerMinute) && sample.beatsPerMinute > 0 && t >= start && t <= end) values.push(sample.beatsPerMinute);
    }
  }
  if (values.length === 0) return { avg: null, max: null, count: null };
  const avg = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
  return { avg, max: Math.round(Math.max(...values)), count: values.length };
}

// Monta o payload de UMA sessao. Sessao sem id de registro nao e' enviavel (sem chave de idempotencia): devolve null.
export function buildExercisePayload(session: HcRawSession, distance: HcRawDistance[] | null, heartRate: HcRawHeartRate[] | null): ExercisePayload | null {
  const meta = session.metadata ?? {};
  if (!meta.id || typeof meta.id !== 'string') return null;
  const device = meta.device;
  const hasDevice = !!device && (device.manufacturer != null || device.model != null || device.type != null);
  const hr = heartRate ? summarizeHeartRate(heartRate, session) : { avg: null, max: null, count: null };
  return {
    recordId: meta.id,
    clientRecordId: meta.clientRecordId ?? null,
    dataOrigin: meta.dataOrigin ?? null,
    lastModifiedTime: meta.lastModifiedTime ?? null,
    exerciseType: session.exerciseType,
    startTime: session.startTime,
    endTime: session.endTime,
    startZoneOffsetSeconds: typeof session.startZoneOffset?.totalSeconds === 'number' ? session.startZoneOffset.totalSeconds : null,
    device: hasDevice ? { manufacturer: device!.manufacturer ?? null, model: device!.model ?? null, type: typeof device!.type === 'number' ? device!.type : null } : null,
    recordingMethod: typeof meta.recordingMethod === 'number' ? meta.recordingMethod : null,
    distanceMeters: distance ? sumDistanceMeters(distance, session) : null,
    avgHeartRateBpm: hr.avg,
    maxHeartRateBpm: hr.max,
    heartRateSampleCount: hr.count,
  };
}

// Classificacao de falhas: permissao revogada/negada x demais. Nunca expoe detalhe interno ao aluno.
export function classifyError(error: unknown): 'permission' | 'unavailable' | 'other' {
  const text = `${(error as { name?: string })?.name ?? ''} ${(error as { message?: string })?.message ?? ''} ${(error as { code?: string })?.code ?? ''}`.toLowerCase();
  if (/securityexception|permission|not granted|unauthorized/.test(text)) return 'permission';
  if (/not.*(available|installed|supported)|sdk_unavailable|provider/.test(text)) return 'unavailable';
  return 'other';
}

// "sub" do JWT, so' para NAMESPACE do estado local (nunca para autorizar nada: o servidor valida o token). Decodificador base64url manual (sem dependencias).
export function userIdFromAccessToken(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = part.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) return null;
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  try {
    const json = JSON.parse(decodeURIComponent(bytes.map((b) => '%' + b.toString(16).padStart(2, '0')).join(''))) as { sub?: unknown };
    return typeof json.sub === 'string' && json.sub ? json.sub : null;
  } catch {
    return null;
  }
}
