// Fronteira do adapter Wahoo (Etapa 5, 08/10/2026): payload bruto da Cloud API (workout + workout_summary) ->
// campos do ActivityLog canonico. Nada aqui e' reutilizavel por outro provedor, e o dominio nunca importa este arquivo.
//
// Contrato (documentacao oficial cloud-api.wahooligan.com):
//  - decimais chegam como STRING ("450.00"); unidades: distance_accum/ascent_accum em metros, duration_* em segundos,
//    speed_avg em m/s, calories_accum em kcal, heart_rate_avg em bpm.
//  - workout.starts e' ISO 8601 em UTC; summary.time_zone e' o fuso do treino (quando presente).
//  - So' mapeamos o que da' para justificar com confianca. Campo ausente/ilegivel vira null — nunca 0, nunca inventado.
//    cadence_avg e power_avg NAO viram colunas canonicas: a semantica (passos x rotacoes; corrida x bike) nao esta
//    confirmada para corrida. Ficam preservados no payload bruto.

// workout_type_id (enumeracao da documentacao). So' o que e' inequivocamente corrida vira modalidade de corrida;
// qualquer outra coisa e' 'outra' (mesma postura conservadora do adapter Polar).
// (10/2026: o mapa completo id -> modalidade canonica vive em activity-modality-map.ts.)

import { wahooModality } from '../activity-execution/activity-modality-map';

export const WAHOO_WORKOUT_TYPE_NAMES: Record<number, string> = {
  0: 'BIKING', 1: 'RUNNING', 2: 'FE', 3: 'RUNNING_TRACK', 4: 'RUNNING_TRAIL', 5: 'RUNNING_TREADMILL', 6: 'WALKING', 7: 'WALKING_SPEED',
  8: 'WALKING_NORDIC', 9: 'HIKING', 42: 'WORKOUT', 47: 'OTHER', 56: 'WALKING_TREADMILL', 67: 'RUNNING_RACE', 71: 'RUNNING_INDOOR_VIRTUAL', 255: 'UNKNOWN',
};

export interface WahooWorkoutPayload {
  id?: unknown;
  starts?: unknown;
  minutes?: unknown;
  name?: unknown;
  workout_token?: unknown;
  workout_type_id?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface WahooSummaryPayload {
  id?: unknown;
  ascent_accum?: unknown;
  calories_accum?: unknown;
  distance_accum?: unknown;
  duration_active_accum?: unknown;
  duration_paused_accum?: unknown;
  duration_total_accum?: unknown;
  heart_rate_avg?: unknown;
  speed_avg?: unknown;
  time_zone?: unknown;
  manual?: unknown;
  edited?: unknown;
  fitness_app_id?: unknown;
  updated_at?: unknown;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function asId(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

export function normalizeWahooModality(workoutTypeId: unknown): string {
  return wahooModality(asNumber(workoutTypeId));
}

// Inicio do treino: workout.starts e' ISO 8601 UTC. Sem fuso explicito NAO assumimos nada (mesma regra do Polar).
export function parseWahooStartedAt(starts: unknown): Date | null {
  if (typeof starts !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/i.test(starts)) return null;
  const parsed = new Date(starts);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Offset UTC em minutos na MESMA convencao do Polar (start-time-utc-offset): offset = hora local - UTC, de modo que
// UTC = localComoUtc - offset (America/Sao_Paulo => -180). A partir de um fuso IANA, no instante do treino. Invalido => null.
export function utcOffsetMinutesFor(timeZone: unknown, at: Date): number | null {
  if (typeof timeZone !== 'string' || !timeZone.trim() || timeZone.length > 64) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtcLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const atWholeSecond = Math.floor(at.getTime() / 1000) * 1000;
    const diffMinutes = Math.round((asUtcLocal - atWholeSecond) / 60_000);
    return Number.isFinite(diffMinutes) ? diffMinutes : null;
  } catch {
    return null;
  }
}

export interface WahooCanonicalFields {
  startedAt: Date;
  utcOffsetMinutes: number | null;
  durationSec: number | null;
  distanceMeters: number | null;
  sport: string;
  caloriesKcal: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: null;
  elevationGainMeters: number | null;
  hasRoute: null;
}

// Devolve null quando nao ha base minima para uma atividade (sem inicio valido) — o chamador pula, nunca inventa.
export function mapWahooActivity(workout: WahooWorkoutPayload, summary: WahooSummaryPayload): WahooCanonicalFields | null {
  const startedAt = parseWahooStartedAt(workout.starts);
  if (!startedAt) return null;
  const duration = asNumber(summary.duration_active_accum) ?? asNumber(summary.duration_total_accum);
  const calories = asNumber(summary.calories_accum);
  const heartRate = asNumber(summary.heart_rate_avg);
  return {
    startedAt,
    utcOffsetMinutes: utcOffsetMinutesFor(summary.time_zone, startedAt),
    durationSec: duration !== null && duration >= 0 ? Math.round(duration) : null,
    distanceMeters: asNumber(summary.distance_accum),
    sport: normalizeWahooModality(workout.workout_type_id),
    caloriesKcal: calories !== null && calories >= 0 ? Math.round(calories) : null,
    avgHeartRateBpm: heartRate !== null && heartRate > 0 ? Math.round(heartRate) : null,
    maxHeartRateBpm: null, // a Cloud API nao informa FC maxima no resumo
    elevationGainMeters: asNumber(summary.ascent_accum),
    hasRoute: null, // o resumo nao informa se ha rota
  };
}

// Um resumo "vazio" (treino agendado ou ainda sem dados) nao e' uma atividade realizada.
export function isCompletedSummary(summary: WahooSummaryPayload | null | undefined): boolean {
  if (!summary) return false;
  return asNumber(summary.duration_active_accum) !== null || asNumber(summary.duration_total_accum) !== null || asNumber(summary.distance_accum) !== null;
}

// Metricas proprietarias da Wahoo, identificaveis pela coluna provider da propria linha.
export function extractWahooProviderMetrics(workout: WahooWorkoutPayload, summary: WahooSummaryPayload) {
  const typeId = asNumber(workout.workout_type_id);
  const metrics: Record<string, unknown> = {};
  if (typeId !== null) { metrics.workoutTypeId = typeId; if (WAHOO_WORKOUT_TYPE_NAMES[typeId]) metrics.workoutTypeName = WAHOO_WORKOUT_TYPE_NAMES[typeId]; }
  if (typeof summary.manual === 'boolean') metrics.manual = summary.manual;
  if (typeof summary.edited === 'boolean') metrics.edited = summary.edited;
  const appId = asNumber(summary.fitness_app_id);
  if (appId !== null) metrics.fitnessAppId = appId;
  const speed = asNumber(summary.speed_avg);
  if (speed !== null) metrics.speedAvgMetersPerSecond = speed;
  return Object.keys(metrics).length > 0 ? metrics : null;
}
