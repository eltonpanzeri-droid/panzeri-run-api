import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { runnerStrengthCategory, selectRunnerStrengthExercises } from './runner-strength-library';

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
  modalityDurations?: Record<string, number>;
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

    const sessions = availableDays.slice(0, 7).flatMap((day) => {
      const scheduledDate = addDays(weekStart, weekdayOffsetFromMonday(day.weekday));
      const modalities = day.modalities.length ? day.modalities : ['corrida'];

      return modalities.map((modality) => {
        const template = this.templateForModality(modality, Boolean(latestTest));
        const modalityDurations = 'modalityDurations' in day ? day.modalityDurations : undefined;
        const requestedDuration = modalityDurations?.[modality] ?? day.availableMin ?? template.durationMin;
        const durationMin = Math.min(requestedDuration, template.durationMin);
        const prescription =
          modality === 'forca' || modality === 'fortalecimento_corredores'
            ? this.strengthPrescription(durationMin, modality)
            : this.runPrescription(durationMin, template.zone, latestTest?.paceSecondsPerKm ?? null, modality);
        const isStrength = modality === 'forca' || modality === 'fortalecimento_corredores';

        return {
          userId,
          scheduledDate,
          weekday: day.weekday,
          modality,
          title: template.title,
          sessionType: template.sessionType,
          locationSuggestion: 'Livre',
          durationMin,
          distanceKm: prescription.distanceKm,
          intensityZone: template.zone,
          paceMinSec: !isStrength && latestTest?.paceSecondsPerKm ? this.zonePace(template.zone, latestTest.paceSecondsPerKm) : null,
          structure: prescription,
          notes: template.notes,
          videoRefs: [],
        };
      });
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

  private templateForModality(modality: string, hasTest: boolean): SessionTemplate {
    if (modality === 'fortalecimento_corredores') {
      return {
        title: runnerStrengthCategory,
        modality,
        sessionType: 'strength',
        zone: 'Base',
        durationMin: 45,
        notes: 'Fortalecimento especifico para corredores com videos de execucao cadastrados.',
      };
    }

    if (modality === 'forca') {
      return {
        title: 'Musculacao',
        modality,
        sessionType: 'strength',
        zone: 'Base',
        durationMin: 45,
        notes: 'Treino de musculacao geral. Registrar carga, controle de execucao e pausas.',
      };
    }

    if (modality === 'bike' || modality === 'esteira') {
      return {
        title: modality === 'bike' ? 'Aerobico leve' : 'Corrida na esteira',
        modality,
        sessionType: 'aerobic',
        zone: 'Z2',
        durationMin: 45,
        notes: 'Manter intensidade controlada e respiracao confortavel.',
      };
    }

    return {
      title: 'Corrida leve',
      modality: 'corrida',
      sessionType: 'easy_run',
      zone: 'Z2',
      durationMin: 50,
      notes: hasTest ? 'Manter ritmo confortavel dentro da zona indicada.' : 'Manter conforto respiratorio.',
    };
  }

  private zonePace(zone: string, paceSecondsPerKm: number) {
    const factors: Record<string, number> = {
      Z2: 1.35,
      Z4: 1.05,
      Base: 1.5,
    };

    return formatPace(Math.round(paceSecondsPerKm * (factors[zone] ?? 1.25)));
  }

  private runPrescription(durationMin: number, zone: string, paceSecondsPerKm: number | null, modality: string) {
    const targetPaceSeconds = paceSecondsPerKm ? this.zonePaceSeconds(zone, paceSecondsPerKm) : 420;
    const distanceKm = Number(((durationMin * 60) / targetPaceSeconds).toFixed(1));
    const speedKmh = Number((3600 / targetPaceSeconds).toFixed(1));

    return {
      type: 'run',
      modality,
      distanceKm,
      durationMin,
      speedKmh,
      zone,
      paceRange: paceSecondsPerKm ? this.zonePaceRange(zone, paceSecondsPerKm) : null,
      blocks: [
        { label: 'Aquecimento', durationMin: Math.min(8, durationMin), zone: 'Z1' },
        {
          label: 'Principal',
          durationMin: Math.max(durationMin - 13, 10),
          zone,
          paceRange: paceSecondsPerKm ? this.zonePaceRange(zone, paceSecondsPerKm) : null,
          speedKmh,
        },
        { label: 'Desaquecimento', durationMin: 5, zone: 'Z1' },
      ],
      reportFields: ['distanceKm', 'durationMin', 'pace', 'speedKmh', 'zone', 'heartRate', 'rpe', 'notes'],
    };
  }

  private strengthPrescription(durationMin: number, modality: string) {
    if (modality !== 'fortalecimento_corredores') {
      return this.genericStrengthPrescription(durationMin);
    }

    const selectedExercises = selectRunnerStrengthExercises(durationMin);

    return {
      type: 'strength',
      category: runnerStrengthCategory,
      durationMin,
      distanceKm: null,
      exercises: selectedExercises.map((exercise) => ({
        id: exercise.id,
        category: exercise.category,
        name: exercise.name,
        description: exercise.description,
        videoUrl: exercise.videoUrl,
        sets: exercise.focus.includes('core') ? 3 : 3,
        reps: exercise.focus.includes('core') ? '30 a 45s' : '10 a 12',
        restSeconds: exercise.level === 'advanced' ? 90 : 60,
        cadence: null,
        loadField: false,
      })),
      reportFields: ['exercise', 'sets', 'reps', 'load', 'rpe', 'completed', 'notes', 'videoUrl'],
    };
  }

  private genericStrengthPrescription(durationMin: number) {
    return {
      type: 'strength',
      category: 'Musculacao',
      durationMin,
      distanceKm: null,
      exercises: [
        {
          name: 'Agachamento goblet',
          description: 'Agachamento com carga a frente do corpo.',
          videoUrl: null,
          sets: 3,
          reps: '8 a 10',
          restSeconds: 90,
          cadence: '3s excentrica / 1s concentrica',
          loadField: true,
        },
        {
          name: 'Remada baixa ou curvada',
          description: 'Remada para fortalecimento de costas e postura.',
          videoUrl: null,
          sets: 3,
          reps: '10 a 12',
          restSeconds: 75,
          cadence: '2s concentrica / 2s excentrica',
          loadField: true,
        },
        {
          name: 'Ponte de gluteo',
          description: 'Elevacao de quadril para ativacao de gluteos.',
          videoUrl: null,
          sets: 3,
          reps: '10 a 12',
          restSeconds: 75,
          cadence: '2s concentrica / 2s excentrica',
          loadField: true,
        },
        {
          name: 'Prancha frontal',
          description: 'Isometria para fortalecimento do core.',
          videoUrl: null,
          sets: 3,
          reps: '30 a 45s',
          restSeconds: 60,
          cadence: 'controle total',
          loadField: false,
        },
        {
          name: 'Panturrilha em pe',
          description: 'Elevacao de panturrilha para fortalecimento do tornozelo.',
          videoUrl: null,
          sets: 3,
          reps: '12 a 15',
          restSeconds: 60,
          cadence: '2s concentrica / 2s excentrica',
          loadField: true,
        },
      ],
      reportFields: ['exercise', 'sets', 'reps', 'load', 'rpe', 'completed', 'notes'],
    };
  }

  private zonePaceSeconds(zone: string, paceSecondsPerKm: number) {
    const factors: Record<string, number> = {
      Z1: 1.55,
      Z2: 1.35,
      Z3: 1.18,
      Z4: 1.05,
      Z5: 0.95,
      Base: 1.4,
    };

    return Math.round(paceSecondsPerKm * (factors[zone] ?? 1.25));
  }

  private zonePaceRange(zone: string, paceSecondsPerKm: number) {
    const ranges: Record<string, [number, number]> = {
      Z1: [1.65, 1.5],
      Z2: [1.45, 1.3],
      Z3: [1.28, 1.14],
      Z4: [1.12, 1.02],
      Z5: [1, 0.9],
      Base: [1.55, 1.35],
    };
    const [slow, fast] = ranges[zone] ?? [1.35, 1.2];

    return `${formatPace(Math.round(paceSecondsPerKm * slow))} a ${formatPace(Math.round(paceSecondsPerKm * fast))}`;
  }

  private presentPlan(plan: {
    id: string;
    name: string;
    goal: string;
    startDate: Date;
    endDate: Date | null;
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
      distanceKm: number | null;
      structure: unknown;
      notes: string | null;
    }>;
  }) {
    return {
      id: plan.id,
      name: plan.name,
      goal: plan.goal,
      startDate: plan.startDate,
      endDate: plan.endDate,
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
        durationMin: session.durationMin,
        distanceKm: session.distanceKm,
        structure: session.structure,
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

function weekdayOffsetFromMonday(weekday: number) {
  return weekday === 0 ? 6 : weekday - 1;
}

function formatDate(date: Date) {
  return `${date.getUTCDate().toString().padStart(2, '0')}/${(date.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}

function formatPace(secondsPerKm: number) {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
}
