// Fronteira do adapter Apple Health: HKWorkout (enviado pelo app iOS) -> campos canonicos de ActivityLog.
// Segue o padrao do polar-activity-normalizer.ts: o dominio nunca conhece nomes de campo do HealthKit.
//
// PROVENANCE (Etapa 1, 06/10/2026) — duas coisas DISTINTAS, nunca fundidas:
//  - canal de ingestao = 'healthkit' (ActivityLog.provider = 'apple_health'): por onde o dado chegou;
//  - source/origem observada = quem produziu o treino segundo o proprio HealthKit (sourceName/sourceBundleId,
//    ex.: o app Treino da Apple, o Strava, outro app). Uma atividade lida pelo HealthKit NAO e' automaticamente do
//    Apple Watch — por isso 'device' e 'source' sao preservados como o HealthKit informou e `sourceFamily` so' e'
//    preenchida quando o bundle identifier permite afirmar (senao null).
// Dado ausente permanece null. Nada aqui calcula, interpreta ou deduplica.

export const APPLE_HEALTH_PROVIDER = 'apple_health';
export const APPLE_HEALTH_CHANNEL = 'healthkit';
export const APPLE_HEALTH_PAYLOAD_SCHEMA = 'apple-healthkit-workout-v1';

export type SourceFamily = 'apple' | 'strava' | null;

export interface NormalizedAppleWorkout {
  // HKWorkout.uuid em minusculas — chave de idempotencia (unique provider+userId+externalId).
  externalId: string;
  // Payload bruto saneado: so' os campos conhecidos, tal como recebidos (preservado em RawExternalActivity).
  raw: Record<string, unknown>;
  activity: {
    startedAt: Date;
    utcOffsetMinutes: number | null;
    durationSec: number | null;
    distanceMeters: number | null;
    sport: string;
  };
  providerMetrics: Record<string, unknown>;
}

export type NormalizeResult = { ok: true; value: NormalizedAppleWorkout } | { ok: false; reason: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asString(value: unknown, max = 200): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// So' afirma a familia quando o bundle identifier permite. Nunca inferida pelo canal (HealthKit).
export function classifySourceFamily(bundleId: string | null): SourceFamily {
  if (!bundleId) return null;
  const id = bundleId.toLowerCase();
  if (id.startsWith('com.apple.')) return 'apple';
  if (id.startsWith('com.strava.')) return 'strava';
  return null;
}

// Offset (minutos, assinado) de um fuso IANA no instante do treino. Null se o fuso for invalido.
export function utcOffsetMinutesAt(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const truncated = Math.floor(at.getTime() / 1000) * 1000;
    return Math.round((asUtc - truncated) / 60000);
  } catch {
    return null;
  }
}

// Mapa conservador (so' o que e' observado): running -> corrida. Qualquer outra atividade vira 'outra' (o tipo bruto
// fica preservado em providerMetrics.activityType). Nao tenta distinguir esteira aqui (isIndoor fica preservado).
function modalityFor(activityType: string | null): string {
  return activityType === 'running' ? 'corrida' : 'outra';
}

export function normalizeAppleHealthWorkout(input: unknown): NormalizeResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'item_invalido' };
  const w = input as Record<string, unknown>;

  const uuid = asString(w.uuid, 64);
  if (!uuid || !UUID_PATTERN.test(uuid)) return { ok: false, reason: 'uuid_invalido' };

  const startedAt = asIsoDate(w.startDate);
  const endedAt = asIsoDate(w.endDate);
  if (!startedAt) return { ok: false, reason: 'inicio_invalido' };
  if (!endedAt || endedAt.getTime() < startedAt.getTime()) return { ok: false, reason: 'fim_invalido' };

  const rawDuration = w.durationSeconds;
  const durationNumber = asFiniteNumber(rawDuration);
  if (rawDuration !== undefined && rawDuration !== null && (durationNumber === null || durationNumber < 0)) return { ok: false, reason: 'duracao_invalida' };

  const rawDistance = w.distanceMeters;
  const distanceNumber = asFiniteNumber(rawDistance);
  if (rawDistance !== undefined && rawDistance !== null && (distanceNumber === null || distanceNumber < 0)) return { ok: false, reason: 'distancia_invalida' };

  const sourceName = asString(w.sourceName);
  const sourceBundleId = asString(w.sourceBundleId);
  const timeZone = asString(w.timeZone, 64);
  const utcOffsetMinutes = timeZone ? utcOffsetMinutesAt(timeZone, startedAt) : null;
  const activityType = asString(w.activityType, 40);
  const externalId = uuid.toLowerCase();

  const device = {
    name: asString(w.deviceName),
    manufacturer: asString(w.deviceManufacturer),
    model: asString(w.deviceModel),
    hardwareVersion: asString(w.deviceHardwareVersion),
    softwareVersion: asString(w.deviceSoftwareVersion),
  };
  const hasDevice = Object.values(device).some((value) => value !== null);

  return {
    ok: true,
    value: {
      externalId,
      raw: {
        uuid: externalId,
        sourceName,
        sourceBundleId,
        sourceProductType: asString(w.sourceProductType),
        ...device,
        startDate: startedAt.toISOString(),
        endDate: endedAt.toISOString(),
        durationSeconds: durationNumber,
        distanceMeters: distanceNumber,
        activityType,
        activityTypeRaw: asFiniteNumber(w.activityTypeRaw),
        isIndoor: typeof w.isIndoor === 'boolean' ? w.isIndoor : null,
        timeZone,
        workoutPlanId: asString(w.workoutPlanId, 64),
      },
      activity: {
        startedAt,
        utcOffsetMinutes,
        durationSec: durationNumber === null ? null : Math.round(durationNumber),
        distanceMeters: distanceNumber,
        sport: modalityFor(activityType),
      },
      providerMetrics: {
        channel: APPLE_HEALTH_CHANNEL,
        hkWorkoutUuid: externalId,
        source: { name: sourceName, bundleId: sourceBundleId, family: classifySourceFamily(sourceBundleId) },
        device: hasDevice ? device : null,
        activityType: { name: activityType, raw: asFiniteNumber(w.activityTypeRaw) },
        isIndoor: typeof w.isIndoor === 'boolean' ? w.isIndoor : null,
        timeZone,
        endedAt: endedAt.toISOString(),
      },
    },
  };
}
