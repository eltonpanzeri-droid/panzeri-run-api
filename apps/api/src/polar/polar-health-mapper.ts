// Polar AccessLink (sono, Nightly Recharge, atividade diaria) -> colunas de WearableSleepSummary / WearableHrvSummary / WearableDailySummary (23/10/2026). Funcoes PURAS.
// Regras: o que a Polar nao informa fica NULL (nunca zero, nunca estimado); a unica conta feita e' a soma das etapas de sono que a PROPRIA Polar informou (ver durationSec). Campos que o Panzeri
// Run ainda nao interpreta sao preservados como a Polar enviou (Json). Nomes de campo conforme a documentacao oficial (https://www.polar.com/accesslink-api/) e a verificar com o diagnostico
// administrativo (polar-probe.service.ts) — o mapeador e' tolerante: formato inesperado => registro ignorado e contado, nunca gravado pela metade.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface MappedSleep {
  calendarDate: string; startTimeSec: number; startOffsetSec: number; endTimeSec: number | null;
  durationSec: number | null; deepSleepSec: number | null; lightSleepSec: number | null; remSleepSec: number | null; awakeSec: number | null; unmeasurableSec: number | null;
  scoreValue: number | null; scoreQualifier: string | null; levels: Json | null; sleepScores: Json | null; providerSummaryId: string;
}
export interface MappedHrv { calendarDate: string; startTimeSec: number; startOffsetSec: number; lastNightAvg: number; hrvValues: Json | null; providerSummaryId: string }
export interface MappedDaily {
  calendarDate: string; startTimeSec: number; startOffsetSec: number; steps: number | null; distanceMeters: number | null; activeKilocalories: number | null; providerSummaryId: string;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const nonNegInt = (value: unknown): number | null => { const n = num(value); return n != null && n >= 0 ? Math.round(n) : null; };
const dateOnly = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day ? day : null;
};
const asJson = (value: unknown): Json | null => {
  if (value === undefined || value === null) return null;
  try { return JSON.parse(JSON.stringify(value)) as Json; } catch { return null; }
};

/** ISO com fuso ("2026-10-21T23:10:00+01:00" ou "...Z"). Sem fuso explicito NAO da' para saber o instante: devolve null (o registro nao e' gravado). */
export function parsePolarInstant(value: unknown): { epochSec: number; offsetSec: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(value.trim());
  if (!match) return null;
  const zone = match[2];
  const offsetSec = zone === 'Z' ? 0 : (zone.startsWith('-') ? -1 : 1) * (Number(zone.slice(1, 3)) * 3600 + Number(zone.slice(-2)) * 60);
  const ms = Date.parse(`${match[1]}.000Z`) - offsetSec * 1000;
  return Number.isNaN(ms) ? null : { epochSec: Math.floor(ms / 1000), offsetSec };
}

const dayStartSec = (date: string) => Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 1000);

export function mapPolarSleep(item: unknown): MappedSleep | null {
  if (!item || typeof item !== 'object') return null;
  const s = item as Record<string, unknown>;
  const start = parsePolarInstant(s.sleep_start_time);
  if (!start) return null;
  const end = parsePolarInstant(s.sleep_end_time);
  const calendarDate = dateOnly(s.date) ?? (end ? new Date((end.epochSec + end.offsetSec) * 1000).toISOString().slice(0, 10) : null);
  if (!calendarDate) return null;
  const light = nonNegInt(s.light_sleep); const deep = nonNegInt(s.deep_sleep); const rem = nonNegInt(s.rem_sleep);
  const stages = [light, deep, rem];
  // A Polar nao envia uma "duracao total": o tempo DORMINDO e' a soma das etapas que ela informa (leve + profundo + REM). So' existe quando as tres foram informadas.
  const durationSec = stages.every((v) => v != null) ? (light as number) + (deep as number) + (rem as number) : null;
  // Diagnostico real da Polar (23/10/2026): ha noites na lista com leve, profundo e REM todos ZERO (e pontuacao 0) e um intervalo inicio-fim longo — o relogio nao mediu sono nessa janela. Zero em todas as
  // etapas nao e' "dormiu zero": e' AUSENCIA de medicao, entao o registro nao e' gravado (nunca vira uma noite de 0 minutos).
  if (durationSec === 0) return null;
  return {
    calendarDate, startTimeSec: start.epochSec, startOffsetSec: start.offsetSec, endTimeSec: end ? end.epochSec : null,
    durationSec, deepSleepSec: deep, lightSleepSec: light, remSleepSec: rem,
    awakeSec: nonNegInt(s.total_interruption_duration), unmeasurableSec: nonNegInt(s.unrecognized_sleep_stage),
    scoreValue: nonNegInt(s.sleep_score), scoreQualifier: typeof s.sleep_rating === 'number' || typeof s.sleep_rating === 'string' ? String(s.sleep_rating).slice(0, 40) : null,
    levels: asJson(s.hypnogram ? { polarHypnogram: s.hypnogram } : null),
    sleepScores: asJson({
      continuity: s.continuity, continuity_class: s.continuity_class, sleep_charge: s.sleep_charge, sleep_goal: s.sleep_goal, sleep_rating: s.sleep_rating,
      short_interruption_duration: s.short_interruption_duration, long_interruption_duration: s.long_interruption_duration,
      group_duration_score: s.group_duration_score, group_solidity_score: s.group_solidity_score, group_regeneration_score: s.group_regeneration_score, sleep_cycles: s.sleep_cycles,
    }),
    providerSummaryId: `polar:sleep:${calendarDate}`,
  };
}

/** Nightly Recharge -> HRV da noite. A unidade NAO e' convertida nem presumida (a documentacao da Polar nao a deixa explicita). */
export function mapPolarNightlyRecharge(item: unknown): MappedHrv | null {
  if (!item || typeof item !== 'object') return null;
  const r = item as Record<string, unknown>;
  const calendarDate = dateOnly(r.date);
  const avg = num(r.heart_rate_variability_avg);
  if (!calendarDate || avg == null || avg < 0) return null; // ausente nunca vira zero
  return { calendarDate, startTimeSec: dayStartSec(calendarDate), startOffsetSec: 0, lastNightAvg: avg, hrvValues: asJson(r.hrv_samples), providerSummaryId: `polar:nightly-recharge:${calendarDate}` };
}

/**
 * Nightly Recharge, campos alem da HRV (10/11/2026, varredura "pegar tudo"): carga do sistema nervoso autonomo (ANS charge) e seu status, status do Nightly Recharge, FC media e intervalo
 * entre batimentos medios da noite. Sao valores que a Polar JA entrega no mesmo registro e que eram descartados. Unidades NAO convertidas nem presumidas; campo ausente nao entra (nunca vira zero).
 * A frequencia respiratoria da noite NAO e' guardada aqui: o grupo "HRV" autorizado pela aluna nao a cobre.
 */
export function mapPolarNightlyRechargeExtras(item: unknown): { calendarDate: string; startTimeSec: number; values: Record<string, number>; providerSummaryId: string } | null {
  if (!item || typeof item !== 'object') return null;
  const r = item as Record<string, unknown>;
  const calendarDate = dateOnly(r.date);
  if (!calendarDate) return null;
  const values: Record<string, number> = {};
  const put = (key: string, raw: unknown) => { const value = num(raw); if (value != null) values[key] = value; };
  put('ansCharge', r.ans_charge);
  put('ansChargeStatus', r.ans_charge_status);
  put('nightlyRechargeStatus', r.nightly_recharge_status);
  put('heartRateAvgBpm', r.heart_rate_avg);
  put('beatToBeatAvgMs', r.beat_to_beat_avg);
  return Object.keys(values).length === 0 ? null : { calendarDate, startTimeSec: dayStartSec(calendarDate), values, providerSummaryId: `polar:nightly-recharge-extras:${calendarDate}` };
}

// Metricas novas da Polar (10/11/2026): FC continua, Cardio Load e SleepWise. NAO VALIDADO AO VIVO (sem aluna conectada com esses dados): o mapeador e' tolerante — guarda o que for numerico, nunca
// inventa campo, ausente nunca vira zero, e ignora o que nao reconhece. Unidades nao convertidas.
const DATE_KEYS = ['date', 'calendar_date', 'day', 'start_time', 'start', 'timestamp'];
function metricDate(record: Record<string, unknown>): string | null {
  for (const key of DATE_KEYS) { const d = dateOnly(record[key]); if (d) return d; }
  return null;
}
// Achata campos numericos (ate 2 niveis de objeto); texto, listas e datas ficam de fora (listas de amostras sao resumidas a parte).
function numericLeaves(record: Record<string, unknown>, prefix = '', depth = 0, out: Record<string, number> = {}): Record<string, number> {
  for (const [key, raw] of Object.entries(record)) {
    if (DATE_KEYS.includes(key) || key === 'polar_user') continue;
    const name = prefix ? `${prefix}_${key}` : key;
    if (typeof raw === 'number' && Number.isFinite(raw)) out[name] = raw;
    else if (raw && typeof raw === 'object' && !Array.isArray(raw) && depth < 2) numericLeaves(raw as Record<string, unknown>, name, depth + 1, out);
  }
  return out;
}

export type PolarMetricKind = 'heart_rate_continuous' | 'cardio_load' | 'sleepwise_alertness' | 'sleepwise_circadian';
export interface MappedPolarMetric { metricKind: PolarMetricKind; calendarDate: string; startTimeSec: number; values: Record<string, number>; identityKey: string; providerSummaryId: string }

export function mapPolarMetric(kind: PolarMetricKind, item: unknown): MappedPolarMetric | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const calendarDate = metricDate(record);
  if (!calendarDate) return null;
  let values: Record<string, number> = {};
  if (kind === 'heart_rate_continuous') {
    // amostras do dia -> minima, media e maxima do dia (descritivo; a serie bruta nao e' guardada)
    const list = ['heart_rate_samples', 'samples', 'heart_rates'].map((key) => record[key]).find((value) => Array.isArray(value)) as unknown[] | undefined;
    const bpm = (list ?? []).map((sample) => num((sample as Record<string, unknown> | null)?.heart_rate ?? (sample as Record<string, unknown> | null)?.value)).filter((v): v is number => v != null && v >= 25 && v <= 250);
    if (bpm.length > 0) values = { hrMinBpm: Math.min(...bpm), hrAvgBpm: Math.round((bpm.reduce((s, v) => s + v, 0) / bpm.length) * 10) / 10, hrMaxBpm: Math.max(...bpm), samples: bpm.length };
  } else {
    values = numericLeaves(record);
  }
  if (Object.keys(values).length === 0) return null;
  return { metricKind: kind, calendarDate, startTimeSec: dayStartSec(calendarDate), values, identityKey: `polar:${kind}:${calendarDate}`, providerSummaryId: `polar:${kind}:${calendarDate}` };
}

/** Resumo diario da Polar. FC de repouso NAO e' mapeada: a Polar nao tem serie diaria de FC de repouso (o valor do perfil nao e' diario; a media da noite nao e' FC de repouso). */
export function mapPolarDailyActivity(item: unknown): MappedDaily | null {
  if (!item || typeof item !== 'object') return null;
  const a = item as Record<string, unknown>;
  const calendarDate = dateOnly(a.date) ?? dateOnly(a.start_time);
  if (!calendarDate) return null;
  const steps = nonNegInt(a.steps);
  const distance = num(a.distance_from_steps);
  const active = num(a.active_calories);
  if (steps == null && distance == null && active == null) return null; // sem nenhum indicador diario nao ha o que gravar
  return {
    calendarDate, startTimeSec: dayStartSec(calendarDate), startOffsetSec: 0, steps,
    distanceMeters: distance != null && distance >= 0 ? distance : null, activeKilocalories: active != null && active >= 0 ? active : null,
    providerSummaryId: `polar:activity:${calendarDate}`,
  };
}

/** A lista pode vir como array, ou dentro de um objeto (ex.: {nights:[...]}). Aceita as duas formas; qualquer outra coisa = nada. */
export function extractPolarList(body: unknown, preferredKeys: string[]): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;
  for (const key of preferredKeys) if (Array.isArray(record[key])) return record[key] as unknown[];
  const firstArray = Object.values(record).find((value) => Array.isArray(value));
  return Array.isArray(firstArray) ? firstArray : [];
}
