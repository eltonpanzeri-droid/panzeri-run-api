import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hasAiScope, isHealthBlockedForAi } from '../ai-governance/ai-scope';
import { AI_INDICATOR_CATEGORY, INDICATORS_NOTE, IndicatorSeries, MetricRow, buildIndicatorSeries } from './health-indicators';

export interface HealthIndicatorsSummary { periodo: { de: string; ate: string }; observacao: string; indicadores: IndicatorSeries[] }

// Acesso seletivo da IA aos indicadores de saude autorizados (29/10/2026). Dois usos:
//  - summary(): resumo enxuto dos ultimos dias, so do que existe e esta autorizado, que entra no contexto do aluno (sem historico bruto);
//  - query(): serie diaria de indicadores/periodo especificos, para uma analise que precise de mais (comparar com semanas anteriores, relacionar a um treino).
// Ambos respeitam o escopo de IA: so' rodam com escopo ativo (fail-closed) e tratam como inexistente o que o aluno nao autorizou, retirou ou tem texto de consentimento desatualizado.
@Injectable()
export class HealthIndicatorsService {
  constructor(private readonly prisma: PrismaService) {}

  private async rows(athleteId: string, from: Date, to: Date): Promise<MetricRow[]> {
    const rows = await this.prisma.wearableMetricRecord.findMany({
      where: { userId: athleteId, metricKind: { in: Object.keys(AI_INDICATOR_CATEGORY) }, startTimeSec: { gte: Math.floor(from.getTime() / 1000), lte: Math.floor(to.getTime() / 1000) } },
      select: { provider: true, providerSummaryId: true, metricKind: true, calendarDate: true, startTimeSec: true, values: true },
      orderBy: { startTimeSec: 'asc' },
    });
    return rows as MetricRow[];
  }

  private allowed = (provider: string, category: string) => !isHealthBlockedForAi(provider, category);

  async summary(athleteId: string, options: { days?: number; now?: Date } = {}): Promise<HealthIndicatorsSummary | null> {
    if (!hasAiScope()) return null; // sem escopo de IA nao ha como saber o que o aluno autorizou: nada sai
    const now = options.now ?? new Date();
    const from = new Date(now.getTime() - (options.days ?? 28) * 86_400_000);
    const indicadores = buildIndicatorSeries(await this.rows(athleteId, from, now), this.allowed, { lastValues: 7, maxSeries: 80 });
    if (indicadores.length === 0) return null;
    return { periodo: { de: from.toISOString().slice(0, 10), ate: now.toISOString().slice(0, 10) }, observacao: INDICATORS_NOTE, indicadores };
  }

  // Serie completa (um valor por dia) de indicadores especificos num periodo. `indicatorIds` no formato "<tipo>.<chave>" (ex.: "vo2_max.vo2MaxMlKgMin"); vazio = todos os autorizados.
  async query(athleteId: string, options: { indicatorIds?: string[]; from: Date; to: Date; maxPointsPerSeries?: number }): Promise<IndicatorSeries[]> {
    if (!hasAiScope()) return [];
    const wanted = options.indicatorIds?.length ? new Set(options.indicatorIds) : null;
    const series = buildIndicatorSeries(await this.rows(athleteId, options.from, options.to), this.allowed, { lastValues: options.maxPointsPerSeries ?? 120, maxSeries: 200 });
    return wanted ? series.filter((s) => wanted.has(s.id)) : series;
  }
}
