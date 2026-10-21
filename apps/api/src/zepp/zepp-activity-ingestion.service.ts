import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { SessionExecutionLinkService } from '../activity-execution/session-execution-link.service';
import { ActivityNotificationService } from '../activity-execution/activity-notification.service';
import { PhysicalActivityIdentityService } from '../activity-execution/physical-activity-identity.service';
import { NORMALIZATION_VERSION } from '../activity-timeseries/activity-timeseries.service';
import { ZEPP_PROVIDER_ID } from './zepp.connector';
import { ZeppFitActivity } from './zepp-fit';
import { applyZeppConsent } from './zepp-fit-consent';

// Gravacao de uma atividade da Zepp no pipeline existente (Lote 3): RawExternalActivity -> ActivityLog -> serie temporal -> identidade fisica -> classificacao/vinculo.
// Mesma esteira da Polar (nada de logica de correspondencia nova); o que muda e' a ORIGEM (FIT normalizado) e a regra de consentimento por campo.
//
//  - O FIT original nao existe aqui: so' o ZeppFitActivity ja' normalizado. RawExternalActivity.payload guarda apenas o resumo AUTORIZADO (sem coordenadas, sem serie).
//  - A filtragem por campo acontece DENTRO da trava de consentimento (writeWhileAuthorized): o que o aluno retirou no meio do processamento nao e' gravado.
//  - Idempotente: o mesmo summaryId atualiza as mesmas linhas e REFAZ a serie; classificacao, vinculos e feedback ja' decididos nao sao tocados na atualizacao.
export const ZEPP_PAYLOAD_SCHEMA = 'zepp-fit-normalized-1';

export interface ZeppIngestMeta {
  summaryId: string;
  activityId: string | null;
  activityType: string | null;
  deviceName: string | null;
  source: 'webhook' | 'backfill';
}

export type ZeppIngestResult = { written: false; reason: 'not_authorized' } | { written: true; activityLogId: string; classification: string | null; removed: string[] };

@Injectable()
export class ZeppActivityIngestionService {
  private readonly logger = new Logger(ZeppActivityIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ProviderConsentService,
    private readonly sessionExecutionLink: SessionExecutionLinkService,
    private readonly activityNotifications: ActivityNotificationService,
    private readonly physicalIdentity?: PhysicalActivityIdentityService,
  ) {}

  async ingest(userId: string, meta: ZeppIngestMeta, fit: ZeppFitActivity): Promise<ZeppIngestResult> {
    const written = await this.consent.writeWhileAuthorized(ZEPP_PROVIDER_ID, userId, async (tx, granted) => {
      // Sem a categoria 'activity' nada e' guardado.
      if (!granted.categories.includes('activity')) return null;
      const { activity, removed } = applyZeppConsent(fit, granted.categories);
      const externalId = meta.summaryId;
      const payload = {
        summaryId: meta.summaryId,
        activityId: meta.activityId,
        activityType: meta.activityType,
        deviceName: meta.deviceName,
        startedAt: activity.startedAt.toISOString(),
        durationSec: activity.durationSec,
        distanceMeters: activity.distanceMeters,
        modality: activity.modality,
        sportRaw: activity.sportRaw,
        sensorsIncluded: !removed.includes('sensors'),
        routeIncluded: !removed.includes('route'),
        points: activity.points.length,
        notes: activity.notes,
      };
      const ingestionMeta = { source: meta.source, fitStored: false, receivedAt: new Date().toISOString(), removedGroups: removed };
      const raw = await tx.rawExternalActivity.upsert({
        where: { provider_userId_externalId: { provider: ZEPP_PROVIDER_ID, userId, externalId } },
        create: { userId, provider: ZEPP_PROVIDER_ID, externalId, payload: payload as Prisma.InputJsonValue, payloadSchemaVersion: ZEPP_PAYLOAD_SCHEMA, ingestionMeta: ingestionMeta as Prisma.InputJsonValue },
        update: { payload: payload as Prisma.InputJsonValue, payloadSchemaVersion: ZEPP_PAYLOAD_SCHEMA, ingestionMeta: ingestionMeta as Prisma.InputJsonValue },
      });
      const canonical = {
        startedAt: activity.startedAt,
        utcOffsetMinutes: activity.utcOffsetMinutes,
        durationSec: activity.durationSec,
        distanceMeters: activity.distanceMeters,
        sport: activity.modality,
        caloriesKcal: activity.caloriesKcal !== null ? Math.round(activity.caloriesKcal) : null,
        avgHeartRateBpm: activity.avgHeartRateBpm !== null ? Math.round(activity.avgHeartRateBpm) : null,
        maxHeartRateBpm: activity.maxHeartRateBpm !== null ? Math.round(activity.maxHeartRateBpm) : null,
        cadenceAvg: activity.cadenceAvg,
        powerAvgWatts: activity.powerAvgWatts !== null ? Math.round(activity.powerAvgWatts) : null,
        elevationGainMeters: activity.elevationGainMeters,
        hasRoute: activity.hasRoute,
        detailFetchedAt: new Date(),
        providerMetrics: { zepp: { activityType: meta.activityType, deviceName: meta.deviceName, sportRaw: activity.sportRaw } } as Prisma.InputJsonValue,
      };
      const log = await tx.activityLog.upsert({
        where: { provider_userId_externalId: { provider: ZEPP_PROVIDER_ID, userId, externalId } },
        create: { userId, provider: ZEPP_PROVIDER_ID, externalId, rawActivityId: raw.id, ...canonical },
        update: { rawActivityId: raw.id, ...canonical },
      });
      // Serie refeita do zero a cada gravacao (idempotente e respeita consentimento reduzido).
      await tx.activityTimeSeriesPoint.deleteMany({ where: { activityLogId: log.id, normalizationVersion: NORMALIZATION_VERSION } });
      if (activity.points.length > 0) {
        await tx.activityTimeSeriesPoint.createMany({
          data: activity.points.map((point) => ({
            activityLogId: log.id,
            provider: ZEPP_PROVIDER_ID,
            offsetSec: point.offsetSec,
            normalizationVersion: NORMALIZATION_VERSION,
            heartRateBpm: point.heartRateBpm,
            speedKmh: point.speedKmh,
            distanceMeters: point.distanceMeters,
            cadenceSpm: point.cadenceSpm,
            powerWatts: point.powerWatts,
            elevationMeters: point.elevationMeters,
            latitude: point.latitude,
            longitude: point.longitude,
          })),
          skipDuplicates: true,
        });
      }
      return { activityLogId: log.id, removed };
    });
    if (!written) return { written: false, reason: 'not_authorized' };

    // Pipeline existente (todos best-effort: a atividade ja' esta salva e correta; nenhuma falha daqui desfaz a gravacao).
    const identity = await this.physicalIdentity?.evaluateSafely(written.activityLogId);
    // A Zepp confirmou (21/10/2026) que o evento e o FIT NAO trazem o workoutId publicado: nao existe vinculo "exato" por identificador. A associacao com o treino prescrito
    // e' SEMPRE a do mecanismo existente (data, modalidade, horario e caracteristicas da sessao): automatica = inferida (origin 'automatic'); confirmada so' pelo aluno/treinador.
    let classification: string | null = null;
    try {
      classification = await this.sessionExecutionLink.classify(written.activityLogId);
    } catch (error) {
      this.logger.warn(`Falha ao classificar atividade Zepp ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await this.activityNotifications.notifyReconciliation(userId, written.activityLogId, classification);
    } catch (error) {
      this.logger.warn(`Falha ao notificar atividade Zepp ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await this.sessionExecutionLink.reconcileAffectedByIdentity(identity, written.activityLogId);
    } catch (error) {
      this.logger.warn(`Falha ao reconciliar identidade da atividade Zepp ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { written: true, activityLogId: written.activityLogId, classification, removed: written.removed };
  }
}
