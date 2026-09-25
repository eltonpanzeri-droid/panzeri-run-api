import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MathLayerService, SeriesPoint } from '../training-intelligence/math-layer.service';
import { LongitudinalDynamicsService } from '../training-intelligence/longitudinal-dynamics.service';
import { CreateCycleLogDto } from './dto/create-cycle-log.dto';
import { UpsertMenstrualProfileDto } from './dto/upsert-menstrual-profile.dto';
import { StartCycleDto } from './dto/start-cycle.dto';
import { EndCycleDto } from './dto/end-cycle.dto';
import { CorrectCycleDto } from './dto/correct-cycle.dto';
import { UpsertDailyLogDto } from './dto/upsert-daily-log.dto';

// Nomes das fases para exibicao e contexto da IA
export const CYCLE_PHASES = ['menstruacao', 'folicular', 'ovulatoria', 'lutea'] as const;
export type CyclePhase = typeof CYCLE_PHASES[number];

export interface PhaseContext {
  phase: CyclePhase;
  dayOfCycle: number;
  isReliable: boolean; // false quando usa anticoncepcional hormonal
}

// Convencao ja existente no modulo (ver createLog): data armazenada como meio-dia UTC, representando
// so a data-calendario informada pela aluna — evita virada de dia por fuso horario na comparacao.
function toCycleDate(isoDate: string): Date {
  return new Date(isoDate + 'T12:00:00Z');
}
function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function daysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const utcB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((utcB - utcA) / 86400000);
}
function addDaysUTC(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function todayAsCycleDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
}

export interface CycleSummary {
  id: string;
  startDate: string;
  endDate: string | null;
  cycleDurationDays: number | null; // dias ate o inicio do PROXIMO ciclo — null quando ainda nao ha proximo
  periodDurationDays: number | null; // dias de sangramento (so quando o fim foi informado)
  crampsLevel: number | null;
  energyLevel: number | null;
  moodLevel: number | null;
  flowIntensity: string | null;
}

export interface CycleOverview {
  cycles: CycleSummary[];
  currentDayOfCycle: number | null; // dias desde o inicio do ultimo ciclo registrado (0 = hoje comecou)
  isCurrentlyMenstruating: boolean | null;
  cycleLengthStats: { n: number; median: number | null; mad: number | null; habitualLower: number | null; habitualUpper: number | null; isPartialWindow: boolean } | null;
  periodLengthStats: { n: number; median: number | null; mad: number | null; isPartialWindow: boolean } | null;
  predictedNextPeriod: { windowStart: string; windowEnd: string; basedOnCycles: number } | null;
  maturity: 'none' | 'low' | 'moderate' | 'established';
  reliabilityCaveats: string[];
}

@Injectable()
export class MenstrualCycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mathLayer: MathLayerService,
    private readonly longitudinalDynamics: LongitudinalDynamicsService,
  ) {}

  // ── Perfil ────────────────────────────────────────────────────────────────

  async getProfile(userId: string) {
    return this.prisma.menstrualProfile.findUnique({ where: { userId } });
  }

  async upsertProfile(userId: string, dto: UpsertMenstrualProfileDto) {
    const data = {
      hasActiveCycle: dto.hasActiveCycle ?? undefined,
      usesHormonalContraceptive: dto.usesHormonalContraceptive ?? undefined,
      contraceptiveType: dto.contraceptiveType ?? undefined,
      cycleLengthDays: dto.cycleLengthDays ?? undefined,
      periodLengthDays: dto.periodLengthDays ?? undefined,
      cycleRegularity: dto.cycleRegularity ?? undefined,
      diuType: dto.diuType ?? undefined,
      menopauseStatus: dto.menopauseStatus ?? undefined,
    };
    return this.prisma.menstrualProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  // ── Log de ciclos (legado — mantido por compatibilidade com consumidores existentes) ────────

  async createLog(userId: string, dto: CreateCycleLogDto) {
    await this.prisma.menstrualProfile.upsert({
      where: { userId },
      create: { userId, hasActiveCycle: true },
      update: {},
    });
    const date = toCycleDate(dto.cycleStartDate);
    const existing = await this.prisma.menstrualCycleLog.findFirst({ where: { userId, cycleStartDate: date } });
    if (existing) return existing;
    return this.prisma.menstrualCycleLog.create({
      data: {
        userId,
        cycleStartDate: date,
        crampsLevel: dto.crampsLevel ?? null,
        energyLevel: dto.energyLevel ?? null,
        moodLevel: dto.moodLevel ?? null,
      },
    });
  }

  async getLogs(userId: string, limit = 12) {
    return this.prisma.menstrualCycleLog.findMany({
      where: { userId },
      orderBy: { cycleStartDate: 'desc' },
      take: limit,
    });
  }

  // ── Calendario longitudinal (25/09/2026 — evolucao do acompanhamento menstrual) ─────────────
  // Início/fim explícitos, correção retroativa, histórico nunca sobrescrito — cada ciclo é sua
  // própria linha, preservado pra sempre (seção 9 do pedido).

  /** Marca o início de um novo ciclo — idempotente por data, igual ao createLog legado. */
  async startCycle(userId: string, dto: StartCycleDto) {
    await this.prisma.menstrualProfile.upsert({
      where: { userId },
      create: { userId, hasActiveCycle: true },
      update: { hasActiveCycle: true },
    });
    const date = toCycleDate(dto.date);
    const existing = await this.prisma.menstrualCycleLog.findFirst({ where: { userId, cycleStartDate: date } });
    if (existing) return existing;
    return this.prisma.menstrualCycleLog.create({
      data: {
        userId,
        cycleStartDate: date,
        crampsLevel: dto.crampsLevel ?? null,
        energyLevel: dto.energyLevel ?? null,
        moodLevel: dto.moodLevel ?? null,
        flowIntensity: dto.flowIntensity ?? null,
      },
    });
  }

  /** Marca o fim do sangramento de um ciclo já registrado. */
  async endCycle(userId: string, logId: string, dto: EndCycleDto) {
    const log = await this.prisma.menstrualCycleLog.findFirst({ where: { id: logId, userId } });
    if (!log) throw new NotFoundException('Ciclo nao encontrado.');
    return this.prisma.menstrualCycleLog.update({
      where: { id: logId },
      data: { cycleEndDate: toCycleDate(dto.date) },
    });
  }

  /** Correção retroativa de início/fim de um ciclo (seção 31 do pedido) — recalcula tudo pela mesma fonte canônica, nunca reescreve derivado manualmente. */
  async correctCycle(userId: string, logId: string, dto: CorrectCycleDto) {
    const log = await this.prisma.menstrualCycleLog.findFirst({ where: { id: logId, userId } });
    if (!log) throw new NotFoundException('Ciclo nao encontrado.');
    const data: { cycleStartDate?: Date; cycleEndDate?: Date | null } = {};
    if (dto.startDate !== undefined) data.cycleStartDate = toCycleDate(dto.startDate);
    if (dto.endDate !== undefined) data.cycleEndDate = dto.endDate === null ? null : toCycleDate(dto.endDate);
    return this.prisma.menstrualCycleLog.update({ where: { id: logId }, data });
  }

  // ── Registro diário de sintomas (novo, 25/09/2026) ──────────────────────────────────────────

  async upsertDailyLog(userId: string, dto: UpsertDailyLogDto) {
    const date = toCycleDate(dto.date);
    const data = {
      crampsLevel: dto.crampsLevel ?? null,
      energyLevel: dto.energyLevel ?? null,
      moodLevel: dto.moodLevel ?? null,
      flowIntensity: dto.flowIntensity ?? null,
    };
    return this.prisma.menstrualDailyLog.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, ...data },
      update: data,
    });
  }

  async getDailyLogs(userId: string, limit = 120) {
    return this.prisma.menstrualDailyLog.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: limit,
    });
  }

  /**
   * Visão geral do calendário — histórico completo de ciclos + estatísticas derivadas
   * DETERMINISTICAMENTE do histórico real da aluna (nunca 28 dias fixos), reaproveitando
   * MathLayerService/LongitudinalDynamicsService (mesma matemática do resto da Training
   * Intelligence — nenhuma fórmula nova aqui). Ver seções 13, 14 e 16 do pedido.
   */
  async getCycleOverview(userId: string): Promise<CycleOverview> {
    const [profile, logs] = await Promise.all([
      this.getProfile(userId),
      this.prisma.menstrualCycleLog.findMany({ where: { userId }, orderBy: { cycleStartDate: 'asc' } }),
    ]);

    const cycles: CycleSummary[] = logs.map((log, i) => {
      const next = logs[i + 1];
      return {
        id: log.id,
        startDate: toISODate(log.cycleStartDate),
        endDate: log.cycleEndDate ? toISODate(log.cycleEndDate) : null,
        cycleDurationDays: next ? daysBetween(log.cycleStartDate, next.cycleStartDate) : null,
        periodDurationDays: log.cycleEndDate ? daysBetween(log.cycleStartDate, log.cycleEndDate) + 1 : null,
        crampsLevel: log.crampsLevel,
        energyLevel: log.energyLevel,
        moodLevel: log.moodLevel,
        flowIntensity: log.flowIntensity,
      };
    });

    // Série de duração de CADA ciclo (intervalo entre inícios sucessivos) — a fonte canônica de
    // "quanto tempo dura o ciclo desta aluna", nunca um valor declarado isolado.
    const cycleLengthSeries: SeriesPoint[] = [];
    for (let i = 0; i < logs.length - 1; i++) {
      cycleLengthSeries.push({ value: daysBetween(logs[i].cycleStartDate, logs[i + 1].cycleStartDate), timestamp: logs[i + 1].cycleStartDate });
    }
    const periodLengthSeries: SeriesPoint[] = logs
      .filter((l) => l.cycleEndDate != null)
      .map((l) => ({ value: daysBetween(l.cycleStartDate, l.cycleEndDate!) + 1, timestamp: l.cycleStartDate }));

    const cycleLengthDispersion = cycleLengthSeries.length > 0
      ? this.longitudinalDynamics.dispersion(cycleLengthSeries, { kind: 'observation_count', size: cycleLengthSeries.length }, false)
      : null;
    const periodLengthDispersion = periodLengthSeries.length > 0
      ? this.longitudinalDynamics.dispersion(periodLengthSeries, { kind: 'observation_count', size: periodLengthSeries.length }, false)
      : null;
    const cycleHabitualRange = cycleLengthSeries.length >= 2
      ? this.longitudinalDynamics.habitualRange(cycleLengthSeries, { kind: 'observation_count', size: cycleLengthSeries.length })
      : null;

    const lastLog = logs[logs.length - 1] ?? null;
    const today = todayAsCycleDate();
    const currentDayOfCycle = lastLog ? daysBetween(lastLog.cycleStartDate, today) : null;
    const typicalPeriodLength = periodLengthDispersion?.median ?? profile?.periodLengthDays ?? null;

    const isCurrentlyMenstruating = lastLog == null
      ? null
      : lastLog.cycleEndDate != null
        ? false
        : currentDayOfCycle != null && currentDayOfCycle >= 0 && (typicalPeriodLength == null || currentDayOfCycle < typicalPeriodLength + 3);

    let predictedNextPeriod: CycleOverview['predictedNextPeriod'] = null;
    if (lastLog && cycleHabitualRange?.lower != null && cycleHabitualRange?.upper != null) {
      predictedNextPeriod = {
        windowStart: toISODate(addDaysUTC(lastLog.cycleStartDate, Math.round(cycleHabitualRange.lower))),
        windowEnd: toISODate(addDaysUTC(lastLog.cycleStartDate, Math.round(cycleHabitualRange.upper))),
        basedOnCycles: cycleLengthSeries.length,
      };
    }

    const maturity: CycleOverview['maturity'] =
      logs.length === 0 ? 'none' : cycleLengthSeries.length === 0 ? 'low' : cycleLengthSeries.length < 3 ? 'moderate' : 'established';

    const reliabilityCaveats: string[] = [];
    if (profile?.usesHormonalContraceptive) reliabilityCaveats.push('Uso de anticoncepcional hormonal pode alterar o padrão natural do ciclo.');
    if (profile?.menopauseStatus === 'perimenopause') reliabilityCaveats.push('Perimenopausa registrada — ciclos podem variar mais que o habitual.');
    if (profile?.menopauseStatus === 'menopause') reliabilityCaveats.push('Menopausa registrada — previsão de próximo ciclo não se aplica.');
    if (
      profile?.cycleRegularity === 'irregular' ||
      (cycleLengthDispersion?.mad != null && cycleLengthDispersion.median != null && cycleLengthDispersion.median > 0 && cycleLengthDispersion.mad / cycleLengthDispersion.median > 0.2)
    ) {
      reliabilityCaveats.push('Seu histórico apresenta maior variação entre ciclos. Por isso, a janela estimada é mais ampla.');
    }
    if (maturity === 'none' || maturity === 'low') {
      reliabilityCaveats.push('Estimativa ainda limitada pelo histórico disponível.');
    }

    return {
      cycles,
      currentDayOfCycle,
      isCurrentlyMenstruating,
      cycleLengthStats: cycleLengthDispersion
        ? { n: cycleLengthDispersion.n, median: cycleLengthDispersion.median, mad: cycleLengthDispersion.mad, habitualLower: cycleHabitualRange?.lower ?? null, habitualUpper: cycleHabitualRange?.upper ?? null, isPartialWindow: cycleLengthDispersion.isPartialWindow }
        : null,
      periodLengthStats: periodLengthDispersion
        ? { n: periodLengthDispersion.n, median: periodLengthDispersion.median, mad: periodLengthDispersion.mad, isPartialWindow: periodLengthDispersion.isPartialWindow }
        : null,
      predictedNextPeriod,
      maturity,
      reliabilityCaveats,
    };
  }

  // ── Fase atual estimada (legado — inalterado, consumido pelo agente de prescrição) ──────────

  async getEstimatedPhaseContext(userId: string): Promise<PhaseContext | null> {
    const profile = await this.getProfile(userId);
    if (!profile?.hasActiveCycle) return null;

    const lastLog = await this.prisma.menstrualCycleLog.findFirst({
      where: { userId },
      orderBy: { cycleStartDate: 'desc' },
    });
    if (!lastLog) return null;

    const cycleLength = profile.cycleLengthDays ?? 28;
    const periodLength = profile.periodLengthDays ?? 5;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(lastLog.cycleStartDate);
    start.setUTCHours(0, 0, 0, 0);

    const dayOfCycle = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    if (dayOfCycle < 0 || dayOfCycle > cycleLength + 5) return null;

    const phase = computePhase(dayOfCycle, periodLength);
    const isReliable = !profile.usesHormonalContraceptive;

    return { phase, dayOfCycle, isReliable };
  }

  // ── Correlacoes (para o painel do treinador) — inalterado ───────────────────────────────────

  async getCorrelations(userId: string) {
    const [profile, logs, sessions] = await Promise.all([
      this.getProfile(userId),
      this.prisma.menstrualCycleLog.findMany({
        where: { userId },
        orderBy: { cycleStartDate: 'asc' },
      }),
      this.prisma.trainingSession.findMany({
        where: { plan: { userId } },
        select: { scheduledDate: true, completion: { select: { status: true } } },
        orderBy: { scheduledDate: 'asc' },
      }),
    ]);

    if (!profile || !logs.length) return null;

    const cycleLength = profile.cycleLengthDays ?? 28;
    const periodLength = profile.periodLengthDays ?? 5;
    const isReliable = !profile.usesHormonalContraceptive;

    const phaseCounts: Record<CyclePhase, { done: number; missed: number; noInteraction: number }> = {
      menstruacao: { done: 0, missed: 0, noInteraction: 0 },
      folicular:   { done: 0, missed: 0, noInteraction: 0 },
      ovulatoria:  { done: 0, missed: 0, noInteraction: 0 },
      lutea:       { done: 0, missed: 0, noInteraction: 0 },
    };

    const logDates = logs.map((l) => new Date(l.cycleStartDate).setUTCHours(0, 0, 0, 0));

    for (const session of sessions) {
      const sessionDate = new Date(session.scheduledDate);
      sessionDate.setUTCHours(0, 0, 0, 0);
      const sessionTime = sessionDate.getTime();

      let lastCycleStart = -1;
      for (const logDate of logDates) {
        if (logDate <= sessionTime) lastCycleStart = logDate;
        else break;
      }
      if (lastCycleStart === -1) continue;

      const dayOfCycle = Math.floor((sessionTime - lastCycleStart) / (1000 * 60 * 60 * 24));
      if (dayOfCycle > cycleLength + 5) continue;

      const phase = computePhase(dayOfCycle, periodLength);
      const status = session.completion?.status;
      if (status === 'done' || status === 'adjusted') phaseCounts[phase].done++;
      else if (status === 'missed') phaseCounts[phase].missed++;
      else phaseCounts[phase].noInteraction++;
    }

    const phaseStats = CYCLE_PHASES.map((phase) => {
      const c = phaseCounts[phase];
      const total = c.done + c.missed;
      const adherence = total > 0 ? Math.round((c.done / total) * 100) : null;
      return { phase, done: c.done, missed: c.missed, noInteraction: c.noInteraction, adherencePercent: adherence };
    });

    const avgCramps = average(logs.map((l) => l.crampsLevel).filter((v): v is number => v !== null));
    const avgEnergy = average(logs.map((l) => l.energyLevel).filter((v): v is number => v !== null));
    const avgMood   = average(logs.map((l) => l.moodLevel).filter((v): v is number => v !== null));

    return {
      isReliable,
      cycleCount: logs.length,
      phaseStats,
      averageSymptoms: { crampsLevel: avgCramps, energyLevel: avgEnergy, moodLevel: avgMood },
    };
  }
}

function computePhase(dayOfCycle: number, periodLength: number): CyclePhase {
  if (dayOfCycle < periodLength) return 'menstruacao';
  if (dayOfCycle < 13) return 'folicular';
  if (dayOfCycle <= 15) return 'ovulatoria';
  return 'lutea';
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}
