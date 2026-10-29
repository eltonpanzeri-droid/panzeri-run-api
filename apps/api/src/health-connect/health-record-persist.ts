import { Prisma } from '@prisma/client';
import { NormalizedHealthRecord } from './health-connect-health-records';

// Gravacao dos registros de saude normalizados nas tabelas Wearable* (as mesmas da Zepp), compartilhada por Health Connect e Apple Saude: o provedor entra so' em `provider`. Idempotente (upsert
// pela chave natural). O registro diario carrega duas categorias independentes (atividade do dia e FC de repouso): so' os campos da categoria autorizada sao guardados.
export interface HealthPersistAllowed { daily: boolean; resting: boolean }

export function healthSummaryId(identity: string, dataOrigin: string | null): string {
  return `${dataOrigin ?? 'origem_desconhecida'}|${identity}`.slice(0, 200);
}

export async function persistHealthRecord(tx: Prisma.TransactionClient, userId: string, provider: string, record: NormalizedHealthRecord, allowed: HealthPersistAllowed): Promise<void> {
  const providerSummaryId = healthSummaryId(record.identity, record.origin.dataOrigin);
  if (record.type === 'metric') {
    const data = { calendarDate: record.calendarDate, startOffsetSec: record.startOffsetSec, providerSummaryId, values: record.values as never };
    await tx.wearableMetricRecord.upsert({
      where: { userId_provider_metricKind_identityKey: { userId, provider, metricKind: record.metricKind, identityKey: record.identity } },
      create: { userId, provider, metricKind: record.metricKind, identityKey: record.identity, startTimeSec: record.startTimeSec, ...data },
      update: { startTimeSec: record.startTimeSec, ...data },
    });
    return;
  }
  const key = { userId_provider_calendarDate_startTimeSec: { userId, provider, calendarDate: record.calendarDate, startTimeSec: record.startTimeSec } };
  const base = { startOffsetSec: record.startOffsetSec, providerSummaryId };
  if (record.type === 'sleep') {
    const d = record.data;
    const data = { ...base, durationSec: d.durationSec, deepSleepSec: d.deepSleepSec, lightSleepSec: d.lightSleepSec, remSleepSec: d.remSleepSec, awakeSec: d.awakeSec, unmeasurableSec: d.unmeasurableSec, endTimeSec: d.endTimeSec, levels: d.levels as never };
    await tx.wearableSleepSummary.upsert({ where: key, create: { userId, provider, calendarDate: record.calendarDate, startTimeSec: record.startTimeSec, ...data }, update: data });
  } else if (record.type === 'hrv') {
    const data = { ...base, lastNightAvg: record.data.lastNightAvg, hrvValues: record.data.hrvValues as never };
    await tx.wearableHrvSummary.upsert({ where: key, create: { userId, provider, calendarDate: record.calendarDate, startTimeSec: record.startTimeSec, ...data }, update: data });
  } else {
    const d = record.data;
    const data = { ...base, steps: allowed.daily ? d.steps : null, distanceMeters: allowed.daily ? d.distanceMeters : null, activeKilocalories: allowed.daily ? d.activeKilocalories : null, restingHeartRateBpm: allowed.resting ? d.restingHeartRateBpm : null };
    await tx.wearableDailySummary.upsert({ where: key, create: { userId, provider, calendarDate: record.calendarDate, startTimeSec: record.startTimeSec, ...data }, update: data });
  }
}
