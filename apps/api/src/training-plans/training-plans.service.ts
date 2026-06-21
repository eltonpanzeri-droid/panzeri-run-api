import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface SessionTemplate {
  title: string;
  modality: string;
  sessionType: string;
  zone: string;
  durationMin: number;
  notes: string;
}

interface WeeklyAvailabilityInput {
  weekday: number;
  noTraining: boolean;
  modalities: string[];
  availableMin?: number | null;
}

const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

@Injectable()
export class TrainingPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async current(userId: string) {
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: {
        sessions: {
          orderBy: { scheduledDate: 'asc' },
        },
      },
    });

    return plan ? this.presentPlan(plan) : null;
  }

  async generateWeek(userId: string, weeklyOverride?: WeeklyAvailabilityInput[]) {
    const [user, latestTest, availability] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: {
          healthProfile: true,
          preferences: true,
        },
      }),
      this.prisma.fitnessTest.findFirst({
        where: { userId, testType: '3km' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.weeklyAvailability.findMany({
        where: { userId, noTraining: false },
        orderBy: { weekday: 'asc' },
      }),
    ]);

    const weekStart = startOfWeek(new Date());
    const adjustedAvailability = weeklyOverride?.filter((day) => !day.noTraining) ?? [];
    const availableDays =
      adjustedAvailability.length > 0
        ? adjustedAvailability
        : availability.length > 0
        ? availability
        : [
            { weekday: 1, modalities: ['forca'], availableMin: 45 },
            { weekday: 2, modalities: ['corrida'], availableMin: 35 },
            { weekday: 4, modalities: ['corrida'], availableMin: 40 },
            { weekday: 6, modalities: ['corrida'], availableMin: 55 },
          ];

    const templates = this.buildTemplates(Boolean(latestTest));
    const sessions = availableDays.slice(0, 5).map((day, index) => {
      const template = templates[index % templates.length];
      const durationMin = Math.min(day.availableMin ?? template.durationMin, template.durationMin);
      const scheduledDate = addDays(weekStart, day.weekday);

      return {
        userId,
        scheduledDate,
        weekday: day.weekday,
        modality: pickModality(day.modalities, template.modality),
        title: template.title,
        sessionType: template.sessionType,
        locationSuggestion: 'Livre',
        durationMin,
        intensityZone: template.zone,
        paceMinSec: latestTest?.paceSecondsPerKm ? this.zonePace(template.zone, latestTest.paceSecondsPerKm) : null,
        structure: {
          blocks: [
            { label: 'Aquecimento', durationMin: Math.min(8, durationMin) },
            { label: 'Principal', durationMin: Math.max(durationMin - 13, 10), zone: template.zone },
            { label: 'Desaquecimento', durationMin: 5 },
          ],
        },
        notes: template.notes,
        videoRefs: [],
      };
    });

    await this.prisma.trainingPlan.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'archived' },
    });

    const plan = await this.prisma.trainingPlan.create({
      data: {
        userId,
        name: 'Plano semanal',
        goal: user.preferences?.mainGoal ?? 'Evoluir com consistencia',
        startDate: weekStart,
        endDate: addDays(weekStart, 6),
        generatedBy: 'rules-v1',
        aiRecommendation: latestTest
          ? 'Semana montada com base no teste de 3 km mais recente e na disponibilidade informada.'
          : 'Semana conservadora. Cadastre o teste de 3 km para refinar zonas e ritmos.',
        inputSnapshot: {
          user: {
            heightCm: user.heightCm,
            weightKg: user.weightKg,
            sleep: user.healthProfile?.averageSleep,
            stress: user.healthProfile?.stressLevel,
          },
          latestTestId: latestTest?.id,
          weeklyOverrideUsed: adjustedAvailability.length > 0,
          availabilityDays: availableDays.map((day) => ({
            weekday: day.weekday,
            modalities: day.modalities,
            availableMin: day.availableMin,
          })),
        },
        sessions: {
          create: sessions,
        },
      },
      include: {
        sessions: {
          orderBy: { scheduledDate: 'asc' },
        },
      },
    });

    return this.presentPlan(plan);
  }

  private buildTemplates(hasTest: boolean): SessionTemplate[] {
    return [
      {
        title: 'Forca geral',
        modality: 'forca',
        sessionType: 'strength',
        zone: 'Base',
        durationMin: 45,
        notes: 'Priorizar tecnica limpa, controle de carga e pausa completa entre series.',
      },
      {
        title: 'Corrida leve',
        modality: 'corrida',
        sessionType: 'easy_run',
        zone: 'Z2',
        durationMin: 35,
        notes: hasTest ? 'Manter ritmo confortavel dentro da zona indicada.' : 'Manter conforto respiratorio.',
      },
      {
        title: 'Intervalado controlado',
        modality: 'corrida',
        sessionType: 'interval',
        zone: 'Z4',
        durationMin: 42,
        notes: 'Tiros curtos com recuperacao ampla. Parar se houver dor ou tontura.',
      },
      {
        title: 'Longao leve',
        modality: 'corrida',
        sessionType: 'long_run',
        zone: 'Z2',
        durationMin: 60,
        notes: 'Rodagem sem pressa, buscando terminar com sensacao de controle.',
      },
    ];
  }

  private zonePace(zone: string, paceSecondsPerKm: number) {
    const factors: Record<string, number> = {
      Z2: 1.35,
      Z4: 1.05,
      Base: 1.5,
    };

    return formatPace(Math.round(paceSecondsPerKm * (factors[zone] ?? 1.25)));
  }

  private presentPlan(plan: {
    id: string;
    name: string;
    goal: string;
    startDate: Date;
    aiRecommendation: string | null;
    sessions: Array<{
      id: string;
      scheduledDate: Date;
      weekday: number;
      modality: string;
      title: string;
      durationMin: number | null;
      intensityZone: string | null;
      paceMinSec: string | null;
      notes: string | null;
    }>;
  }) {
    return {
      id: plan.id,
      name: plan.name,
      goal: plan.goal,
      startDate: plan.startDate,
      recommendation: plan.aiRecommendation,
      sessions: plan.sessions.map((session) => ({
        id: session.id,
        day: dayNames[session.weekday] ?? 'Dia',
        date: formatDate(session.scheduledDate),
        title: session.title,
        detail: [session.durationMin ? `${session.durationMin} min` : null, session.intensityZone, session.paceMinSec]
          .filter(Boolean)
          .join(' - '),
        modality: session.modality,
        zone: session.intensityZone ?? '',
        notes: session.notes,
      })),
    };
  }
}

function pickModality(modalities: string[], fallback: string) {
  if (modalities.includes(fallback)) {
    return fallback;
  }

  return modalities[0] ?? fallback;
}

function startOfWeek(date: Date) {
  const start = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = start.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + diff);
  return start;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date: Date) {
  return `${date.getUTCDate().toString().padStart(2, '0')}/${(date.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}

function formatPace(secondsPerKm: number) {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
}
