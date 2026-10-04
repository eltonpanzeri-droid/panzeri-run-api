import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityTimeSeriesService, NORMALIZATION_VERSION } from '../activity-timeseries/activity-timeseries.service';
import { buildSplits } from './activity-splits';
import { buildChartSeries } from './activity-chart';
import { extractPrescribedSegments } from './prescribed-segments';
import { assignSegments, summarizeSegments } from './activity-segments';
import { buildExecutionSummary } from './execution-summary';

// "Ver treino completo" (03/10/2026): leitura de modelos canonicos apenas — ActivityLog, vinculo
// ativo e ActivityTimeSeriesPoint. Provider aparece so' como origem. Pace e' derivado de
// distancia+duracao na leitura, nunca persistido. Grafico: media por balde dos pontos reais
// (agregacao, sem interpolacao). Nenhuma chamada ao provedor.

@Injectable()
export class ActivityDetailService {
  private readonly logger = new Logger(ActivityDetailService.name);
  // Dedupe por atividade: duas aberturas simultaneas do mesmo treino compartilham o mesmo reprocessamento.
  private readonly rebuilds = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeSeries: ActivityTimeSeriesService,
  ) {}

  private readSeries(activityLogId: string) {
    return this.prisma.activityTimeSeriesPoint.findMany({
      where: { activityLogId, normalizationVersion: NORMALIZATION_VERSION },
      orderBy: { offsetSec: 'asc' },
      select: { offsetSec: true, distanceMeters: true, heartRateBpm: true, speedKmh: true, cadenceSpm: true },
    });
  }

  // Causa dos graficos/parciais ausentes (Bloco 1, 04/10/2026): normalizeFromRawSamples so' era
  // chamado na ingestao de exercicio NOVO. Atividade persistida antes da serie canonica existir (ou
  // cuja normalizacao falhou) ficava com RawActivitySample e zero ActivityTimeSeriesPoint para sempre.
  // Aqui a serie e' reconstruida a partir do raw ja' persistido — idempotente, sem consultar o provedor.
  private async rebuildSeriesFromRaw(log: { id: string; provider: string }): Promise<void> {
    const inFlight = this.rebuilds.get(log.id);
    if (inFlight) return inFlight;
    const job = (async () => {
      try {
        const rawCount = await this.prisma.rawActivitySample.count({ where: { activityLogId: log.id, provider: log.provider } });
        if (rawCount === 0) return;
        await this.timeSeries.normalizeFromRawSamples(log.id, log.provider);
      } catch (error) {
        this.logger.warn(`Falha ao reconstruir serie temporal da atividade ${log.id}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        this.rebuilds.delete(log.id);
      }
    })();
    this.rebuilds.set(log.id, job);
    return job;
  }

  async getDetail(userId: string, activityLogId: string) {
    const log = await this.prisma.activityLog.findFirst({ where: { id: activityLogId, userId } });
    if (!log) throw new NotFoundException('Atividade nao encontrada.');

    const [link, firstRead] = await Promise.all([
      this.prisma.sessionExecutionLink.findFirst({
        where: { activityLogId, status: 'active' },
        include: {
          trainingSession: { select: { id: true, title: true, modality: true, distanceKm: true, durationMin: true, scheduledDate: true, structure: true } },
        },
      }),
      this.readSeries(activityLogId),
    ]);
    let points = firstRead;
    let cadenceAvg = log.cadenceAvg;
    if (points.length === 0) {
      await this.rebuildSeriesFromRaw(log);
      points = await this.readSeries(activityLogId);
      // cadenceAvg e' derivado da serie: acabou de ser (re)calculado, o log lido acima esta' defasado.
      if (points.length > 0) {
        cadenceAvg = (await this.prisma.activityLog.findFirst({ where: { id: activityLogId, userId }, select: { cadenceAvg: true } }))?.cadenceAvg ?? cadenceAvg;
      }
    }

    const segments = link ? extractPrescribedSegments(link.trainingSession.structure) : null;
    const splits = assignSegments(buildSplits(points), segments);
    const chartSeries = buildChartSeries(points);

    const distanceKm = log.distanceMeters != null ? log.distanceMeters / 1000 : null;
    const durationSec = log.durationSec ?? null;
    const avgPaceSecondsKm =
      distanceKm && distanceKm > 0 && durationSec != null ? Math.round(durationSec / distanceKm) : null;

    // Melhorias pos-Blocos 1/3/4 (04/10/2026): summarizeSegments agora le a serie diretamente
    // (nao mais os splits de 1 km), entao funciona igual para blocos >=1 km e para intervalados
    // sub-km (10x400m/200m etc.) sem hardcode de distancia.
    const prescribedSegments = summarizeSegments(points, segments);
    const executionSummary = link
      ? buildExecutionSummary({
          prescribedDistanceKm: link.trainingSession.distanceKm,
          prescribedDurationMin: link.trainingSession.durationMin,
          realizedDistanceKm: distanceKm,
          realizedDurationSec: durationSec,
          realizedPaceSecondsKm: avgPaceSecondsKm,
          segments: prescribedSegments,
        })
      : null;

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
        cadenceAvg,
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
      // Segmentos so' existem quando a prescricao tem estrutura por distancia (km); senao as
      // parciais saem sem agrupamento (segmentIndex null em todas).
      prescribedSegments,
      executionSummary,
      splits,
      chart: chartSeries.points,
      chartAxis: chartSeries.xAxis,
    };
  }
}
