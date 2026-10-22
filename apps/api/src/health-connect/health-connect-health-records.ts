// Normalizacao dos registros de SAUDE do Health Connect (sono, saude diaria, HRV e indicadores) — 22/10/2026. Fronteira pura (sem Prisma): valida o que o app enviou e devolve campos prontos para
// as tabelas Wearable* (as MESMAS usadas pela Zepp; o provedor fica em `provider = 'health_connect'`). Regras:
//  - nada e' estimado: campo ausente = nulo; somar segmentos/amostras que o proprio Health Connect entregou e' agregacao, nao estimativa;
//  - a origem (app que gravou: Samsung Health etc.) e o aparelho ficam preservados em `origin`;
//  - cada tipo exige UMA categoria autorizada pelo aluno (ver HEALTH_RECORD_CATEGORY) — a checagem e' do servico, aqui so' se declara qual.

export const HEALTH_RECORDS_PAYLOAD_SCHEMA = 'health-connect-health-v1';
export const MAX_HEALTH_RECORDS_PER_BATCH = 100;
const MAX_JSON_BYTES = 6 * 1024;
const MAX_STAGE_SEGMENTS = 500;

export const HEALTH_METRIC_KINDS = ['vo2_max', 'body_composition', 'pulse_ox', 'skin_temperature', 'respiratory_rate', 'nutrition', 'hydration', 'daily_energy'] as const;
export type HealthMetricKind = (typeof HEALTH_METRIC_KINDS)[number];

// Categoria de consentimento que cada tipo de registro exige.
export const HEALTH_RECORD_CATEGORY: Record<string, string> = {
  sleep: 'sleep', hrv: 'hrv', daily: 'daily_activity',
  vo2_max: 'vo2_max', body_composition: 'body_composition', pulse_ox: 'pulse_ox', skin_temperature: 'skin_temperature', respiratory_rate: 'respiratory_rate',
  nutrition: 'nutrition', hydration: 'nutrition', daily_energy: 'daily_activity',
};

export interface RecordOrigin { dataOrigin: string | null; device: { manufacturer: string | null; model: string | null; type: number | null } | null; lastModifiedTime: string | null }

export type NormalizedHealthRecord =
  | { type: 'sleep'; identity: string; calendarDate: string; startTimeSec: number; startOffsetSec: number; origin: RecordOrigin; data: { durationSec: number; deepSleepSec: number | null; lightSleepSec: number | null; remSleepSec: number | null; awakeSec: number | null; unmeasurableSec: number | null; endTimeSec: number; levels: unknown } }
  | { type: 'daily'; identity: string; calendarDate: string; startTimeSec: number; startOffsetSec: number; origin: RecordOrigin; data: { steps: number | null; distanceMeters: number | null; activeKilocalories: number | null; restingHeartRateBpm: number | null } }
  | { type: 'hrv'; identity: string; calendarDate: string; startTimeSec: number; startOffsetSec: number; origin: RecordOrigin; data: { lastNightAvg: number; hrvValues: unknown } }
  | { type: 'metric'; identity: string; metricKind: HealthMetricKind; calendarDate: string | null; startTimeSec: number; startOffsetSec: number | null; origin: RecordOrigin; values: Record<string, unknown> };

export type NormalizeHealthResult = { ok: true; value: NormalizedHealthRecord } | { ok: false; reason: string; recordId: string | null };

const asString = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asIso = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};
const asInt = (v: unknown, min = 0, max = 1_000_000_000): number | null => {
  const n = asNumber(v);
  return n !== null && n >= min && n <= max ? Math.round(n) : null;
};

function localDate(epochMs: number, offsetSec: number): string {
  return new Date(epochMs + offsetSec * 1000).toISOString().slice(0, 10);
}

function origin(input: Record<string, unknown>): RecordOrigin {
  const device = input.device && typeof input.device === 'object' ? (input.device as Record<string, unknown>) : null;
  return {
    dataOrigin: asString(input.dataOrigin),
    lastModifiedTime: typeof input.lastModifiedTime === 'string' && asIso(input.lastModifiedTime) !== null ? input.lastModifiedTime : null,
    device: device ? { manufacturer: asString(device.manufacturer, 80), model: asString(device.model, 80), type: asInt(device.type, 0, 20) } : null,
  };
}

// So' tipos/numeros/textos curtos, com profundidade e tamanho limitados (o valor e' guardado como o Health Connect entregou, mas nunca como execucao arbitraria).
export function sanitizeValues(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 200);
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeValues(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      if (/^[A-Za-z0-9_]{1,40}$/.test(key) && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') out[key] = sanitizeValues(inner, depth + 1);
    }
    return out;
  }
  return null;
}

const SLEEP_STAGE = { awake: [1, 7], light: [4], deep: [5], rem: [6], unmeasurable: [0, 3] } as const;

export function normalizeHealthRecord(input: unknown): NormalizeHealthResult {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : null;
  const recordId = raw ? asString(raw.recordId) : null;
  const fail = (reason: string): NormalizeHealthResult => ({ ok: false, reason, recordId });
  if (!raw) return fail('registro_invalido');
  const kind = asString(raw.kind, 40);
  if (!kind || !Object.prototype.hasOwnProperty.call(HEALTH_RECORD_CATEGORY, kind)) return fail('tipo_desconhecido');
  if (JSON.stringify(raw).length > MAX_JSON_BYTES * 4) return fail('registro_grande_demais');
  const meta = origin(raw);
  const offsetSec = asInt(raw.startZoneOffsetSeconds, -86_400, 86_400) ?? asInt(raw.startOffsetSeconds, -86_400, 86_400);

  if (kind === 'sleep') {
    const start = asIso(raw.startTime); const end = asIso(raw.endTime);
    if (start === null || end === null || end <= start || end - start > 48 * 3600_000) return fail('sono_invalido');
    const off = offsetSec ?? 0;
    const sums = { awake: 0, light: 0, deep: 0, rem: 0, unmeasurable: 0 };
    const segments: Array<{ stage: number; startSec: number; endSec: number }> = [];
    const stages = Array.isArray(raw.stages) ? raw.stages.slice(0, MAX_STAGE_SEGMENTS) : [];
    let any = false;
    for (const segment of stages) {
      const s = segment && typeof segment === 'object' ? (segment as Record<string, unknown>) : {};
      const a = asIso(s.startTime); const b = asIso(s.endTime); const stage = asInt(s.stage, 0, 20);
      if (a === null || b === null || stage === null || b <= a) continue;
      const from = Math.max(a, start); const to = Math.min(b, end);
      if (to <= from) continue;
      any = true;
      segments.push({ stage, startSec: Math.floor(from / 1000), endSec: Math.floor(to / 1000) });
      for (const name of Object.keys(sums) as Array<keyof typeof sums>) if ((SLEEP_STAGE[name] as readonly number[]).includes(stage)) sums[name] += Math.round((to - from) / 1000);
    }
    return {
      ok: true,
      value: {
        type: 'sleep', identity: `sleep:${recordId ?? Math.floor(start / 1000)}`, calendarDate: localDate(end, off), startTimeSec: Math.floor(start / 1000), startOffsetSec: off, origin: meta,
        data: {
          durationSec: Math.round((end - start) / 1000), endTimeSec: Math.floor(end / 1000),
          // Sem segmentos de etapa o Health Connect nao informa a divisao: ficam nulos (nunca zero inventado).
          deepSleepSec: any ? sums.deep : null, lightSleepSec: any ? sums.light : null, remSleepSec: any ? sums.rem : null, awakeSec: any ? sums.awake : null, unmeasurableSec: any ? sums.unmeasurable : null,
          levels: any ? segments : null,
        },
      },
    };
  }

  if (kind === 'daily') {
    const date = asString(raw.calendarDate, 10);
    const start = asIso(raw.startTime);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || start === null) return fail('dia_invalido');
    const data = {
      steps: asInt(raw.steps, 0, 200_000), distanceMeters: (() => { const d = asNumber(raw.distanceMeters); return d !== null && d >= 0 && d <= 1_000_000 ? d : null; })(),
      activeKilocalories: (() => { const k = asNumber(raw.activeKilocalories); return k !== null && k >= 0 && k <= 50_000 ? k : null; })(), restingHeartRateBpm: asInt(raw.restingHeartRateBpm, 1, 300),
    };
    if (Object.values(data).every((v) => v === null)) return fail('dia_sem_dados');
    return { ok: true, value: { type: 'daily', identity: `daily:${date}`, calendarDate: date, startTimeSec: Math.floor(start / 1000), startOffsetSec: offsetSec ?? 0, origin: meta, data } };
  }

  if (kind === 'hrv') {
    const date = asString(raw.calendarDate, 10);
    const start = asIso(raw.startTime);
    const avg = asNumber(raw.lastNightAvg);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || start === null || avg === null || avg <= 0 || avg > 1000) return fail('hrv_invalido');
    const count = asInt(raw.sampleCount, 0, 100_000);
    return { ok: true, value: { type: 'hrv', identity: `hrv:${date}`, calendarDate: date, startTimeSec: Math.floor(start / 1000), startOffsetSec: offsetSec ?? 0, origin: meta, data: { lastNightAvg: avg, hrvValues: { metric: 'rmssd_ms', sampleCount: count } } } };
  }

  // Indicadores genericos: os campos ficam EXATAMENTE como o Health Connect entregou (unidades originais), saneados.
  const metricKind = kind as HealthMetricKind;
  const start = asIso(raw.startTime);
  if (start === null) return fail('horario_invalido');
  const values = sanitizeValues(raw.values);
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length === 0 || JSON.stringify(values).length > MAX_JSON_BYTES) return fail('valores_invalidos');
  const date = asString(raw.calendarDate, 10);
  return {
    ok: true,
    value: { type: 'metric', metricKind, identity: recordId ? `${metricKind}:${recordId}` : `${metricKind}:${Math.floor(start / 1000)}`, calendarDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, startTimeSec: Math.floor(start / 1000), startOffsetSec: offsetSec, origin: meta, values: { ...(values as Record<string, unknown>), _origin: { dataOrigin: meta.dataOrigin, device: meta.device } } },
  };
}
