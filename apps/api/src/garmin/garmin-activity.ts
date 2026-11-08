import { createHash } from 'node:crypto';
import { InboundEventDraft } from '../provider-hub/provider-connector';

// Atividades da Garmin por PUSH (Activity API 2.1, Starter: so' push; "Activity_API 2.1.pdf" na pasta "Documentação Garmin"), 08/11/2026. Parte PURA (sem banco, sem rede):
//  - o push de `activities` traz o resumo; o de `activityDetails` traz o resumo + amostras (ate 1 Hz) + voltas; os dois chegam com o `userId` Garmin em cada item;
//  - `activityFiles` (FIT) NAO e' usado: o link de download vale uma vez, 24 h, e o JSON ja' traz FC, velocidade, cadencia, potencia e elevacao por amostra (dinamica de corrida so' existe no FIT: futuro);
//  - REGRA DA POLITICA (5D): coordenadas GPS NUNCA sao guardadas. O filtro roda AQUI, antes de o evento entrar na fila: latitude/longitude, temperatura e voltas nao passam;
//  - atividade manual (`manual: true`) nao e' execucao medida: descartada (mesma regra da Zepp); atividade-mae de multiesporte (`isParent`) e' ignorada para nao contar duas vezes;
//  - `manuallyUpdatedActivities` e `moveIQActivities` nao sao tratados (nao sao atividades iniciadas e medidas pelo relogio).
export const GARMIN_WEBHOOK_MAX_BYTES = 10 * 1024 * 1024;
export const GARMIN_MAX_SAMPLES = 50_000;
const MAX_DURATION_SEC = 7 * 24 * 3600;

export interface GarminSample {
  offsetSec: number;
  heartRateBpm: number | null;
  speedKmh: number | null;
  distanceMeters: number | null;
  cadenceSpm: number | null;
  powerWatts: number | null;
  elevationMeters: number | null;
}

export interface GarminActivityRecord {
  kind: 'summary' | 'details';
  userId: string;
  summaryId: string;
  activityId: string;
  activityType: string | null;
  startedAtSec: number;
  startOffsetSec: number | null;
  durationSec: number;
  distanceMeters: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  avgRunCadenceSpm: number | null;
  powerAvgWatts: number | null;
  elevationGainMeters: number | null;
  caloriesKcal: number | null;
  deviceName: string | null;
  // Null no resumo (sem amostras). Sem NENHUMA coordenada.
  samples: GarminSample[] | null;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown, max = 120): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const within = (value: number | null, min: number, max: number): number | null => (value !== null && value >= min && value <= max ? value : null);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

// Modalidade canonica (mesmo vocabulario de TrainingSession.modality). TODA corrida (rua, pista, trilha, esteira, virtual) e' 'corrida': esteira = corrida (regra de Elton, 06/11/2026);
// o tipo bruto fica em providerMetrics. Desconhecido => 'outra' (so' registra; nunca vira corrida por palpite).
export function modalityFromGarmin(activityType: string | null): string {
  const t = (activityType ?? '').toUpperCase();
  if (['RUNNING', 'INDOOR_RUNNING', 'STREET_RUNNING', 'TRACK_RUNNING', 'TRAIL_RUNNING', 'TREADMILL_RUNNING', 'ULTRA_RUN', 'VIRTUAL_RUN', 'OBSTACLE_RUN'].includes(t)) return 'corrida';
  if (['WALKING', 'CASUAL_WALKING', 'SPEED_WALKING', 'INDOOR_WALKING', 'HIKING'].includes(t)) return 'caminhada';
  if (/CYCLING|BIKE|BIKING|BMX|CYCLOCROSS|MTB|VIRTUAL_RIDE|HANDCYCLING/.test(t)) return 'bike';
  if (/SWIM/.test(t)) return 'natacao';
  if (t === 'STRENGTH_TRAINING') return 'forca';
  if (['HIIT', 'INDOOR_CARDIO', 'FITNESS_EQUIPMENT', 'ELLIPTICAL', 'CARDIO'].includes(t)) return 'funcional';
  return 'outra';
}

// Chave da atividade no Panzeri Run: o `activityId` do Garmin Connect (igual no resumo e nos detalhes). Sem ele, o summaryId sem o sufixo "-detail".
export function activityKeyOf(record: Pick<GarminActivityRecord, 'activityId' | 'summaryId'>): string {
  return record.activityId || record.summaryId.replace(/-detail$/, '');
}

function readSummary(item: Record<string, unknown>, summary: Record<string, unknown>, userId: string, kind: GarminActivityRecord['kind']): GarminActivityRecord | null {
  const summaryId = str(item.summaryId, 128) ?? str(summary.summaryId, 128);
  const startedAtSec = num(summary.startTimeInSeconds);
  const durationSec = num(summary.durationInSeconds);
  if (!summaryId || !ID_PATTERN.test(summaryId) || startedAtSec === null || startedAtSec <= 0 || durationSec === null || durationSec <= 0 || durationSec > MAX_DURATION_SEC) return null;
  const rawActivityId = item.activityId ?? summary.activityId;
  const activityId = typeof rawActivityId === 'number' && Number.isFinite(rawActivityId) ? String(Math.trunc(rawActivityId)) : typeof rawActivityId === 'string' && ID_PATTERN.test(rawActivityId) ? rawActivityId : '';
  return {
    kind,
    userId,
    summaryId,
    activityId,
    activityType: str(summary.activityType ?? item.activityType, 60),
    startedAtSec,
    startOffsetSec: within(num(summary.startTimeOffsetInSeconds), -14 * 3600, 14 * 3600),
    durationSec,
    distanceMeters: within(num(summary.distanceInMeters), 0, 1_000_000),
    avgHeartRateBpm: within(num(summary.averageHeartRateInBeatsPerMinute), 30, 230),
    maxHeartRateBpm: within(num(summary.maxHeartRateInBeatsPerMinute), 30, 250),
    avgRunCadenceSpm: within(num(summary.averageRunCadenceInStepsPerMinute), 0, 400),
    powerAvgWatts: null,
    elevationGainMeters: within(num(summary.totalElevationGainInMeters), 0, 20_000),
    caloriesKcal: within(num(summary.activeKilocalories), 0, 50_000),
    deviceName: str(summary.deviceName ?? item.deviceName, 80),
    samples: null,
  };
}

function readSamples(raw: unknown, startedAtSec: number): GarminSample[] | null {
  if (!Array.isArray(raw)) return null;
  const byOffset = new Map<number, GarminSample>();
  for (const entry of raw.slice(0, GARMIN_MAX_SAMPLES)) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const t = num(s.startTimeInSeconds);
    if (t === null) continue;
    const offsetSec = Math.round(t - startedAtSec);
    if (offsetSec < 0 || offsetSec > MAX_DURATION_SEC) continue;
    const speedMps = within(num(s.speedMetersPerSecond), 0, 100);
    // NUNCA le latitudeInDegree / longitudeInDegree / airTemperatureCelcius: nao existem no tipo.
    byOffset.set(offsetSec, {
      offsetSec,
      heartRateBpm: within(num(s.heartRate), 30, 250),
      speedKmh: speedMps === null ? null : speedMps * 3.6,
      distanceMeters: within(num(s.totalDistanceInMeters), 0, 1_000_000),
      cadenceSpm: within(num(s.stepsPerMinute), 0, 400),
      powerWatts: within(num(s.powerInWatts), 0, 3000),
      elevationMeters: within(num(s.elevationInMeters), -500, 9000),
    });
  }
  return [...byOffset.values()].sort((a, b) => a.offsetSec - b.offsetSec);
}

export interface GarminActivityParse { records: GarminActivityRecord[]; ignored: number }

export function parseGarminActivityPush(body: unknown): GarminActivityParse {
  const out: GarminActivityRecord[] = [];
  let ignored = 0;
  if (!body || typeof body !== 'object') return { records: out, ignored };
  const root = body as Record<string, unknown>;

  for (const entry of Array.isArray(root.activities) ? root.activities : []) {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    const userId = item ? str(item.userId, 128) : null;
    if (!item || !userId || !ID_PATTERN.test(userId) || item.manual === true || item.isParent === true) { ignored += 1; continue; }
    const record = readSummary(item, item, userId, 'summary');
    if (record) out.push(record); else ignored += 1;
  }

  for (const entry of Array.isArray(root.activityDetails) ? root.activityDetails : []) {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    const userId = item ? str(item.userId, 128) : null;
    const summary = item && item.summary && typeof item.summary === 'object' ? (item.summary as Record<string, unknown>) : null;
    if (!item || !summary || !userId || !ID_PATTERN.test(userId) || summary.manual === true || item.manual === true || summary.isParent === true) { ignored += 1; continue; }
    const record = readSummary(item, summary, userId, 'details');
    if (!record) { ignored += 1; continue; }
    record.samples = readSamples(item.samples, record.startedAtSec);
    // Potencia media: media simples das amostras com potencia (o resumo do Garmin nao traz potencia media na corrida).
    const watts = (record.samples ?? []).map((sample) => sample.powerWatts).filter((value): value is number => value !== null);
    record.powerAvgWatts = watts.length > 0 ? watts.reduce((a, b) => a + b, 0) / watts.length : null;
    out.push(record);
  }
  return { records: out, ignored };
}

export const GARMIN_ACTIVITY_EVENT_TYPES = ['activity_summary', 'activity_details'] as const;
export type GarminActivityEventType = (typeof GARMIN_ACTIVITY_EVENT_TYPES)[number];

// Rascunhos para a fila: payload JA' filtrado (sem coordenadas). dedupeKey inclui um resumo do conteudo: reenvio igual nao vira dois trabalhos, atualizacao real sim (a gravacao e' idempotente).
export function toActivityDrafts(records: GarminActivityRecord[]): InboundEventDraft[] {
  return records.map((record) => {
    const payload = record as unknown as Record<string, unknown>;
    const hash = createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
    return {
      category: 'activity',
      dedupeKey: `act:${record.kind}:${record.summaryId}:${hash}`.slice(0, 200),
      eventType: record.kind === 'summary' ? 'activity_summary' : 'activity_details',
      externalAccountId: record.userId,
      payload,
    };
  });
}
