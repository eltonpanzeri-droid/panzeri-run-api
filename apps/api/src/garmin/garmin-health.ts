import { createHash } from 'node:crypto';
import { InboundEventDraft } from '../provider-hub/provider-connector';

// Saude e recuperacao da Garmin por PUSH (Health API 2.1, Starter: so' push; "Health_API_2.1.pdf" na pasta "Documentação Garmin"), 08/11/2026. Parte PURA (sem banco, sem rede).
// Tipos tratados (chave da lista no JSON -> onde grava):
//   dailies       -> WearableDailySummary (passos, distancia, calorias ativas, FC de repouso, meta de passos) + metrica `lifestyle_load` (estresse medio/maximo e Body Battery do dia)
//   sleeps        -> WearableSleepSummary (duracao, etapas, cochilos, pontuacao, validacao, mapa de etapas)
//   hrv           -> WearableHrvSummary (media da noite + valores a cada 5 min)
//   stressDetails -> metrica `lifestyle_load` (estresse a cada 3 min, Body Battery e eventos que o afetaram)
//   userMetrics   -> metrica `vo2_max` (VO2 maximo corrida/bike e idade fitness)
//   bodyComps     -> metrica `body_composition` (peso, gordura, massa muscular, agua, IMC)
// Lote 5 (08/11/2026) — TODOS os demais tipos de saude, guardados como a Garmin enviou (metrica generica, valores sanitizados, nada inventado, sem coordenadas), um grupo de autorizacao por tipo:
//   epochs -> `epoch` (categoria daily_activity) | pulseox -> `pulse_ox` | allDayRespiration -> `respiration` e breathingVariations -> `breathing_variations` (respiratory_rate) | healthSnapshot -> `health_snapshot` (heart_rate)
//   bloodPressures -> `blood_pressure` (clinical_vitals; sensivel) | skinTemp -> `skin_temperature` | nutrition -> `nutrition` e hydration -> `hydration` (nutrition)
// Tipos que nao trazem horario (nutricao, hidratacao): a ancora e' o meio-dia UTC do calendarDate. O SpO2 e a respiracao DENTRO do resumo de sono continuam sem ser guardados (so' o que a Politica descreve).
// Atualizacao: a Garmin reenvia o MESMO resumo com mais dados (sono noturno, dia parcial): a gravacao e' idempotente por (aluna, provedor, dia, inicio) e substitui o anterior.
export const GARMIN_HEALTH_EVENT_TYPES = ['sleep_summary', 'daily_summary', 'hrv_summary', 'metric_summary'] as const;
export const GARMIN_METRIC_KINDS = ['lifestyle_load', 'vo2_max', 'body_composition', 'epoch', 'pulse_ox', 'respiration', 'breathing_variations', 'health_snapshot', 'blood_pressure', 'skin_temperature', 'nutrition', 'hydration'] as const;
export type GarminMetricKind = (typeof GARMIN_METRIC_KINDS)[number];
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MAP_ENTRIES = 5000;

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const int = (value: unknown): number | null => { const n = num(value); return n === null ? null : Math.round(n); };
const str = (value: unknown, max = 120): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const within = (value: number | null, min: number, max: number): number | null => (value !== null && value >= min && value <= max ? value : null);
const obj = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// Mapa "deslocamento em segundos -> valor numerico": mantem so' pares validos (nada e' inventado) e limita o tamanho.
function numericMap(value: unknown, min: number, max: number): Record<string, number> | null {
  const source = obj(value);
  if (!source) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(source).slice(0, MAX_MAP_ENTRIES)) {
    const n = num(raw);
    if (n !== null && n >= min && n <= max && /^-?\d{1,7}$/.test(key.trim())) out[key.trim()] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface GarminHealthRecord {
  eventType: (typeof GARMIN_HEALTH_EVENT_TYPES)[number];
  userId: string;
  summaryId: string | null;
  calendarDate: string | null;
  startTimeSec: number;
  startOffsetSec: number | null;
  // Campos ja' no formato que o processador grava (nomes do WearableSleepSummary / DailySummary / HrvSummary) ou, para metricas, kind + values.
  fields: Record<string, unknown>;
  metricKind?: GarminMetricKind;
  identityKey?: string;
}

const noonUtc = (calendarDate: string): number => Math.floor(Date.parse(`${calendarDate}T12:00:00Z`) / 1000);

// Copia o JSON da Garmin com limites (profundidade, tamanho) e SEM identificadores, links de download ou coordenadas. Nada e' reescrito nem estimado.
const DROP_KEYS = /^(userId|callbackURL|token|latitude|longitude|latitudeInDegree|longitudeInDegree)$/i;
function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 200);
  if (depth >= 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 500).map((entry) => sanitizeValue(entry, depth + 1)).filter((entry) => entry !== undefined);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_MAP_ENTRIES)) {
      if (DROP_KEYS.test(key)) continue;
      const clean = sanitizeValue(entry, depth + 1);
      if (clean !== undefined) out[key.slice(0, 60)] = clean;
    }
    return out;
  }
  return undefined;
}
const DROP_ON_COPY = new Set(['userId', 'summaryId', 'callbackURL']);
const copyFields = (item: Record<string, unknown>): Record<string, unknown> => {
  const copy = sanitizeValue(Object.fromEntries(Object.entries(item).filter(([key]) => !DROP_ON_COPY.has(key)))) as Record<string, unknown>;
  return copy;
};

export function parseGarminHealthPush(body: unknown): { records: GarminHealthRecord[]; ignored: number } {
  const out: GarminHealthRecord[] = [];
  let ignored = 0;
  const root = obj(body);
  if (!root) return { records: out, ignored };
  const common = (item: Record<string, unknown>) => {
    const userId = str(item.userId, 128);
    const summaryId = str(item.summaryId, 128);
    const calendarDate = typeof item.calendarDate === 'string' && CALENDAR_DATE.test(item.calendarDate) ? item.calendarDate : null;
    return { userId: userId && ID_PATTERN.test(userId) ? userId : null, summaryId: summaryId && ID_PATTERN.test(summaryId) ? summaryId : null, calendarDate };
  };

  for (const entry of list(root.dailies)) {
    const item = obj(entry);
    const c = item ? common(item) : null;
    const start = item ? int(item.startTimeInSeconds) : null;
    if (!item || !c?.userId || !c.calendarDate || start === null || start <= 0) { ignored += 1; continue; }
    const offset = within(int(item.startTimeOffsetInSeconds), -14 * 3600, 14 * 3600);
    out.push({
      eventType: 'daily_summary', userId: c.userId, summaryId: c.summaryId, calendarDate: c.calendarDate, startTimeSec: start, startOffsetSec: offset,
      fields: {
        durationSec: within(int(item.durationInSeconds), 0, 172_800), steps: within(int(item.steps), 0, 200_000), distanceMeters: within(num(item.distanceInMeters), 0, 1_000_000),
        activeKilocalories: within(num(item.activeKilocalories), 0, 50_000), restingHeartRateBpm: within(int(item.restingHeartRateInBeatsPerMinute), 20, 150), stepsGoal: within(int(item.stepsGoal), 0, 500_000),
      },
    });
    // Estresse medio/maximo e Body Battery do dia: metrica propria (categoria lifestyle_load), uma por dia.
    const stress = { averageStressLevel: within(int(item.averageStressLevel), -5, 100), maxStressLevel: within(int(item.maxStressLevel), -5, 100), stressQualifier: str(item.stressQualifier, 40), bodyBatteryChargedValue: within(int(item.bodyBatteryChargedValue), 0, 200), bodyBatteryDrainedValue: within(int(item.bodyBatteryDrainedValue), 0, 200) };
    if (Object.values(stress).some((value) => value !== null)) {
      out.push({ eventType: 'metric_summary', metricKind: 'lifestyle_load', identityKey: `daily:${c.calendarDate}`, userId: c.userId, summaryId: c.summaryId, calendarDate: c.calendarDate, startTimeSec: start, startOffsetSec: offset, fields: { kind: 'daily_stress_body_battery', ...stress } });
    }
  }

  for (const entry of list(root.sleeps)) {
    const item = obj(entry);
    const c = item ? common(item) : null;
    const start = item ? int(item.startTimeInSeconds) : null;
    if (!item || !c?.userId || !c.calendarDate || start === null || start <= 0) { ignored += 1; continue; }
    const levels = obj(item.sleepLevelsMap);
    // Fim da noite: so' quando os segmentos de etapas o informam (maior fim); nunca estimado.
    let endTimeSec: number | null = null;
    if (levels) for (const segments of Object.values(levels)) for (const segment of list(segments)) { const end = int(obj(segment)?.endTimeInSeconds); if (end !== null && (endTimeSec === null || end > endTimeSec)) endTimeSec = end; }
    const score = obj(item.overallSleepScore);
    out.push({
      eventType: 'sleep_summary', userId: c.userId, summaryId: c.summaryId, calendarDate: c.calendarDate, startTimeSec: start, startOffsetSec: within(int(item.startTimeOffsetInSeconds), -14 * 3600, 14 * 3600),
      fields: {
        durationSec: within(int(item.durationInSeconds), 0, 172_800), deepSleepSec: within(int(item.deepSleepDurationInSeconds), 0, 172_800), lightSleepSec: within(int(item.lightSleepDurationInSeconds), 0, 172_800),
        remSleepSec: within(int(item.remSleepInSeconds), 0, 172_800), awakeSec: within(int(item.awakeDurationInSeconds), 0, 172_800), napTotalSec: within(int(item.totalNapDurationInSeconds), 0, 172_800),
        unmeasurableSec: within(int(item.unmeasurableSleepInSeconds ?? item.unmeasurableSleepDurationInSeconds), 0, 172_800),
        scoreValue: within(int(score?.value), 0, 100), scoreQualifier: str(score?.qualifierKey, 40), validation: str(item.validation, 40), endTimeSec,
        levels: levels ?? undefined, naps: Array.isArray(item.naps) ? item.naps.slice(0, 20) : undefined, sleepScores: obj(item.sleepScores) ?? undefined,
      },
    });
  }

  for (const entry of list(root.hrv)) {
    const item = obj(entry);
    const c = item ? common(item) : null;
    const start = item ? int(item.startTimeInSeconds) : null;
    const avg = item ? num(item.lastNightAvg) : null;
    if (!item || !c?.userId || !c.calendarDate || start === null || start <= 0 || avg === null || avg < 0 || avg > 500) { ignored += 1; continue; }
    out.push({
      eventType: 'hrv_summary', userId: c.userId, summaryId: c.summaryId, calendarDate: c.calendarDate, startTimeSec: start, startOffsetSec: within(int(item.startTimeOffsetInSeconds), -14 * 3600, 14 * 3600),
      fields: { durationSec: within(int(item.durationInSeconds), 0, 172_800), lastNightAvg: avg, hrvValues: numericMap(item.hrvValues, 0, 500) ?? undefined },
    });
  }

  for (const entry of list(root.stressDetails)) {
    const item = obj(entry);
    const c = item ? common(item) : null;
    const start = item ? int(item.startTimeInSeconds) : null;
    if (!item || !c?.userId || !c.summaryId || start === null || start <= 0) { ignored += 1; continue; }
    const events = list(item.bodyBatteryActivityEvents).slice(0, 50).map((event) => {
      const e = obj(event);
      return e ? { eventType: str(e.eventType, 30), eventStartTimeInSeconds: int(e.eventStartTimeInSeconds), duration: int(e.duration), bodyBatteryImpact: int(e.bodyBatteryImpact) } : null;
    }).filter((event) => event !== null);
    out.push({
      eventType: 'metric_summary', metricKind: 'lifestyle_load', identityKey: `stress:${c.summaryId}`, userId: c.userId, summaryId: c.summaryId, calendarDate: c.calendarDate, startTimeSec: start,
      startOffsetSec: within(int(item.startTimeOffsetInSeconds), -14 * 3600, 14 * 3600),
      fields: { kind: 'stress_details', durationSec: within(int(item.durationInSeconds), 0, 172_800), timeOffsetStressLevelValues: numericMap(item.timeOffsetStressLevelValues, -5, 100), timeOffsetBodyBatteryValues: numericMap(item.timeOffsetBodyBatteryValues, 0, 100), bodyBatteryDynamicFeedbackEvent: obj(item.bodyBatteryDynamicFeedbackEvent) ?? undefined, bodyBatteryActivityEvents: events.length > 0 ? events : undefined },
    });
  }

  for (const entry of list(root.userMetrics)) {
    const item = obj(entry);
    const c = item ? common(item) : null;
    if (!item || !c?.userId || !c.calendarDate) { ignored += 1; continue; }
    const values = { vo2Max: within(num(item.vo2Max), 10, 100), vo2MaxCycling: within(num(item.vo2MaxCycling), 10, 100), fitnessAge: within(int(item.fitnessAge), 10, 110), enhanced: typeof item.enhanced === 'boolean' ? item.enhanced : null };
    if (values.vo2Max === null && values.vo2MaxCycling === null && values.fitnessAge === null) { ignored += 1; continue; }
    // UserMetrics so' tem a data do calendario (sem horario): usa o meio-dia UTC daquele dia como ancora, identidade por dia.
    out.push({ eventType: 'metric_summary', metricKind: 'vo2_max', identityKey: `vo2:${c.calendarDate}`, userId: c.userId, summaryId: c.summaryId, calendarDate: c.calendarDate, startTimeSec: noonUtc(c.calendarDate), startOffsetSec: null, fields: { kind: 'user_metrics', ...values } });
  }

  for (const entry of list(root.bodyComps)) {
    const item = obj(entry);
    const c = item ? common(item) : null;
    const start = item ? int(item.measurementTimeInSeconds) : null;
    if (!item || !c?.userId || !c.summaryId || start === null || start <= 0) { ignored += 1; continue; }
    out.push({
      eventType: 'metric_summary', metricKind: 'body_composition', identityKey: `body:${c.summaryId}`, userId: c.userId, summaryId: c.summaryId, calendarDate: c.calendarDate, startTimeSec: start,
      startOffsetSec: within(int(item.measurementTimeOffsetInSeconds), -14 * 3600, 14 * 3600),
      fields: { kind: 'body_composition', weightInGrams: within(num(item.weightInGrams), 10_000, 500_000), bodyFatInPercent: within(num(item.bodyFatInPercent), 0, 100), bodyWaterInPercent: within(num(item.bodyWaterInPercent), 0, 100), muscleMassInGrams: within(num(item.muscleMassInGrams), 0, 200_000), boneMassInGrams: within(num(item.boneMassInGrams), 0, 20_000), bodyMassIndex: within(num(item.bodyMassIndex), 5, 100) },
    });
  }
  // ---- Lote 5: demais tipos (metrica generica)
  const generic = (key: string, kind: GarminMetricKind, identity: (item: Record<string, unknown>, c: ReturnType<typeof common>, start: number) => string | null, startOf: (item: Record<string, unknown>, c: ReturnType<typeof common>) => number | null) => {
    for (const entry of list(root[key])) {
      const item = obj(entry);
      const c = item ? common(item) : null;
      const start = item && c ? startOf(item, c) : null;
      const identityKey = item && c && start !== null ? identity(item, c, start) : null;
      if (!item || !c?.userId || start === null || start <= 0 || !identityKey) { ignored += 1; continue; }
      const offset = within(int(item.startTimeOffsetInSeconds ?? item.measurementTimeOffsetInSeconds ?? item.offsetStartTimeInSeconds ?? item.timeOffsetInSeconds), -14 * 3600, 14 * 3600);
      out.push({ eventType: 'metric_summary', metricKind: kind, identityKey: identityKey.slice(0, 140), userId: c.userId, summaryId: c.summaryId, calendarDate: c.calendarDate, startTimeSec: start, startOffsetSec: offset, fields: { kind, ...copyFields(item) } });
    }
  };
  const startTime = (item: Record<string, unknown>) => { const s = int(item.startTimeInSeconds); return s !== null && s > 0 ? s : null; };
  const dayAnchor = (_item: Record<string, unknown>, c: ReturnType<typeof common>) => (c.calendarDate ? noonUtc(c.calendarDate) : null);
  generic('epochs', 'epoch', (item, _c, start) => `epoch:${start}:${str(item.activityType, 30) ?? 'x'}`, startTime);
  generic('pulseox', 'pulse_ox', (item, c, start) => `pox:${c.summaryId ?? start}`, startTime);
  generic('allDayRespiration', 'respiration', (_item, c, start) => `resp:${c.summaryId ?? start}`, startTime);
  generic('healthSnapshot', 'health_snapshot', (_item, c, start) => `snap:${c.summaryId ?? start}`, startTime);
  generic('bloodPressures', 'blood_pressure', (_item, c, start) => `bp:${c.summaryId ?? start}`, (item) => { const s = int(item.measurementTimeInSeconds); return s !== null && s > 0 ? s : null; });
  generic('skinTemp', 'skin_temperature', (_item, c, start) => `skin:${c.summaryId ?? start}`, startTime);
  generic('nutrition', 'nutrition', (_item, c) => (c.calendarDate ? `nutri:${c.calendarDate}` : null), dayAnchor);
  generic('hydration', 'hydration', (_item, c) => (c.calendarDate ? `hydra:${c.calendarDate}` : null), dayAnchor);
  generic('breathingVariations', 'breathing_variations', (_item, c, start) => `breath:${c.summaryId ?? start}`, (item, c) => {
    const first = int(obj(list(item.readings)[0])?.startTimeInSeconds);
    return first !== null && first > 0 ? first : c.calendarDate ? noonUtc(c.calendarDate) : null;
  });
  return { records: out, ignored };
}

// Categoria exigida de cada tipo (o que a aluna precisa ter autorizado).
export function requiredCategoryOf(record: Pick<GarminHealthRecord, 'eventType' | 'metricKind'>): string | null {
  if (record.eventType === 'sleep_summary') return 'sleep';
  if (record.eventType === 'hrv_summary') return 'hrv';
  if (record.eventType === 'daily_summary') return 'daily_activity';
  switch (record.metricKind) {
    case 'lifestyle_load': return 'lifestyle_load';
    case 'vo2_max': return 'vo2_max';
    case 'body_composition': return 'body_composition';
    case 'epoch': return 'daily_activity';
    case 'pulse_ox': return 'pulse_ox';
    case 'respiration':
    case 'breathing_variations': return 'respiratory_rate';
    case 'health_snapshot': return 'heart_rate';
    case 'blood_pressure': return 'clinical_vitals';
    case 'skin_temperature': return 'skin_temperature';
    case 'nutrition':
    case 'hydration': return 'nutrition';
    default: return null;
  }
}

export function toHealthDrafts(records: GarminHealthRecord[]): InboundEventDraft[] {
  const drafts: InboundEventDraft[] = [];
  for (const record of records) {
    const category = requiredCategoryOf(record);
    if (!category) continue;
    const payload = record as unknown as Record<string, unknown>;
    const hash = createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
    drafts.push({ category: category as InboundEventDraft['category'], dedupeKey: `health:${record.eventType}:${record.identityKey ?? record.summaryId ?? record.startTimeSec}:${hash}`.slice(0, 200), eventType: record.eventType, externalAccountId: record.userId, payload });
  }
  return drafts;
}
