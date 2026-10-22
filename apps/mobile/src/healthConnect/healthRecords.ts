// Montagem dos registros de SAUDE do Health Connect para o servidor (22/10/2026). Modulo PURO. Mesmo contrato da API (health-connect-health-records.ts): nada e' estimado; campo ausente = null;
// agregar o que o proprio Health Connect entregou (somar segmentos, media das amostras da MESMA origem) nao e' estimativa. A origem (app que gravou) e o aparelho vao junto.

export interface HcMeta { id?: string; dataOrigin?: string; lastModifiedTime?: string; clientRecordId?: string; device?: { manufacturer?: string; model?: string; type?: number }; recordingMethod?: number }
type Zone = { totalSeconds?: number } | null | undefined;
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const ms = (iso: string) => new Date(iso).getTime();

function origin(meta: HcMeta | undefined) {
  const device = meta?.device;
  const hasDevice = !!device && (device.manufacturer != null || device.model != null || device.type != null);
  return {
    dataOrigin: meta?.dataOrigin ?? null,
    lastModifiedTime: meta?.lastModifiedTime ?? null,
    device: hasDevice ? { manufacturer: device!.manufacturer ?? null, model: device!.model ?? null, type: typeof device!.type === 'number' ? device!.type : null } : null,
  };
}
const offsetOf = (zone: Zone): number | null => (typeof zone?.totalSeconds === 'number' ? zone.totalSeconds : null);

// Dia local (AAAA-MM-DD) de um instante, no fuso informado pelo Health Connect (ou 0 se nao informado).
export function localDateOf(iso: string, offsetSec: number | null): string {
  return new Date(ms(iso) + (offsetSec ?? 0) * 1000).toISOString().slice(0, 10);
}

// Dias locais (fuso do aparelho) entre dois instantes, do mais antigo ao mais novo; o ultimo termina em `end`. Cada dia leva o deslocamento do fuso em segundos.
export function enumerateLocalDays(start: Date, end: Date): Array<{ date: string; start: Date; end: Date; offsetSec: number }> {
  const out: Array<{ date: string; start: Date; end: Date; offsetSec: number }> = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  while (cursor.getTime() <= end.getTime() && out.length < 500) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 0, 0, 0, 0);
    out.push({ date: `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`, start: new Date(cursor), end: next.getTime() > end.getTime() ? new Date(end) : next, offsetSec: -cursor.getTimezoneOffset() * 60 });
    cursor.setTime(next.getTime());
  }
  return out;
}

// Divide em lotes por TAMANHO serializado e por quantidade: o servidor recusa corpo acima de ~100 KB (sono em etapas e' pesado), e um lote recusado travaria toda a sincronizacao de saude.
export function chunkBySize<T>(items: T[], maxBytes: number, maxCount: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    const itemSize = JSON.stringify(item).length + 1;
    if (current.length > 0 && (current.length >= maxCount || size + itemSize > maxBytes)) { chunks.push(current); current = []; size = 0; }
    current.push(item);
    size += itemSize;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export interface HealthRecordPayload { kind: string; recordId?: string; [key: string]: unknown }

// ---- Sono ---------------------------------------------------------------------------------------------------------------------------------
export interface HcSleepSession { metadata?: HcMeta; startTime: string; endTime: string; startZoneOffset?: Zone; stages?: Array<{ startTime: string; endTime: string; stage: number }> }
export function buildSleepRecord(session: HcSleepSession): HealthRecordPayload | null {
  if (!session.metadata?.id) return null;
  return {
    kind: 'sleep', recordId: session.metadata.id, ...origin(session.metadata), startTime: session.startTime, endTime: session.endTime, startZoneOffsetSeconds: offsetOf(session.startZoneOffset),
    stages: (session.stages ?? []).map((s) => ({ stage: s.stage, startTime: s.startTime, endTime: s.endTime })),
  };
}

// ---- Dia (agregado do proprio Health Connect, que ja' evita contar duas vezes o mesmo passo gravado por celular e relogio) ----------------------
export interface DayAggregate { steps: number | null; distanceMeters: number | null; activeKilocalories: number | null; totalKilocalories: number | null }
export function buildDailyRecord(date: string, dayStartIso: string, offsetSec: number | null, aggregate: DayAggregate, restingHeartRateBpm: number | null, includeActivity: boolean): HealthRecordPayload | null {
  const body = includeActivity ? aggregate : { steps: null, distanceMeters: null, activeKilocalories: null, totalKilocalories: null };
  if (body.steps === null && body.distanceMeters === null && body.activeKilocalories === null && restingHeartRateBpm === null) return null;
  return { kind: 'daily', recordId: `daily:${date}`, calendarDate: date, startTime: dayStartIso, startZoneOffsetSeconds: offsetSec, steps: body.steps, distanceMeters: body.distanceMeters, activeKilocalories: body.activeKilocalories, restingHeartRateBpm };
}
// Gasto total do dia vai como indicador proprio (a tabela diaria so' tem calorias ativas).
export function buildDailyEnergyRecord(date: string, dayStartIso: string, offsetSec: number | null, totalKilocalories: number | null): HealthRecordPayload | null {
  if (totalKilocalories === null) return null;
  return { kind: 'daily_energy', recordId: `daily_energy:${date}`, calendarDate: date, startTime: dayStartIso, startZoneOffsetSeconds: offsetSec, values: { totalKilocalories } };
}

// FC de repouso do dia: o registro MAIS RECENTE daquele dia (o proprio Health Connect entrega um valor por dia).
export function restingHeartRateByDay(records: Array<{ time: string; zoneOffset?: Zone; beatsPerMinute: number }>): Map<string, number> {
  const latest = new Map<string, { t: number; bpm: number }>();
  for (const r of records) {
    const bpm = num(r.beatsPerMinute);
    if (bpm === null || bpm <= 0) continue;
    const date = localDateOf(r.time, offsetOf(r.zoneOffset));
    const t = ms(r.time);
    const current = latest.get(date);
    if (!current || t > current.t) latest.set(date, { t, bpm: Math.round(bpm) });
  }
  return new Map([...latest].map(([date, v]) => [date, v.bpm]));
}

// ---- HRV (RMSSD): media das amostras entregues em cada dia local; unidade = milissegundos (a que o Health Connect define) --------------------
export function hrvRecordsByDay(records: Array<{ metadata?: HcMeta; time: string; zoneOffset?: Zone; heartRateVariabilityMillis: number }>, onlyDates?: Set<string>): HealthRecordPayload[] {
  const groups = new Map<string, { sum: number; count: number; first: string; offset: number | null; meta?: HcMeta }>();
  for (const r of records) {
    const value = num(r.heartRateVariabilityMillis);
    if (value === null || value <= 0) continue;
    const offset = offsetOf(r.zoneOffset);
    const date = localDateOf(r.time, offset);
    const g = groups.get(date) ?? { sum: 0, count: 0, first: r.time, offset, meta: r.metadata };
    g.sum += value; g.count += 1; if (ms(r.time) < ms(g.first)) g.first = r.time;
    groups.set(date, g);
  }
  // O inicio e' sempre o INICIO DO DIA local (estavel): a mesma data nunca vira duas linhas, mesmo se a janela de leitura comecar no meio do dia. So' as datas pedidas (com registro novo) sao reenviadas.
  return [...groups].filter(([date]) => !onlyDates || onlyDates.has(date)).map(([date, g]) => ({
    kind: 'hrv', recordId: `hrv:${date}`, ...origin(g.meta), calendarDate: date, startTime: new Date(Date.parse(`${date}T00:00:00.000Z`) - (g.offset ?? 0) * 1000).toISOString(), startZoneOffsetSeconds: g.offset,
    lastNightAvg: Math.round((g.sum / g.count) * 100) / 100, sampleCount: g.count,
  }));
}

// ---- Indicadores (campos com os nomes e unidades originais do Health Connect) -----------------------------------------------------------------
type Inst = { metadata?: HcMeta; time: string; zoneOffset?: Zone };
const metric = (kind: string, r: Inst, values: Record<string, unknown>): HealthRecordPayload | null => {
  const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined));
  if (!r.metadata?.id || Object.keys(clean).length === 0) return null;
  return { kind, recordId: r.metadata.id, ...origin(r.metadata), startTime: r.time, startZoneOffsetSeconds: offsetOf(r.zoneOffset), calendarDate: localDateOf(r.time, offsetOf(r.zoneOffset)), values: clean };
};
export const buildVo2Max = (r: Inst & { vo2MillilitersPerMinuteKilogram?: number; measurementMethod?: number }) => metric('vo2_max', r, { vo2MillilitersPerMinuteKilogram: num(r.vo2MillilitersPerMinuteKilogram), measurementMethod: num(r.measurementMethod) });
export const buildOxygen = (r: Inst & { percentage?: number }) => metric('pulse_ox', r, { percentage: num(r.percentage) });
export const buildRespiration = (r: Inst & { rate?: number }) => metric('respiratory_rate', r, { ratePerMinute: num(r.rate) });
export const buildWeight = (r: Inst & { weight?: { inKilograms?: number } }) => metric('body_composition', r, { weightKg: num(r.weight?.inKilograms) });
export const buildBodyFat = (r: Inst & { percentage?: number }) => metric('body_composition', r, { bodyFatPercentage: num(r.percentage) });
export const buildLeanMass = (r: Inst & { mass?: { inKilograms?: number } }) => metric('body_composition', r, { leanBodyMassKg: num(r.mass?.inKilograms) });
export const buildBoneMass = (r: Inst & { mass?: { inKilograms?: number } }) => metric('body_composition', r, { boneMassKg: num(r.mass?.inKilograms) });
export const buildWaterMass = (r: Inst & { mass?: { inKilograms?: number } }) => metric('body_composition', r, { bodyWaterMassKg: num(r.mass?.inKilograms) });
type Interval = { metadata?: HcMeta; startTime: string; endTime: string; startZoneOffset?: Zone };
export function buildNutrition(r: Interval & { name?: string; mealType?: number; energy?: { inKilocalories?: number }; protein?: { inGrams?: number }; totalCarbohydrate?: { inGrams?: number }; totalFat?: { inGrams?: number } }) {
  return metric('nutrition', { metadata: r.metadata, time: r.startTime, zoneOffset: r.startZoneOffset }, { name: r.name ?? null, mealType: num(r.mealType), energyKcal: num(r.energy?.inKilocalories), proteinG: num(r.protein?.inGrams), carbohydrateG: num(r.totalCarbohydrate?.inGrams), fatG: num(r.totalFat?.inGrams), endTime: r.endTime });
}
export function buildHydration(r: Interval & { volume?: { inLiters?: number } }) {
  return metric('hydration', { metadata: r.metadata, time: r.startTime, zoneOffset: r.startZoneOffset }, { volumeLiters: num(r.volume?.inLiters), endTime: r.endTime });
}

// ---- Resumos de um EXERCICIO (registros da MESMA origem DENTRO da sessao; nada fora da sessao entra) ----------------------------------------
type Range = { startTime: string; endTime: string };
const within = (record: Range, session: Range, tolerance = 60_000) => ms(record.startTime) >= ms(session.startTime) - tolerance && ms(record.endTime) <= ms(session.endTime) + tolerance;
const sampleTimeIn = (time: string, session: Range) => ms(time) >= ms(session.startTime) && ms(time) <= ms(session.endTime);
const avgMax = (values: number[]) => (values.length === 0 ? { avg: null, max: null } : { avg: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) });

export function summarizeSpeed(records: Array<Range & { samples?: Array<{ time: string; speed?: { inMetersPerSecond?: number } }> }>, session: Range) {
  const values: number[] = [];
  for (const r of records) for (const s of r.samples ?? []) { const v = num(s.speed?.inMetersPerSecond); if (v !== null && v >= 0 && sampleTimeIn(s.time, session)) values.push(v); }
  const { avg, max } = avgMax(values);
  return { speedAvgMps: avg === null ? null : Math.round(avg * 1000) / 1000, speedMaxMps: max === null ? null : Math.round(max * 1000) / 1000 };
}
export function summarizePower(records: Array<Range & { samples?: Array<{ time: string; power?: { inWatts?: number } }> }>, session: Range) {
  const values: number[] = [];
  for (const r of records) for (const s of r.samples ?? []) { const v = num(s.power?.inWatts); if (v !== null && v >= 0 && sampleTimeIn(s.time, session)) values.push(v); }
  const { avg, max } = avgMax(values);
  return { powerAvgWatts: avg === null ? null : Math.round(avg), powerMaxWatts: max === null ? null : Math.round(max) };
}
export function summarizeCadence(records: Array<Range & { samples?: Array<{ time: string; rate?: number }> }>, session: Range) {
  const values: number[] = [];
  for (const r of records) for (const s of r.samples ?? []) { const v = num(s.rate); if (v !== null && v >= 0 && sampleTimeIn(s.time, session)) values.push(v); }
  const { avg } = avgMax(values);
  return { cadenceAvgPerMin: avg === null ? null : Math.round(avg * 10) / 10 };
}
export function sumElevationGain(records: Array<Range & { elevation?: { inMeters?: number } }>, session: Range) {
  let total = 0; let any = false;
  for (const r of records) { const v = num(r.elevation?.inMeters); if (v !== null && v >= 0 && within(r, session)) { total += v; any = true; } }
  return { elevationGainMeters: any ? Math.round(total * 100) / 100 : null };
}
export function sumEnergy(records: Array<Range & { energy?: { inKilocalories?: number } }>, session: Range) {
  let total = 0; let any = false;
  for (const r of records) { const v = num(r.energy?.inKilocalories); if (v !== null && v >= 0 && within(r, session)) { total += v; any = true; } }
  return any && total > 0 ? Math.round(total * 10) / 10 : null;
}

export interface ExerciseExtras {
  speedAvgMps: number | null; speedMaxMps: number | null; powerAvgWatts: number | null; powerMaxWatts: number | null; cadenceAvgPerMin: number | null; elevationGainMeters: number | null;
  activeKilocalories: number | null; totalKilocalories: number | null;
}
export const EMPTY_EXTRAS: ExerciseExtras = { speedAvgMps: null, speedMaxMps: null, powerAvgWatts: null, powerMaxWatts: null, cadenceAvgPerMin: null, elevationGainMeters: null, activeKilocalories: null, totalKilocalories: null };
