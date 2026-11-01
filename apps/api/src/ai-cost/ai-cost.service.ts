import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MathLayerService, SeriesPoint } from '../training-intelligence/math-layer.service';
import { LongitudinalDynamicsService } from '../training-intelligence/longitudinal-dynamics.service';
import { buildReferenceSeries } from '../training-intelligence/reference-series';

// Tela "Custo por prescricao" do painel (01/11/2026). SO' DESCREVE: agrega o custo real gravado e compara cada geracao com o historico ANTERIOR da propria serie,
// pela mesma matematica da carga interna (medias moveis de 7/21/60/200 e faixa habitual P10-P90, reference-series.ts). Nada aqui decide, bloqueia ou limita IA com base em custo.
// Valores em DOLAR (como a Anthropic cobra); a conversao para real e' feita na tela com a cotacao que o usuario informa.

export const WEEKLY_AGENT = 'treinador_semana';
const MAX_ROWS = 5000;
const SERIES_POINTS_RETURNED = 150;
const TOP_EXPENSIVE = 15;
const TOP_STUDENTS = 10;
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

const num = (value: unknown): number => (value == null ? 0 : Number(value));
const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Dia (AAAA-MM-DD) no horario de Brasilia, sem depender do fuso do servidor. */
export function brtDay(date: Date): string {
  return new Date(date.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

export function brtMonthStart(now: Date): Date {
  const shifted = new Date(now.getTime() - BRT_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) + BRT_OFFSET_MS);
}

export interface CostRow {
  id: string;
  createdAt: Date;
  agent: string;
  model: string;
  effort: string | null;
  costUsd: number;
  inputUsd: number;
  cacheWriteUsd: number;
  cacheReadUsd: number;
  outputUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
  detail: unknown;
  studentCode: number | null;
  studentName: string | null;
  userId: string | null;
}

@Injectable()
export class AiCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mathLayer: MathLayerService,
    private readonly dynamics: LongitudinalDynamicsService,
  ) {}

  async overview(daysInput?: number, now: Date = new Date()) {
    const days = Number.isFinite(daysInput) ? Math.min(Math.max(Math.floor(daysInput as number), 1), 365) : 90;
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const raw = await this.prisma.aiGenerationCost.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS,
      include: { user: { select: { studentCode: true, name: true } } },
    });
    const rows: CostRow[] = raw.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      agent: row.agent,
      model: row.model,
      effort: row.effort,
      costUsd: num(row.costUsd),
      inputUsd: num(row.inputUsd),
      cacheWriteUsd: num(row.cacheWriteUsd),
      cacheReadUsd: num(row.cacheReadUsd),
      outputUsd: num(row.outputUsd),
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      durationMs: row.durationMs,
      detail: row.detail,
      studentCode: row.user?.studentCode ?? null,
      studentName: row.user?.name ?? null,
      userId: row.userId,
    }));
    return this.buildOverview(rows, days, since, now);
  }

  /** Funcao pura (testavel): recebe as linhas ja lidas e devolve o que a tela mostra. */
  buildOverview(rows: CostRow[], days: number, since: Date, now: Date) {
    const monthStart = brtMonthStart(now);
    const monthRows = rows.filter((row) => row.createdAt >= monthStart);
    const sum = (list: CostRow[], pick: (row: CostRow) => number) => round6(list.reduce((total, row) => total + pick(row), 0));

    const agents = [...new Set(rows.map((row) => row.agent))].map((agent) => {
      const list = rows.filter((row) => row.agent === agent);
      const costs = list.map((row) => row.costUsd);
      const mid = median(costs);
      return {
        agent,
        calls: list.length,
        totalUsd: sum(list, (row) => row.costUsd),
        meanUsd: list.length ? round6(sum(list, (row) => row.costUsd) / list.length) : null,
        medianUsd: mid == null ? null : round6(mid),
        parts: {
          inputUsd: sum(list, (row) => row.inputUsd),
          cacheWriteUsd: sum(list, (row) => row.cacheWriteUsd),
          cacheReadUsd: sum(list, (row) => row.cacheReadUsd),
          outputUsd: sum(list, (row) => row.outputUsd),
        },
      };
    }).sort((a, b) => b.totalUsd - a.totalUsd);

    const weekly = rows.filter((row) => row.agent === WEEKLY_AGENT);
    const series: SeriesPoint[] = weekly.map((row) => ({ value: row.costUsd, timestamp: row.createdAt }));
    const reference = buildReferenceSeries(series, { expectedFrequency: 'per_workout' }, this.mathLayer, this.dynamics);
    const seriesPoints = reference.points.slice(-SERIES_POINTS_RETURNED).map((point, index, all) => {
      const row = weekly[weekly.length - all.length + index];
      return {
        timestamp: point.timestamp,
        costUsd: round6(point.value),
        mm7: point.movingAverages.mm7.value == null ? null : round6(point.movingAverages.mm7.value),
        mm21: point.movingAverages.mm21.value == null ? null : round6(point.movingAverages.mm21.value),
        bandLower: point.band.lower == null ? null : round6(point.band.lower),
        bandUpper: point.band.upper == null ? null : round6(point.band.upper),
        bandBasis: point.band.basis,
        signal: point.signal,
        studentCode: row?.studentCode ?? null,
      };
    });

    const byDayMap = new Map<string, { costUsd: number; calls: number }>();
    for (const row of rows) {
      const day = brtDay(row.createdAt);
      const current = byDayMap.get(day) ?? { costUsd: 0, calls: 0 };
      current.costUsd += row.costUsd;
      current.calls += 1;
      byDayMap.set(day, current);
    }
    const byDay = [...byDayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, costUsd: round6(value.costUsd), calls: value.calls }));

    const mostExpensive = [...weekly].sort((a, b) => b.costUsd - a.costUsd).slice(0, TOP_EXPENSIVE).map((row) => {
      const detail = (row.detail ?? {}) as { prompt?: { userFields?: Array<{ field: string; chars: number }> }; saida?: { notVisibleTokensEstimate?: number } };
      const biggest = detail.prompt?.userFields?.[0] ?? null;
      return {
        at: row.createdAt.toISOString(),
        studentCode: row.studentCode,
        studentName: row.studentName,
        effort: row.effort,
        costUsd: round6(row.costUsd),
        inputTokens: row.inputTokens,
        cacheCreationTokens: row.cacheCreationTokens,
        cacheReadTokens: row.cacheReadTokens,
        outputTokens: row.outputTokens,
        durationMs: row.durationMs,
        biggestPromptField: biggest ? { field: biggest.field, chars: biggest.chars } : null,
        notVisibleOutputTokensEstimate: detail.saida?.notVisibleTokensEstimate ?? null,
      };
    });

    const byStudentMap = new Map<string, { studentCode: number | null; studentName: string | null; costUsd: number; calls: number }>();
    for (const row of rows) {
      if (!row.userId) continue;
      const current = byStudentMap.get(row.userId) ?? { studentCode: row.studentCode, studentName: row.studentName, costUsd: 0, calls: 0 };
      current.costUsd += row.costUsd;
      current.calls += 1;
      byStudentMap.set(row.userId, current);
    }
    const byStudent = [...byStudentMap.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, TOP_STUDENTS).map((item) => ({ ...item, costUsd: round6(item.costUsd) }));

    const weeklyCosts = weekly.map((row) => row.costUsd);
    const weeklyMedian = median(weeklyCosts);
    return {
      version: 1,
      generatedAt: now.toISOString(),
      periodDays: days,
      since: since.toISOString(),
      truncated: rows.length >= MAX_ROWS,
      totals: {
        calls: rows.length,
        totalUsd: sum(rows, (row) => row.costUsd),
        monthToDateUsd: sum(monthRows, (row) => row.costUsd),
        monthToDateCalls: monthRows.length,
      },
      weeklyPrescription: {
        agent: WEEKLY_AGENT,
        calls: weekly.length,
        meanUsd: weekly.length ? round6(weeklyCosts.reduce((a, b) => a + b, 0) / weekly.length) : null,
        medianUsd: weeklyMedian == null ? null : round6(weeklyMedian),
        lastUsd: weekly.length ? round6(weekly[weekly.length - 1].costUsd) : null,
      },
      agents,
      series: { unit: reference.unit, windows: reference.windows, bandPolicy: reference.bandPolicy, points: seriesPoints },
      byDay,
      mostExpensive,
      byStudent,
    };
  }
}
