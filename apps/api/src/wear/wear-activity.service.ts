import { ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DeviceRegistryService } from '../equipment/device-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { isActivityExcluded } from '../prisma/activity-exclusion-scope';
import { SessionExecutionLinkService } from '../activity-execution/session-execution-link.service';
import { ActivityNotificationService } from '../activity-execution/activity-notification.service';
import { PhysicalActivityIdentityService } from '../activity-execution/physical-activity-identity.service';
import { NORMALIZATION_VERSION } from '../activity-timeseries/activity-timeseries.service';
import { WearConsentService } from './wear-consent.service';
import { WEAR_OS_PROVIDER_ID } from './wear-consent';
import { normalizeWearActivity } from './wear-activity';

// Gravacao de um treino do relogio Wear OS no pipeline existente: RawExternalActivity -> ActivityLog -> serie temporal -> identidade fisica -> classificacao/vinculo (17/11/2026). Mesma esteira da
// Garmin/Zepp; a ORIGEM e' o JSON enviado pelo aplicativo do relogio e o consentimento e' aplicado POR CAMPO:
//   'activity'         : data/hora, duracao (cronometro), distancia, modalidade e a serie de distancia/velocidade; os tres tempos (atividade, cronometro, em movimento) ficam no resumo;
//   'activity_sensors' : frequencia cardiaca (media, maxima e a serie);
//   'activity_route'   : latitude/longitude e altitude; hasRoute so' e' true quando as coordenadas foram guardadas.
//  - Idempotente: a chave e' o clientId que o relogio gerou ao iniciar o treino (reenvio nao duplica).
//  - Classificacao, vinculos e feedback ja' decididos nao sao tocados no reenvio.
export const WEAR_PAYLOAD_SCHEMA = 'wear-os-activity-1';

export type WearIngestResult = { written: true; activityLogId: string; classification: string | null; removed: string[] } | { written: false; reason: 'excluded' };

@Injectable()
export class WearActivityService {
  private readonly logger = new Logger(WearActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: WearConsentService,
    private readonly sessionExecutionLink: SessionExecutionLinkService,
    private readonly activityNotifications: ActivityNotificationService,
    private readonly physicalIdentity?: PhysicalActivityIdentityService,
    @Optional() private readonly deviceRegistry?: DeviceRegistryService,
  ) {}

  async ingest(userId: string, deviceId: string, body: unknown, now: Date = new Date()): Promise<WearIngestResult> {
    const input = normalizeWearActivity(body, now);
    const externalId = input.clientId;
    // Atividade ja' excluida/ignorada pela aluna ou treinador: nada e' regravado (e o relogio pode apagar a copia dele).
    if (await isActivityExcluded(this.prisma, userId, WEAR_OS_PROVIDER_ID, externalId)) return { written: false, reason: 'excluded' };

    const written = await this.consent.writeWhileAuthorized(userId, async (tx, access) => {
      if (!access.allowed.has('activity')) return null;
      const sensors = access.allowed.has('activity_sensors');
      const route = access.allowed.has('activity_route');
      const removed: string[] = [...(sensors ? [] : ['sensors']), ...(route ? [] : ['route'])];
      const points = input.points
        .map((p) => ({
          offsetSec: p.t,
          distanceMeters: p.dist,
          speedKmh: p.speed !== null ? Math.round(p.speed * 3.6 * 100) / 100 : null,
          heartRateBpm: sensors ? p.hr : null,
          latitude: route ? p.lat : null,
          longitude: route ? p.lon : null,
          elevationMeters: route ? p.alt : null,
        }))
        .filter((p) => p.distanceMeters !== null || p.speedKmh !== null || p.heartRateBpm !== null || p.latitude !== null);
      const hasRoute = points.some((p) => p.latitude !== null && p.longitude !== null);
      const payload = {
        clientId: input.clientId, sessionId: input.sessionId, deviceId,
        startedAt: input.startedAt.toISOString(), endedAt: input.endedAt.toISOString(),
        elapsedSec: input.elapsedSec, durationSec: input.durationSec, movingSec: input.movingSec, distanceMeters: input.distanceMeters,
        interrupted: input.interrupted, sensorsIncluded: sensors, routeIncluded: route && hasRoute, points: points.length,
      };
      const ingestionMeta = { source: 'wear_upload', receivedAt: now.toISOString(), removedGroups: removed };
      const raw = await tx.rawExternalActivity.upsert({
        where: { provider_userId_externalId: { provider: WEAR_OS_PROVIDER_ID, userId, externalId } },
        create: { userId, provider: WEAR_OS_PROVIDER_ID, externalId, payload: payload as Prisma.InputJsonValue, payloadSchemaVersion: WEAR_PAYLOAD_SCHEMA, ingestionMeta: ingestionMeta as Prisma.InputJsonValue },
        update: { payload: payload as Prisma.InputJsonValue, payloadSchemaVersion: WEAR_PAYLOAD_SCHEMA, ingestionMeta: ingestionMeta as Prisma.InputJsonValue },
      });
      const canonical = {
        startedAt: input.startedAt,
        utcOffsetMinutes: input.utcOffsetMinutes,
        durationSec: input.durationSec,
        distanceMeters: input.distanceMeters,
        sport: 'corrida',
        avgHeartRateBpm: sensors ? input.avgHr : null,
        maxHeartRateBpm: sensors ? input.maxHr : null,
        hasRoute,
        detailFetchedAt: now,
        providerMetrics: { wear: { deviceId, prescribedSessionId: input.sessionId, elapsedSec: input.elapsedSec, timerSec: input.durationSec, movingSec: input.movingSec, interrupted: input.interrupted } } as Prisma.InputJsonValue,
      };
      const log = await tx.activityLog.upsert({
        where: { provider_userId_externalId: { provider: WEAR_OS_PROVIDER_ID, userId, externalId } },
        create: { userId, provider: WEAR_OS_PROVIDER_ID, externalId, rawActivityId: raw.id, ...canonical },
        update: { rawActivityId: raw.id, ...canonical },
      });
      await tx.activityTimeSeriesPoint.deleteMany({ where: { activityLogId: log.id, normalizationVersion: NORMALIZATION_VERSION } });
      if (points.length > 0) {
        const lastIndex = points.length - 1;
        await tx.activityTimeSeriesPoint.createMany({
          data: points.map((p, index) => ({
            activityLogId: log.id, provider: WEAR_OS_PROVIDER_ID, offsetSec: p.offsetSec, normalizationVersion: NORMALIZATION_VERSION,
            heartRateBpm: p.heartRateBpm, speedKmh: p.speedKmh, distanceMeters: p.distanceMeters,
            latitude: p.latitude, longitude: p.longitude, elevationMeters: p.elevationMeters,
            // os tres tempos acumulados (sempre moving <= timer <= clock) ficam no ultimo ponto
            ...(index === lastIndex ? { clockDurationSec: input.elapsedSec, timerDurationSec: input.durationSec, movingDurationSec: input.movingSec } : {}),
          })),
          skipDuplicates: true,
        });
      }
      return { activityLogId: log.id, removed };
    });
    if (!written) throw new ForbiddenException({ code: 'wear_consent_required', message: 'Autorize o relógio no Panzeri Run para enviar os treinos.' });

    // Pipeline existente (todos best-effort: a atividade ja' esta salva e correta; nenhuma falha daqui desfaz a gravacao).
    const identity = await this.physicalIdentity?.evaluateSafely(written.activityLogId);
    let classification: string | null = null;
    try {
      classification = await this.sessionExecutionLink.classify(written.activityLogId);
    } catch (error) {
      this.logger.warn(`Falha ao classificar atividade Wear OS ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await this.activityNotifications.notifyReconciliation(userId, written.activityLogId, classification);
    } catch (error) {
      this.logger.warn(`Falha ao notificar atividade Wear OS ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.deviceRegistry?.scheduleRefresh(userId);
    try {
      await this.sessionExecutionLink.reconcileAffectedByIdentity(identity, written.activityLogId);
    } catch (error) {
      this.logger.warn(`Falha ao reconciliar identidade da atividade Wear OS ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { written: true, activityLogId: written.activityLogId, classification, removed: written.removed };
  }
}
