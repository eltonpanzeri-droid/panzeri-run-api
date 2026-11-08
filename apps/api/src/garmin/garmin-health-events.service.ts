import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventOutcome, InboundEventView } from '../provider-hub/provider-connector';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { GARMIN_PROVIDER_ID } from './garmin.connector';
import { GarminHealthRecord, requiredCategoryOf } from './garmin-health';

// Processador dos eventos de SAUDE e RECUPERACAO da Garmin na fila duravel (08/11/2026): sono, dia, HRV e metricas (estresse/Body Battery, VO2 maximo, composicao corporal). O dado chega pronto no
// proprio push. Mesmo contrato da Zepp: revalida a conexao e a categoria (inclusive DENTRO da trava de consentimento), respeita o periodo autorizado, grava SO' o que a Garmin mediu (campo ausente = nulo,
// nunca zero nem estimativa) e e' idempotente (aluna + provedor + dia + inicio). A FC de repouso e' categoria PROPRIA (resting_heart_rate). Reenvio atualizado do mesmo resumo SUBSTITUI o anterior.
const FUTURE_TOLERANCE_MS = 36 * 3_600_000;
type Json = Prisma.InputJsonValue;
const json = (value: unknown): Json | undefined => (value === null || value === undefined ? undefined : (value as Json));
const n = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const t = (value: unknown, max = 100): string | null => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);

@Injectable()
export class GarminHealthEventService {
  constructor(private readonly consent: ProviderConsentService) {}

  async handle(event: InboundEventView): Promise<EventOutcome> {
    const userId = event.userId;
    if (!userId) return { status: 'discard', reason: 'conta desconhecida' };
    const record = event.payload as Partial<GarminHealthRecord> | null;
    if (!record || typeof record.startTimeSec !== 'number' || (record.eventType !== 'metric_summary' && typeof record.calendarDate !== 'string') || !record.fields) return { status: 'discard', reason: 'evento de saude invalido' };
    const required = requiredCategoryOf({ eventType: event.eventType as GarminHealthRecord['eventType'], metricKind: record.metricKind });
    if (!required) return { status: 'discard', reason: 'tipo de evento de saude desconhecido' };

    const snapshot = await this.consent.snapshot(GARMIN_PROVIDER_ID, userId);
    if (!snapshot) return { status: 'discard', reason: 'conexao encerrada' };
    if (!snapshot.categories.includes(required)) return { status: 'discard', reason: 'categoria nao autorizada pela aluna' };
    const startTimeSec = record.startTimeSec;
    if (snapshot.collectFrom && startTimeSec * 1000 < snapshot.collectFrom.getTime()) return { status: 'discard', reason: 'anterior ao periodo autorizado' };
    if (startTimeSec * 1000 > Date.now() + FUTURE_TOLERANCE_MS) return { status: 'discard', reason: 'data de inicio no futuro' };

    const fields = record.fields as Record<string, unknown>;
    const calendarDate = record.calendarDate ?? null;
    // Deslocamento do fuso ausente (a Garmin o informa em todos os resumos): usa 0 (UTC) so' para nao perder o dado; a data local vem do calendarDate.
    const startOffsetSec = typeof record.startOffsetSec === 'number' ? record.startOffsetSec : record.eventType === 'metric_summary' ? null : 0;
    const providerSummaryId = t(record.summaryId);
    const written = await this.consent.writeWhileAuthorized(GARMIN_PROVIDER_ID, userId, async (tx, granted) => {
      if (!granted.categories.includes(required)) return null; // reconferido DENTRO da trava
      if (event.eventType === 'metric_summary') {
        const identityKey = t(record.identityKey, 140);
        if (!identityKey || !record.metricKind) return null;
        const data = { calendarDate, startOffsetSec, providerSummaryId, values: fields as Json };
        await tx.wearableMetricRecord.upsert({
          where: { userId_provider_metricKind_identityKey: { userId, provider: GARMIN_PROVIDER_ID, metricKind: record.metricKind, identityKey } },
          create: { userId, provider: GARMIN_PROVIDER_ID, metricKind: record.metricKind, identityKey, startTimeSec, ...data },
          update: { startTimeSec, ...data },
        });
        return true;
      }
      const key = { userId_provider_calendarDate_startTimeSec: { userId, provider: GARMIN_PROVIDER_ID, calendarDate: calendarDate as string, startTimeSec } };
      if (event.eventType === 'sleep_summary') {
        const data = {
          startOffsetSec: startOffsetSec as number, providerSummaryId,
          durationSec: n(fields.durationSec), deepSleepSec: n(fields.deepSleepSec), lightSleepSec: n(fields.lightSleepSec), remSleepSec: n(fields.remSleepSec), awakeSec: n(fields.awakeSec),
          napTotalSec: n(fields.napTotalSec), unmeasurableSec: n(fields.unmeasurableSec), scoreValue: n(fields.scoreValue), scoreQualifier: t(fields.scoreQualifier, 40), validation: t(fields.validation, 40),
          endTimeSec: n(fields.endTimeSec), levels: json(fields.levels), naps: json(fields.naps), sleepScores: json(fields.sleepScores),
        };
        await tx.wearableSleepSummary.upsert({ where: key, create: { userId, provider: GARMIN_PROVIDER_ID, calendarDate: calendarDate as string, startTimeSec, ...data }, update: data });
      } else if (event.eventType === 'hrv_summary') {
        const lastNightAvg = n(fields.lastNightAvg);
        if (lastNightAvg === null) return null;
        const data = { startOffsetSec: startOffsetSec as number, providerSummaryId, durationSec: n(fields.durationSec), lastNightAvg, hrvValues: json(fields.hrvValues) };
        await tx.wearableHrvSummary.upsert({ where: key, create: { userId, provider: GARMIN_PROVIDER_ID, calendarDate: calendarDate as string, startTimeSec, ...data }, update: data });
      } else if (event.eventType === 'daily_summary') {
        const data = {
          startOffsetSec: startOffsetSec as number, providerSummaryId, durationSec: n(fields.durationSec), steps: n(fields.steps), distanceMeters: n(fields.distanceMeters), activeKilocalories: n(fields.activeKilocalories),
          // A FC de repouso e' categoria PROPRIA: sem ela, o campo nao e' guardado.
          restingHeartRateBpm: granted.categories.includes('resting_heart_rate') ? n(fields.restingHeartRateBpm) : null,
          stepsGoal: n(fields.stepsGoal),
        };
        await tx.wearableDailySummary.upsert({ where: key, create: { userId, provider: GARMIN_PROVIDER_ID, calendarDate: calendarDate as string, startTimeSec, ...data }, update: data });
      } else {
        return null;
      }
      return true;
    });
    if (!written) return { status: 'discard', reason: 'conexao encerrada ou categoria retirada durante o processamento' };
    return { status: 'done' };
  }
}
