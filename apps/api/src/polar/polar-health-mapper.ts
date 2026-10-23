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
