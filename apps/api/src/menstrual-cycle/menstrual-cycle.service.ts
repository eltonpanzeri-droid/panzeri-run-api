import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCycleLogDto } from './dto/create-cycle-log.dto';
import { UpsertMenstrualProfileDto } from './dto/upsert-menstrual-profile.dto';

// Nomes das fases para exibicao e contexto da IA
export const CYCLE_PHASES = ['menstruacao', 'folicular', 'ovulatoria', 'lutea'] as const;
export type CyclePhase = typeof CYCLE_PHASES[number];

export interface PhaseContext {
  phase: CyclePhase;
  dayOfCycle: number;
  isReliable: boolean; // false quando usa anticoncepcional hormonal
}

@Injectable()
export class MenstrualCycleService {
  constructor(private readonly prisma: PrismaService) {}

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
    };
    return this.prisma.menstrualProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  // ── Log de ciclos ─────────────────────────────────────────────────────────

  async createLog(userId: string, dto: CreateCycleLogDto) {
    // Garante que o perfil existe antes de criar o log (relacao obrigatoria)
    await this.prisma.menstrualProfile.upsert({
      where: { userId },
      create: { userId, hasActiveCycle: true },
      update: {},
    });

    // Idempotente: se ja existe um log para essa data, retorna o existente
    const date = new Date(dto.cycleStartDate + 'T12:00:00Z');
    const existing = await this.prisma.menstrualCycleLog.findFirst({
      where: { userId, cycleStartDate: date },
    });
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

  // ── Fase atual estimada ───────────────────────────────────────────────────

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

    // Se passaram mais de cycleLengthDays+5 (folga de atraso), dado muito velho para ser util
    if (dayOfCycle < 0 || dayOfCycle > cycleLength + 5) return null;

    const phase = computePhase(dayOfCycle, periodLength);
    const isReliable = !profile.usesHormonalContraceptive;

    return { phase, dayOfCycle, isReliable };
  }

  // ── Correlacoes (para o painel do treinador) ──────────────────────────────

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

    // Inicializa contadores por fase
    const phaseCounts: Record<CyclePhase, { done: number; missed: number; noInteraction: number }> = {
      menstruacao: { done: 0, missed: 0, noInteraction: 0 },
      folicular:   { done: 0, missed: 0, noInteraction: 0 },
      ovulatoria:  { done: 0, missed: 0, noInteraction: 0 },
      lutea:       { done: 0, missed: 0, noInteraction: 0 },
    };

    // Para cada sessao, determina a fase com base nos logs de ciclo
    const logDates = logs.map((l) => new Date(l.cycleStartDate).setUTCHours(0, 0, 0, 0));

    for (const session of sessions) {
      const sessionDate = new Date(session.scheduledDate);
      sessionDate.setUTCHours(0, 0, 0, 0);
      const sessionTime = sessionDate.getTime();

      // Encontra o ciclo mais recente que comecou antes ou na data da sessao
      let lastCycleStart = -1;
      for (const logDate of logDates) {
        if (logDate <= sessionTime) lastCycleStart = logDate;
        else break;
      }
      if (lastCycleStart === -1) continue; // sessao anterior ao primeiro ciclo registrado

      const dayOfCycle = Math.floor((sessionTime - lastCycleStart) / (1000 * 60 * 60 * 24));
      if (dayOfCycle > cycleLength + 5) continue; // muito longe do ultimo ciclo conhecido

      const phase = computePhase(dayOfCycle, periodLength);
      const status = session.completion?.status;
      if (status === 'done' || status === 'adjusted') phaseCounts[phase].done++;
      else if (status === 'missed') phaseCounts[phase].missed++;
      else phaseCounts[phase].noInteraction++;
    }

    // Calcula aderencia por fase (feitos / (feitos + nao feitos))
    const phaseStats = CYCLE_PHASES.map((phase) => {
      const c = phaseCounts[phase];
      const total = c.done + c.missed;
      const adherence = total > 0 ? Math.round((c.done / total) * 100) : null;
      return { phase, done: c.done, missed: c.missed, noInteraction: c.noInteraction, adherencePercent: adherence };
    });

    // Medias de sintomas por ciclo
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

// Determina a fase do ciclo com base no dia (0 = dia 1 da menstruacao)
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
