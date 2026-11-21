import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isActivityExcluded } from '../prisma/activity-exclusion-scope';
import { SessionExecutionLinkService } from '../activity-execution/session-execution-link.service';
import { ActivityNotificationService } from '../activity-execution/activity-notification.service';
import { PhysicalActivityIdentityService } from '../activity-execution/physical-activity-identity.service';
import { NORMALIZATION_VERSION } from '../activity-timeseries/activity-timeseries.service';
import { RunConsentService } from './run-consent.service';
import { PANZERI_RUN_PROVIDER_ID } from './run-consent';
import { normalizeRunActivity } from './run-activity';

// Gravacao de um treino feito no proprio Panzeri Run (Iniciar treino) no pipeline existente: RawExternalActivity -> ActivityLog -> serie temporal -> identidade fisica -> classificacao/vinculo (21/11/2026).
// Copia deliberada do caminho do relogio Wear OS (para nao tocar nele). A ORIGEM e' o JSON que o aplicativo envia e o consentimento e' aplicado POR CAMPO:
//   'activity'       : data/hora, duracao (cronometro), distancia, modalidade e a serie de distancia/velocidade; os tres tempos (atividade, cronometro, em movimento) ficam no resumo;
//   'activity_route' : latitude/longitude e altitude; hasRoute so' e' true quando as coordenadas foram guardadas.
// O celular nao registra frequencia cardiaca (nada de sensores aqui).
//  - Idempotente: a chave e' o clientId que o aplicativo gerou ao iniciar o treino (reenvio nao duplica).
//  - Classificacao, vinculos e feedback ja' decididos nao sao tocados no reenvio.
export const RUN_PAYLOAD_SCHEMA = 'panzeri-run-activity-1';

export type RunIngestResult = { written: true; activityLogId: string; classification: string | null; removed: string[] } | { written: false; reason: 'excluded' };

@Injectable()
export class RunActivityService {
  private readonly logger = new Logger(RunActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: RunConsentService,
    private readonly sessionExecutionLink: SessionExecutionLinkService,
    private readonly activityNotifications: ActivityNotificationService,
    private readonly physicalIdentity?: PhysicalActivityIdentityService,
  ) {}

  async ingest(userId: string, body: unknown, now: Date = new Date()): Promise<RunIngestResult> {
    const input = normalizeRunActivity(body, now);
    const externalId = input.clientId;
    // Atividade ja' excluida/ignorada pela aluna ou treinador: nada e' regravado.
    if (await isActivityExcluded(this.prisma, userId, PANZERI_RUN_PROVIDER_ID, externalId)) return { written: false, reason: 'excluded' };

    const written = await this.consent.writeWhileAuthorized(userId, async (tx, access) => {
      if (!access.allowed.has('activity')) return null;
      const route = access.allowed.has('activity_route');
      const removed: string[] = route ? [] : ['route'];
      const points = input.points
        .map((p) => ({
          offsetSec: p.t,
          distanceMeters: p.dist,
          speedKmh: p.speed !== null ? Math.round(p.speed * 3.6 * 100) / 100 : null,
          latitude: route ? p.lat : null,
          longitude: route ? p.lon : null,
          elevationMeters: route ? p.alt : null,
        }))
        .filter((p) => p.distanceMeters !== null || p.speedKmh !== null || p.latitude !== null);
      const hasRoute = points.some((p) => p.latitude !== null && p.longitude !== null);
      const payload = {
        clientId: input.clientId, sessionId: input.sessionId,
        startedAt: input.startedAt.toISOString(), endedAt: input.endedAt.toISOString(),
        elapsedSec: input.elapsedSec, durationSec: input.durationSec, movingSec: input.movingSec, distanceMeters: input.distanceMeters,
        interrupted: input.interrupted, routeIncluded: route && hasRoute, points: points.length,
      };
      const ingestionMeta = { source: 'run_upload', receivedAt: now.toISOString(), removedGroups: removed };
      const raw = await tx.rawExternalActivity.upsert({
        where: { provider_userId_externalId: { provider: PANZERI_RUN_PROVIDER_ID, userId, externalId } },
        create: { userId, provider: PANZERI_RUN_PROVIDER_ID, externalId, payload: payload as Prisma.InputJsonValue, payloadSchemaVersion: RUN_PAYLOAD_SCHEMA, ingestionMeta: ingestionMeta as Prisma.InputJsonValue },
        update: { payload: payload as Prisma.InputJsonValue, payloadSchemaVersion: RUN_PAYLOAD_SCHEMA, ingestionMeta: ingestionMeta as Prisma.InputJsonValue },
      });
      const canonical = {
        startedAt: input.startedAt,
        utcOffsetMinutes: input.utcOffsetMinutes,
        durationSec: input.durationSec,
        distanceMeters: input.distanceMeters,
        sport: 'corrida',
        hasRoute,
        detailFetchedAt: now,
        providerMetrics: { run: { prescribedSessionId: input.sessionId, elapsedSec: input.elapsedSec, timerSec: input.durationSec, movingSec: input.movingSec, interrupted: input.interrupted } } as Prisma.InputJsonValue,
      };
      const log = await tx.activityLog.upsert({
        where: { provider_userId_externalId: { provider: PANZERI_RUN_PROVIDER_ID, userId, externalId } },
        create: { userId, provider: PANZERI_RUN_PROVIDER_ID, externalId, rawActivityId: raw.id, ...canonical },
        update: { rawActivityId: raw.id, ...canonical },
      });
      await tx.activityTimeSeriesPoint.deleteMany({ where: { activityLogId: log.id, normalizationVersion: NORMALIZATION_VERSION } });
      if (points.length > 0) {
        const lastIndex = points.length - 1;
        await tx.activityTimeSeriesPoint.createMany({
          data: points.map((p, index) => ({
            activityLogId: log.id, provider: PANZERI_RUN_PROVIDER_ID, offsetSec: p.offsetSec, normalizationVersion: NORMALIZATION_VERSION,
            speedKmh: p.speedKmh, distanceMeters: p.distanceMeters,
            latitude: p.latitude, longitude: p.longitude, elevationMeters: p.elevationMeters,
            // os tres tempos acumulados (sempre moving <= timer <= clock) ficam no ultimo ponto
            ...(index === lastIndex ? { clockDurationSec: input.elapsedSec, timerDurationSec: input.durationSec, movingDurationSec: input.movingSec } : {}),
          })),
          skipDuplicates: true,
        });
      }
      return { activityLogId: log.id, removed };
    });
    if (!written) throw new ForbiddenException({ code: 'run_consent_required', message: 'Autorize a gravação de treinos no Panzeri Run para guardar este treino.' });

    // Pipeline existente (todos best-effort: a atividade ja' esta salva e correta; nenhuma falha daqui desfaz a gravacao).
    const identity = await this.physicalIdentity?.evaluateSafely(written.activityLogId);
    let classification: string | null = null;
    try {
      classification = await this.sessionExecutionLink.classify(written.activityLogId);
    } catch (error) {
      this.logger.warn(`Falha ao classificar treino gravado no Panzeri Run ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await this.activityNotifications.notifyReconciliation(userId, written.activityLogId, classification);
    } catch (error) {
      this.logger.warn(`Falha ao notificar treino gravado no Panzeri Run ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await this.sessionExecutionLink.reconcileAffectedByIdentity(identity, written.activityLogId);
    } catch (error) {
      this.logger.warn(`Falha ao reconciliar identidade do treino gravado no Panzeri Run ${written.activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { written: true, activityLogId: written.activityLogId, classification, removed: written.removed };
  }
}
