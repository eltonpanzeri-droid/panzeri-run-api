import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Primeira camada canonica de serie temporal (03/10/2026) — ver comentario do model
// ActivityTimeSeriesPoint em schema.prisma pra justificativa completa (uma linha por offset, nao
// por metrica; recording-rate determina o eixo temporal por metrica; sem interpolacao).
//
// NORMALIZATION_VERSION existe pra permitir mudar a logica no futuro sem apagar/reescrever
// silenciosamente o que ja foi calculado com a logica anterior. So' incrementar quando a REGRA de
// transformacao mudar (nao a cada deploy).
export const NORMALIZATION_VERSION = 1;

type CanonicalMetric = 'heartRate' | 'speed' | 'cadenceRaw' | 'distance';

// So' Polar tem mapeamento confirmado hoje. Provider desconhecido = nenhuma normalizacao (nunca
// inventar correspondencia de sampleType pra um provider que nao analisamos ainda).
const METRIC_SAMPLE_TYPE_BY_PROVIDER: Record<string, Partial<Record<CanonicalMetric, string>>> = {
  polar: { heartRate: '0', speed: '1', cadenceRaw: '2', distance: '10' },
};

interface ParsedSeries {
  recordingRateSec: number;
  values: Array<number | null>;
}

interface PointPatch {
  heartRateBpm?: number;
  speedKmh?: number;
  distanceMeters?: number;
  cadenceSpm?: number;
}

@Injectable()
export class ActivityTimeSeriesService {
  private readonly logger = new Logger(ActivityTimeSeriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Le RawActivitySample (NUNCA escreve nele) e preenche ActivityTimeSeriesPoint. Idempotente: pode
  // ser chamado de novo pra mesma atividade (resync) sem duplicar — upsert por
  // (activityLogId, offsetSec, normalizationVersion).
  async normalizeFromRawSamples(activityLogId: string, provider: string): Promise<void> {
    const mapping = METRIC_SAMPLE_TYPE_BY_PROVIDER[provider];
    if (!mapping) return;

    const rows = await this.prisma.rawActivitySample.findMany({ where: { activityLogId, provider } });
    const byType = new Map(rows.map((row) => [row.sampleType, row]));

    const points = new Map<number, PointPatch>();
    const mergeAtOffset = (offsetSec: number, patch: PointPatch) => {
      points.set(offsetSec, { ...(points.get(offsetSec) ?? {}), ...patch });
    };

    if (mapping.heartRate) {
      const series = this.parseSampleSeries(byType.get(mapping.heartRate)?.payload);
      series?.values.forEach((value, index) => {
        if (value === null) return;
        mergeAtOffset(index * series.recordingRateSec, { heartRateBpm: Math.round(value) });
      });
    }

    if (mapping.speed) {
      const series = this.parseSampleSeries(byType.get(mapping.speed)?.payload);
      series?.values.forEach((value, index) => {
        if (value === null) return;
        mergeAtOffset(index * series.recordingRateSec, { speedKmh: value });
      });
    }

    if (mapping.distance) {
      const series = this.parseSampleSeries(byType.get(mapping.distance)?.payload);
      series?.values.forEach((value, index) => {
        if (value === null) return;
        mergeAtOffset(index * series.recordingRateSec, { distanceMeters: value });
      });
    }

    if (mapping.cadenceRaw) {
      // Transformacao Polar raw->spm (x2) aplicada aqui, mas NAO vira campo/flag no modelo
      // canonico: e' reconstruivel auditando `provider` + `normalizationVersion` desta linha
      // contra este metodo e o RawActivitySample original (valor bruto por perna, ja preservado
      // la, nunca duplicado aqui). Ver comentario do model em schema.prisma.
      const series = this.parseSampleSeries(byType.get(mapping.cadenceRaw)?.payload);
      series?.values.forEach((value, index) => {
        if (value === null) return;
        mergeAtOffset(index * series.recordingRateSec, { cadenceSpm: Math.round(value * 2) });
      });
    }

    for (const [offsetSec, patch] of points) {
      try {
        await this.prisma.activityTimeSeriesPoint.upsert({
          where: { activityLogId_offsetSec_normalizationVersion: { activityLogId, offsetSec, normalizationVersion: NORMALIZATION_VERSION } },
          create: { activityLogId, provider, offsetSec, normalizationVersion: NORMALIZATION_VERSION, ...patch },
          update: { ...patch },
        });
      } catch (error) {
        this.logger.warn(`Falha ao gravar ponto de serie temporal (atividade ${activityLogId}, offset ${offsetSec}s): ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (mapping.cadenceRaw) {
      await this.updateCadenceAvg(activityLogId);
    }
  }

  // Semantica explicita (03/10/2026, requisito do pedido de normalizacao): cadenceSpm igual a 0
  // significa "sem sinal de movimento ainda" (padrao observado nos primeiros segundos de toda
  // atividade real testada), nunca uma cadencia valida de corrida — por isso e' excluida da media.
  // Filtrar por cadenceSpm > 0 e' equivalente a filtrar pelo bruto > 0 (a transformacao x2 preserva
  // zero/positividade), sem precisar de nenhum campo adicional no canonico pra' isso.
  private async updateCadenceAvg(activityLogId: string) {
    const points = await this.prisma.activityTimeSeriesPoint.findMany({
      where: { activityLogId, normalizationVersion: NORMALIZATION_VERSION, cadenceSpm: { gt: 0 } },
      select: { cadenceSpm: true },
    });
    if (points.length === 0) return;
    const average = points.reduce((sum, point) => sum + (point.cadenceSpm as number), 0) / points.length;
    await this.prisma.activityLog.update({ where: { id: activityLogId }, data: { cadenceAvg: Math.round(average) } });
  }

  // Defensivo por desenho: o payload bruto de uma amostra Polar observado ate agora e'
  // { data: "v1,v2,...", "sample-type": n, "recording-rate": n }, com `data` uma string separada
  // por virgula (nao um array JSON). Token vazio/nao numerico ("", "None", "null") vira null —
  // ausencia, nunca zero. recording-rate ausente/invalido => serie inteira ignorada (nunca assume
  // 1 segundo).
  private parseSampleSeries(payload: unknown): ParsedSeries | null {
    if (!payload || typeof payload !== 'object') return null;
    const obj = payload as Record<string, unknown>;
    const rate = obj['recording-rate'];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;

    const raw = obj['data'];
    const tokens: string[] = typeof raw === 'string'
      ? raw.split(',')
      : Array.isArray(raw)
      ? raw.map((item) => String(item))
      : [];

    const values = tokens.map((token) => {
      const trimmed = token.trim().toLowerCase();
      if (trimmed === '' || trimmed === 'none' || trimmed === 'null') return null;
      const num = Number(token.trim());
      return Number.isFinite(num) ? num : null;
    });

    return { recordingRateSec: rate, values };
  }
}
