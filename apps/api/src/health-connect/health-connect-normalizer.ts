// Fronteira do adapter Health Connect (Android): ExerciseSessionRecord (enviado pelo app) -> campos canonicos de ActivityLog.
// Segue o padrao do apple-health-normalizer.ts: o dominio nunca conhece nomes de campo do Health Connect.
//
// PROVENANCE — tres camadas DISTINTAS, nunca fundidas (contrato obrigatorio da integracao):
//  - canal de ingestao = Health Connect (ActivityLog.provider = 'health_connect'): por onde o dado chegou;
//  - app de origem = metadata.dataOrigin (pacote Android que ESCREVEU o registro no Health Connect — ex.: Polar Flow, Samsung Health, Strava);
//    o Health Connect NAO informa o nome do app, so' o pacote; nada aqui presume o app pelo canal;
//  - dispositivo gravador = metadata.device (fabricante/modelo/tipo), SO' quando o app de origem informou; nunca presumido (Health Connect nao e'
//    fabricante nem dispositivo, e um registro dele nao prova Galaxy Watch, Polar etc.).
// Dado ausente permanece null: nada aqui inventa distancia, frequencia cardiaca ou fuso. O formato de providerMetrics e' o que
// physical-canonical.ts/physical-activity-identity.ts ja' interpretam (source.packageName, device, recordingMethod, endedAt).

import { healthConnectModality } from '../activity-execution/activity-modality-map';

export const HEALTH_CONNECT_PROVIDER = 'health_connect';
export const HEALTH_CONNECT_CHANNEL = 'health_connect';
export const HEALTH_CONNECT_PAYLOAD_SCHEMA = 'health-connect-exercise-v1';

// Limites defensivos (so' sanidade do dado, nao regra de treino).
const MAX_DURATION_SEC = 48 * 60 * 60;
const MAX_DISTANCE_METERS = 500_000;
const MIN_BPM = 1; // faixa de validacao do proprio Health Connect: 1-300
const MAX_BPM = 300;
const MAX_FUTURE_START_MS = 24 * 60 * 60 * 1000;

export type RecordingMethodLabel = 'actively_recorded' | 'automatically_recorded' | 'manual_entry';

export interface NormalizedHealthConnectExercise {
  // metadata.id do registro no Health Connect — chave de idempotencia (unique provider+userId+externalId).
  externalId: string;
  // Payload bruto saneado: so' os campos conhecidos, tal como recebidos (preservado em RawExternalActivity).
  raw: Record<string, unknown>;
  // Instante da ultima modificacao informado pela origem (null se ausente) — decide se um reenvio e' versao nova ou antiga.
  lastModifiedAt: Date | null;
  activity: {
    startedAt: Date;
    utcOffsetMinutes: number | null;
    durationSec: number;
    distanceMeters: number | null;
    avgHeartRateBpm: number | null;
    maxHeartRateBpm: number | null;
    sport: string;
  };
  providerMetrics: Record<string, unknown>;
}

export type NormalizeResult = { ok: true; value: NormalizedHealthConnectExercise } | { ok: false; reason: string };

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

// metadata.recordingMethod do Health Connect: 0 desconhecido, 1 ativo, 2 automatico, 3 manual. Qualquer outro valor => null (nunca presumido).
export function recordingMethodLabel(value: unknown): RecordingMethodLabel | null {
  if (value === 1) return 'actively_recorded';
  if (value === 2) return 'automatically_recorded';
  if (value === 3) return 'manual_entry';
  return null;
}

export function normalizeHealthConnectExercise(input: unknown, now: Date = new Date()): NormalizeResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'item_invalido' };
  const e = input as Record<string, unknown>;

  const recordId = asString(e.recordId, 128);
  if (!recordId) return { ok: false, reason: 'registro_sem_id' };

  const exerciseType = asFiniteNumber(e.exerciseType);
  if (exerciseType === null || !Number.isInteger(exerciseType) || exerciseType < 0) return { ok: false, reason: 'tipo_invalido' };

  const startedAt = asIsoDate(e.startTime);
  const endedAt = asIsoDate(e.endTime);
  if (!startedAt) return { ok: false, reason: 'inicio_invalido' };
  if (!endedAt || endedAt.getTime() <= startedAt.getTime()) return { ok: false, reason: 'fim_invalido' };
  if (startedAt.getTime() > now.getTime() + MAX_FUTURE_START_MS) return { ok: false, reason: 'inicio_futuro' };
  const durationSec = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
  if (durationSec > MAX_DURATION_SEC) return { ok: false, reason: 'duracao_invalida' };

  // Distancia: numero >= 0 e plausivel; ausente/invalida => null (nunca zero inventado).
  const rawDistance = asFiniteNumber(e.distanceMeters);
  const distanceMeters = rawDistance !== null && rawDistance >= 0 && rawDistance <= MAX_DISTANCE_METERS ? rawDistance : null;

  // Frequencia cardiaca: so' valores na faixa valida; media/maxima inconsistentes entre si (max < media) nao sao confiaveis => ambas null.
  const validBpm = (value: unknown) => {
    const bpm = asFiniteNumber(value);
    return bpm !== null && bpm >= MIN_BPM && bpm <= MAX_BPM ? Math.round(bpm) : null;
  };
  let avgHeartRateBpm = validBpm(e.avgHeartRateBpm);
  let maxHeartRateBpm = validBpm(e.maxHeartRateBpm);
  if (avgHeartRateBpm !== null && maxHeartRateBpm !== null && maxHeartRateBpm < avgHeartRateBpm) {
    avgHeartRateBpm = null;
    maxHeartRateBpm = null;
  }
  const rawSamples = asFiniteNumber(e.heartRateSampleCount);
  const heartRateSampleCount = rawSamples !== null && rawSamples >= 0 && Number.isInteger(rawSamples) ? rawSamples : null;

  // Fuso: offset em segundos informado pelo Health Connect (startZoneOffset.totalSeconds). Ausente => null (nunca adivinhado).
  const offsetSeconds = asFiniteNumber(e.startZoneOffsetSeconds);
  const utcOffsetMinutes = offsetSeconds !== null && Math.abs(offsetSeconds) <= 18 * 3600 ? Math.round(offsetSeconds / 60) : null;

  // Origem: so' o que o app informou.
  const packageName = asString(e.dataOrigin, 200);
  const deviceInput = e.device && typeof e.device === 'object' && !Array.isArray(e.device) ? (e.device as Record<string, unknown>) : null;
  const device = deviceInput
    ? { manufacturer: asString(deviceInput.manufacturer), model: asString(deviceInput.model), type: asFiniteNumber(deviceInput.type) }
    : null;
  const hasDevice = device !== null && (device.manufacturer !== null || device.model !== null || device.type !== null);
  const recordingMethod = recordingMethodLabel(e.recordingMethod);
  const lastModifiedAt = asIsoDate(e.lastModifiedTime);
  const clientRecordId = asString(e.clientRecordId, 128);
  const sport = healthConnectModality(exerciseType);

  return {
    ok: true,
    value: {
      externalId: recordId,
      lastModifiedAt,
      raw: {
        recordId,
        clientRecordId,
        dataOrigin: packageName,
        lastModifiedTime: lastModifiedAt ? lastModifiedAt.toISOString() : null,
        exerciseType,
        startTime: startedAt.toISOString(),
        endTime: endedAt.toISOString(),
        startZoneOffsetSeconds: offsetSeconds,
        device: hasDevice ? device : null,
        recordingMethod: asFiniteNumber(e.recordingMethod),
        distanceMeters,
        avgHeartRateBpm,
        maxHeartRateBpm,
        heartRateSampleCount,
      },
      activity: { startedAt, utcOffsetMinutes, durationSec, distanceMeters, avgHeartRateBpm, maxHeartRateBpm, sport },
      providerMetrics: {
        channel: HEALTH_CONNECT_CHANNEL,
        // Canal x app de origem: `source.name` fica null de proposito (o Health Connect so' informa o pacote); o rotulo exibido vem do ecossistema conhecido.
        source: { packageName, name: null },
        device: hasDevice ? device : null,
        recordingMethod,
        hcRecordId: recordId,
        clientRecordId,
        lastModifiedTime: lastModifiedAt ? lastModifiedAt.toISOString() : null,
        exerciseType: { raw: exerciseType },
        endedAt: endedAt.toISOString(),
        startZoneOffsetSeconds: offsetSeconds,
        heartRate: heartRateSampleCount === null ? null : { sampleCount: heartRateSampleCount },
      },
    },
  };
}
