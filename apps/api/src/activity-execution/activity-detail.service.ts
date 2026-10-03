import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NORMALIZATION_VERSION } from '../activity-timeseries/activity-timeseries.service';
import { buildSplits } from './activity-splits';

// "Ver treino completo" (03/10/2026): leitura de modelos canonicos apenas — ActivityLog, vinculo
// ativo e ActivityTimeSeriesPoint. Provider aparece so' como origem. Pace e' derivado de
// distancia+duracao na leitura, nunca persistido. Grafico: amostragem uniforme dos pontos reais
// (nenhuma interpolacao). Nenhuma chamada ao provedor.
const CHART_MAX_POINTS = 300;

@Injectable()
export class ActivityDetailService {
  constructor(private readonly prisma: PrismaService) {}

  async getDetail(userId: string, activityLogId: string) {
    const log = await this.prisma.activityLog.findFirst({ where: { id: activityLogId, userId } });
    if (!log) throw new NotFoundException('Atividade nao encontrada.');

    const [link, points] = await Promise.all([
      this.prisma.sessionExecutionLink.findFirst({
        where: { activityLogId, status: 'active' },
        include: {
          trainingSession: { select: { id: true, title: true, modality: true, distanceKm: true, durationMin: true, scheduledDate: true } },
        },
      }),
      this.prisma.activityTimeSeriesPoint.findMany({
        where: { activityLogId, normalizationVersion: NORMALIZATION_VERSION },
        orderBy: { offsetSec: 'asc' },
        select: { offsetSec: true, distanceMeters: true, heartRateBpm: true, speedKmh: true, cadenceSpm: true },
      }),
    ]);

    const distanceKm = log.distanceMeters != null ? log.distanceMeters / 1000 : null;
    const durationSec = log.durationSec ?? null;
    const avgPaceSecondsKm =
      distanceKm && distanceKm > 0 && durationSec != null ? Math.round(durationSec / distanceKm) : null;

    return {
      activityLogId: log.id,
      provider: log.provider,
      startedAt: log.startedAt,
      utcOffsetMinutes: log.utcOffsetMinutes,
      sport: log.sport,
      summary: {
        distanceKm,
        durationSec,
        avgPaceSecondsKm,
        avgHeartRateBpm: log.avgHeartRateBpm,
        maxHeartRateBpm: log.maxHeartRateBpm,
        cadenceAvg: log.cadenceAvg,
        caloriesKcal: log.caloriesKcal,
      },
      prescribed: link
        ? {
            trainingSessionId: link.trainingSession.id,
            title: link.trainingSession.title,
            modality: link.trainingSession.modality,
            distanceKm: link.trainingSession.distanceKm,
            durationMin: link.trainingSession.durationMin,
            scheduledDate: link.trainingSession.scheduledDate,
          }
        : null,
      splits: buildSplits(points),
      chart: downsample(points),
    };
  }
}

function downsample<T>(points: T[]): T[] {
  if (points.length <= CHART_MAX_POINTS) return points;
  const step = Math.ceil(points.length / CHART_MAX_POINTS);
  return points.filter((_, index) => index % step === 0);
}
