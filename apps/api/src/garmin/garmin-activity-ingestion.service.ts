import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DeviceRegistryService } from '../equipment/device-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { isActivityExcluded } from '../prisma/activity-exclusion-scope';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { SessionExecutionLinkService } from '../activity-execution/session-execution-link.service';
import { ActivityNotificationService } from '../activity-execution/activity-notification.service';
import { PhysicalActivityIdentityService } from '../activity-execution/physical-activity-identity.service';
import { NORMALIZATION_VERSION } from '../activity-timeseries/activity-timeseries.service';
import { GARMIN_PROVIDER_ID } from './garmin.connector';
import { activityKeyOf, applyActivityConsent, GarminActivityRecord, modalityFromGarmin } from './garmin-activity';

// Gravacao de uma atividade da Garmin no pipeline existente: RawExternalActivity -> ActivityLog -> serie temporal -> identidade fisica -> classificacao/vinculo (08/11/2026). Mesma esteira da
// Zepp/COROS; muda a ORIGEM (JSON do push da Garmin, sem arquivo) e a regra de consentimento por campo:
//   'activity'         : data/hora, distancia, duracao, calorias, modalidade e a serie de distancia/velocidade;
//   'activity_sensors' : frequencia cardiaca, cadencia, potencia, altitude e ganho de elevacao;
//   'activity_route'   : percurso GPS (latitude/longitude, 09/11/2026); hasRoute so' e' true quando as coordenadas foram guardadas. 'activity_sensors' tambem libera a temperatura do ar.
//  - Idempotente: a chave e' o activityId do Garmin Connect (igual no resumo e nos detalhes). O resumo nunca apaga a serie dos detalhes; os detalhes refazem a serie.
//  - Classificacao, vinculos e feedback ja' decididos nao sao tocados na atualizacao.
export const GARMIN_PAYLOAD_SCHEMA = 'garmin-activity-push-1';

export type GarminIngestResult = { written: false; reason: 'not_authorized' | 'excluded' } | { written: true; activityLogId: string; classification: string | null; removed: string[] };

@Injectable()
export class GarminActivityIngestionService {
  private readonly logger = new Logger(GarminActivityIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ProviderConsentService,
    private readonly sessionExecutionLink: SessionExecutionLinkService,
    private readonly activityNotifications: ActivityNotificationService,
    private readonly physicalIdentity?: PhysicalActivityIdentityService,
    @Optional() private readonly deviceRegistry?: DeviceRegistryService,
  ) {}

  // providerMetrics.garmin: o RESUMO nunca apaga o que os DETALHES gravaram (voltas). So' os detalhes escrevem `lapStartOffsetsSec`.
  private async mergedProviderMetrics(tx: Prisma.TransactionClient, userId: string, externalId: string, record: GarminActivityRecord): Promise<Prisma.InputJsonValue> {
    const existing = await tx.activityLog.findUnique({ where: { provider_userId_externalId: { provider: GARMIN_PROVIDER_ID, userId, externalId } }, select: { providerMetrics: true } });
    const previous = (existing?.providerMetrics && typeof existing.providerMetrics === 'object' && !Array.isArray(existing.providerMetrics) ? (existing.providerMetrics as Record<string, unknown>).garmin : null) as Record<string, unknown> | null;
    const garmin: Record<string, unknown> = { ...(previous && typeof previous === 'object' ? previous : {}), activityType: record.activityType, deviceName: record.deviceName };
    if (record.kind === 'details') garmin.lapStartOffsetsSec = record.lapStartOffsetsSec;
    return { garmin } as Prisma.InputJsonValue;
  }

  async ingest(userId: string, record: GarminActivityRecord): Promise<GarminIngestResult> {
    const externalId = activityKeyOf(record);
    // Atividade ja' excluida/ignorada pela aluna ou treinador: a sincronizacao NAO regrava nada.
    if (await isActivityExcluded(this.prisma, userId, GARMIN_PROVIDER_ID, externalId)) return { written: false, reason: 'excluded' };
    const written = await this.consent.writeWhileAuthorized(GARMIN_PROVIDER_ID, userId, async (tx, granted) => {
      if (!granted.categories.includes('activity')) return null;
      const sensors = granted.categories.includes('activity_sensors');
      const removed: string[] = sensors ? [] : ['sensors'];
      const startedAt = new Date(record.startedAtSec * 1000);
      const modality = modalityFromGarmin(record.activityType);
      const consented = applyActivityConsent(record, granted.categories);
      const route = granted.categories.includes('activity_route');
      const points = (consented.samples ?? []).map((sample) => ({
        offsetSec: sample.offsetSec,
        distanceMeters: sample.distanceMeters,
        speedKmh: sample.speedKmh,
        heartRateBpm: sensors ? sample.heartRateBpm : null,
        cadenceSpm: sensors ? sample.cadenceSpm : null,
        powerWatts: sensors ? sample.powerWatts : null,
        elevationMeters: sensors ? sample.elevationMeters : null,
        // Tempos acumulados: dados da propria atividade (autorizacao 'activity').
        clockDurationSec: sample.clockDurationSec,
        timerDurationSec: sample.timerDurationSec,
        movingDurationSec: sample.movingDurationSec,
        temperatureCelsius: sample.temperatureCelsius,
        latitude: sample.latitude,
        longitude: sample.longitude,
      })).filter((point) => point.distanceMeters !== null || point.speedKmh !== null || point.heartRateBpm !== null || point.cadenceSpm !== null || point.powerWatts !== null || point.elevationMeters !== null || point.movingDurationSec !== null || point.timerDurationSec !== null || point.clockDurationSec !== null || point.temperatureCelsius !== null || point.latitude !== null);
      const hasRoute = points.some((point) => point.latitude !== null && point.longitude !== null);

      const payload = {
        summaryId: record.summaryId,
        activityId: record.activityId || null,
        activityType: record.activityType,
        deviceName: record.deviceName,
        startedAt: startedAt.toISOString(),
        durationSec: record.durationSec,
        distanceMeters: record.distanceMeters,
        modality,
        sensorsIncluded: sensors,
        routeIncluded: route && hasRoute,
        points: points.length,
      };
      const ingestionMeta = { source: 'push', kind: record.kind, fitStored: false, receivedAt: new Date().toISOString(), removedGroups: removed };
      const raw = await tx.rawExternalActivity.upsert({
        where: { provider_userId_externalId: { provider: GARMIN_PROVIDER_ID, userId, externalId } },
        create: { userId, provider: GARMIN_PROVIDER_ID, externalId, payload: payload as Prisma.InputJsonValue, payloadSchemaVersion: GARMIN_PAYLOAD_SCHEMA, ingestionMeta: ingestionMeta as Prisma.InputJsonValue },
        update: { payload: payload as Prisma.InputJsonValue, payloadSchemaVersion: GARMIN_PAYLOAD_SCHEMA, ingestionMeta: ingestionMeta as Prisma.InputJsonValue },
      });
      const canonical = {
        startedAt,
        utcOffsetMinutes: record.startOffsetSec === null ? null : Math.round(record.startOffsetSec / 60),
        durationSec: record.durationSec,
        distanceMeters: record.distanceMeters,
        sport: modality,
        caloriesKcal: record.caloriesKcal !== null ? Math.round(record.caloriesKcal) : null,
        avgHeartRateBpm: sensors && record.avgHeartRateBpm !== null ? Math.round(record.avgHeartRateBpm) : null,
        maxHeartRateBpm: sensors && record.maxHeartRateBpm !== null ? Math.round(record.maxHeartRateBpm) : null,
        cadenceAvg: sensors ? record.avgRunCadenceSpm : null,
        powerAvgWatts: sensors && record.powerAvgWatts !== null ? Math.round(record.powerAvgWatts) : null,
        elevationGainMeters: sensors ? record.elevationGainMeters : null,
        hasRoute: record.samples === null ? undefined : hasRoute,
        detailFetchedAt: new Date(),
        providerMetrics: await this.mergedProviderMetrics(tx, userId, externalId, record),
      };
      const log = await tx.activityLog.upsert({
        where: { provider_userId_externalId: { provider: GARMIN_PROVIDER_ID, userId, externalId } },
        create: { userId, provider: GARMIN_PROVIDER_ID, externalId, rawActivityId: raw.id, ...canonical },
        update: { rawActivityId: raw.id, ...canonical },
      });
      // So' os DETALHES trazem a serie: o resumo (sem amostras) nao apaga o que os detalhes ja' gravaram.
      if (record.samples !== null) {
        await tx.activityTimeSeriesPoint.deleteMany({ where: { activityLogId: log.id, normalizationVersion: NORMALIZATION_VERSION } });
        if (points.length > 0) {
          await tx.activityTimeSeriesPoint.createMany({
            data: points.map((point) => ({
              activityLogId: log.id,
              provider: GARMIN_PROVIDER_ID,
              offsetSec: point.offsetSec,
              normalizationVersion: NORMALIZATION_VERSION,
              heartRateBpm: point.heartRateBpm,
              speedKmh: point.speedKmh,
              distanceMeters: point.distanceMeters,
              cadenceSpm: point.cadenceSpm,
              powerWatts: point.powerWatts,
              elevationMeters: point.elevationMeters,
              clockDurationSec: point.clockDurationSec,
              timerDurationSec: point.timerDurationSec,
              movingDurationSec: point.movingDurationSec,
              temperatureCelsius: point.temperatureCelsius,
              latitude: point.latitude,
              longitude: point.longitude,
            })),
            skipDuplicates: true,
          });
        }
      }
      return { activityLogId: log.id, removed };
    });
    if (!written) return { written: false, reason: 'not_authorized' };

    // Pipeline existente (todos best-effort: a atividade ja' esta salva e correta; nenhuma falha daqui desfaz a gravacao).
    const identity = await this.physicalIdentity?.evaluateSafely(written.activityLogId);
    let classification: string | null = null;
    try {
      classification = await this.sessionExecutionLink.classify(written.activityLogId);
    } catch (error) {
      this.logger.warn(`Falha ao classificar atividade Garmin ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await this.activityNotifications.notifyReconciliation(userId, written.activityLogId, classification);
    } catch (error) {
      this.logger.warn(`Falha ao notificar atividade Garmin ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.deviceRegistry?.scheduleRefresh(userId);
    try {
      await this.sessionExecutionLink.reconcileAffectedByIdentity(identity, written.activityLogId);
    } catch (error) {
      this.logger.warn(`Falha ao reconciliar identidade da atividade Garmin ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { written: true, activityLogId: written.activityLogId, classification, removed: written.removed };
  }
}
