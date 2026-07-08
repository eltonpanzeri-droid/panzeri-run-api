import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runnerStrengthCategory, selectRunnerStrengthExercises } from './runner-strength-library';
import { selectGymExercises } from './gym-exercise-library';
import { buildWeeklyMethodologyDecision, PANZERI_METHODOLOGY_VERSION, PANZERI_PRESCRIPTION_PRINCIPLES } from './training-methodology';

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
const planEngineVersion = 'rules-v10-' + PANZERI_METHODOLOGY_VERSION;
const subscriptionCheckoutUrl = 'https://mpago.la/23YBr2R';

@Injectable()
export class TrainingPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async current(userId: string) {
    const weekStart = startOfWeek(new Date());
    const [plan, availability, latestTest, user, onboarding] = await Promise.all([
      this.prisma.trainingPlan.findFirst({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'desc' },
        include: {
          sessions: {
            orderBy: { scheduledDate: 'asc' },
            include: { completion: true },
          },
        },
      }),
      this.prisma.weeklyAvailability.findMany({
        where: { userId, noTraining: false },
        orderBy: { weekday: 'asc' },
      }),
      this.prisma.fitnessTest.findFirst({
        where: { userId, testType: '3km' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { subscriptionStatus: true } }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { completedAt: true } }),
    ]);

    if (!onboarding?.completedAt) return onboardingRequiredPlan();
    if (!latestTest) return testRequiredPlan();

    if (
      !plan ||
      plan.generatedBy !== planEngineVersion ||
      plan.startDate.getTime() !== weekStart.getTime() ||
      !planMatchesLatestTest(plan.inputSnapshot, latestTest?.id ?? null) ||
      !planMatchesAvailability(plan.inputSnapshot, availability)
    ) {
      return this.generateWeek(userId);
    }

    return this.presentPlan(plan, hasSubscriptionAccess(user.subscriptionStatus));
  }

  async generateWeek(userId: string, weeklyOverride?: WeeklyAvailabilityInput[]) {
    const historyStart = addDays(startOfWeek(new Date()), -35);
    const [user, latestTest, availability, onboarding, previousPlans, recentStrava, latestExecutionInsight] = await Promise.all([
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
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { completedAt: true, answers: true } }),
      this.prisma.trainingPlan.findMany({
        where: { userId, startDate: { lt: startOfWeek(new Date()) } },
        orderBy: { startDate: 'desc' },
        take: 4,
        include: { sessions: { include: { completion: true } } },
      }),
      this.prisma.stravaActivity.findMany({
        where: { userId, startDate: { gte: historyStart } },
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.trainingExecutionInsight.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { summary: true },
      }),
    ]);

    if (!onboarding?.completedAt) return onboardingRequiredPlan();
    if (!latestTest) return testRequiredPlan();

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

    const methodologyHistory = previousPlans.map((historyPlan) => {
      const runSessions = historyPlan.sessions.filter((session) => isRunningModality(session.modality));
      const completedRuns = runSessions.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted');
      return {
        runMinutes: runSessions.reduce((total, session) => total + (session.durationMin ?? 0), 0),
        completedRunMinutes: completedRuns.reduce((total, session) => total + (session.completion?.durationMin ?? session.durationMin ?? 0), 0),
        longestRunMinutes: Math.max(0, ...completedRuns.map((session) => session.completion?.durationMin ?? session.durationMin ?? 0)),
        prescribedSessions: historyPlan.sessions.length,
        completedSessions: historyPlan.sessions.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted').length,
      };
    });
    const stravaRuns = recentStrava.filter((activity) => isStravaRunningActivity(activity.type, activity.name));
    const executionSummary = jsonObject(latestExecutionInsight?.summary);
    const progression = jsonObject(executionSummary.progression);
    const methodology = buildWeeklyMethodologyDecision({
      goal: user.preferences?.mainGoal ?? 'Evoluir com consistencia',
      experience: user.preferences?.experienceLevel ?? '',
      answers: jsonObject(onboarding.answers),
      availability: availableDays.map((day) => ({
        weekday: day.weekday,
        modalities: day.modalities,
        availableMin: day.availableMin,
        modalityDurations: normalizeModalityDurations('modalityDurations' in day ? day.modalityDurations : undefined),
      })),
      history: methodologyHistory,
      stravaRunMinutes: Math.round(stravaRuns.reduce((total, activity) => total + (activity.movingTimeSec ?? 0), 0) / 60),
      stravaLongestRunMinutes: Math.round(Math.max(0, ...stravaRuns.map((activity) => activity.movingTimeSec ?? 0)) / 60),
      executionInsight: latestExecutionInsight ? {
        adherencePercent: numericValue(executionSummary.adherencePercent),
        executionPercent: numericValue(executionSummary.executionPercent),
        actualKm: numericValue(executionSummary.actualKm),
        actualMinutes: numericValue(executionSummary.actualMinutes),
        distanceChangePercent: nullableNumericValue(progression.distanceChangePercent),
        loadTrend: String(progression.loadTrend ?? 'sem_base_anterior'),
      } : null,
    });

    const sessions = availableDays.slice(0, 7).flatMap((day) => {
      const scheduledDate = addDays(weekStart, weekdayOffsetFromMonday(day.weekday));
      const modalities = day.modalities.length ? day.modalities : ['corrida'];

      return modalities.map((modality) => {
        const baseTemplate = this.templateForModality(modality, Boolean(latestTest));
        const runDecision = isRunningModality(modality) ? methodology.sessions.find((decision) => decision.weekday === day.weekday) : undefined;
        const template = runDecision ? {
          ...baseTemplate,
          title: runDecision.title,
          sessionType: runDecision.sessionType,
          zone: runDecision.zone,
          durationMin: runDecision.durationMin,
          notes: runDecision.notes,
        } : baseTemplate;
        const modalityDurations = normalizeModalityDurations('modalityDurations' in day ? day.modalityDurations : undefined);
        const requestedDuration = modalityDurations?.[modality] ?? day.availableMin ?? template.durationMin;
        const durationMin = Math.min(requestedDuration, runDecision?.durationMin ?? template.durationMin);
        const prescription =
          modality === 'forca' || modality === 'fortalecimento_corredores'
            ? this.strengthPrescription(durationMin, modality, {
                experience: user.preferences?.experienceLevel ?? '',
                safetyAdjustment: methodology.safetyAdjustment,
                rotation: weekRotation(weekStart),
              })
            : modality === 'bike'
            ? this.aerobicPrescription(durationMin, template.zone, modality)
            : this.runPrescription(durationMin, template.zone, latestTest?.paceSecondsPerKm ?? null, modality, template.sessionType);
        const isStrength = modality === 'forca' || modality === 'fortalecimento_corredores';
        const isAerobic = modality === 'bike';

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
          paceMinSec: !isStrength && !isAerobic && latestTest?.paceSecondsPerKm ? this.zonePace(template.zone, latestTest.paceSecondsPerKm) : null,
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
        generatedBy: planEngineVersion,
        aiRecommendation: methodology.recommendation,
        inputSnapshot: toInputJson({
          user: {
            heightCm: user.heightCm,
            weightKg: user.weightKg,
            sleep: user.healthProfile?.averageSleep,
            stress: user.healthProfile?.stressLevel,
          },
          latestTestId: latestTest?.id,
          methodology: {
            version: PANZERI_METHODOLOGY_VERSION,
            principles: PANZERI_PRESCRIPTION_PRINCIPLES,
            rationale: methodology.rationale,
            safetyAdjustment: methodology.safetyAdjustment,
            targetLowIntensityShare: methodology.targetLowIntensityShare,
            history: methodologyHistory,
            stravaRunMinutes: Math.round(stravaRuns.reduce((total, activity) => total + (activity.movingTimeSec ?? 0), 0) / 60),
            analysisAgent: latestExecutionInsight ? executionSummary : null,
          },
          weeklyOverrideUsed: adjustedAvailability.length > 0,
          availabilityDays: availableDays.map((day) => ({
            weekday: day.weekday,
            modalities: day.modalities,
            availableMin: day.availableMin,
            modalityDurations: normalizeModalityDurations('modalityDurations' in day ? day.modalityDurations : undefined),
          })),
        }),
        sessions: {
          create: sessions,
        },
      },
      include: {
        sessions: {
          orderBy: { scheduledDate: 'asc' },
          include: { completion: true },
        },
      },
    });

    return this.presentPlan(plan, hasSubscriptionAccess(user.subscriptionStatus));
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
        title: modality === 'bike' ? 'Bike ou aerobico leve' : 'Corrida na esteira',
        modality,
        sessionType: 'aerobic',
        zone: 'Z2',
        durationMin: 45,
        notes:
          modality === 'bike'
            ? 'Aerobico complementar em intensidade controlada, sem competir com os treinos de corrida.'
            : 'Manter intensidade controlada e respiracao confortavel.',
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

  private runPrescription(durationMin: number, zone: string, paceSecondsPerKm: number | null, modality: string, sessionType: string) {
    const targetPaceSeconds = paceSecondsPerKm ? this.zonePaceSeconds(zone, paceSecondsPerKm) : 420;
    const speedKmh = Number((3600 / targetPaceSeconds).toFixed(1));

    if (sessionType === 'quality_run') {
      const intenseMinutes = Math.max(6, Math.min(12, Math.round(durationMin * 0.2)));
      const warmupMinutes = Math.min(10, Math.max(6, Math.round(durationMin * 0.2)));
      const cooldownMinutes = 5;
      const recoveryMinutes = Math.max(durationMin - intenseMinutes - warmupMinutes - cooldownMinutes, 5);
      const blocks = [
        this.runBlock('Aquecimento', warmupMinutes, 'Z1', paceSecondsPerKm),
        this.runBlock('Estimulos', intenseMinutes, zone, paceSecondsPerKm, 'Tempo intenso total acumulado. Fracionar em repeticoes com recuperacao leve.'),
        this.runBlock('Recuperacoes e volume leve', recoveryMinutes, 'Z2', paceSecondsPerKm),
        this.runBlock('Desaquecimento', cooldownMinutes, 'Z1', paceSecondsPerKm),
      ];
      return {
        type: 'run', modality, distanceKm: this.totalBlockDistance(blocks), durationMin, speedKmh, zone,
        paceRange: paceSecondsPerKm ? this.zonePaceRange(zone, paceSecondsPerKm) : null,
        speedRange: paceSecondsPerKm ? this.zoneSpeedRange(zone, paceSecondsPerKm) : null,
        blocks,
        reportFields: ['distanceKm', 'durationMin', 'pace', 'speedKmh', 'zone', 'heartRate', 'rpe', 'notes'],
      };
    }

    if (sessionType === 'walk_run') {
      const adjustedPace = Math.round(targetPaceSeconds * 1.2);
      const mainMinutes = Math.max(durationMin - 10, 15);
      const blocks = [
        this.runBlock('Aquecimento caminhando', 5, 'Z1', paceSecondsPerKm, 'Caminhar de forma progressiva.', 600),
        this.runBlock('Corrida e caminhada', mainMinutes, 'Z2', paceSecondsPerKm, 'Alternar corrida leve e caminhada antes de perder o controle respiratorio.', adjustedPace),
        this.runBlock('Desaquecimento caminhando', 5, 'Z1', paceSecondsPerKm, undefined, 600),
      ];
      return {
        type: 'run', modality, distanceKm: this.totalBlockDistance(blocks), durationMin,
        speedKmh: Number((3600 / adjustedPace).toFixed(1)), zone: 'Z2',
        paceRange: paceSecondsPerKm ? this.zonePaceRange('Z2', paceSecondsPerKm) : null,
        speedRange: paceSecondsPerKm ? this.zoneSpeedRange('Z2', paceSecondsPerKm) : null,
        blocks,
        reportFields: ['distanceKm', 'durationMin', 'pace', 'speedKmh', 'zone', 'heartRate', 'rpe', 'notes'],
      };
    }

    const blocks = [
      this.runBlock('Aquecimento', Math.min(8, durationMin), 'Z1', paceSecondsPerKm),
      this.runBlock('Principal', Math.max(durationMin - 13, 10), zone, paceSecondsPerKm),
      this.runBlock('Desaquecimento', 5, 'Z1', paceSecondsPerKm),
    ];

    return {
      type: 'run',
      modality,
      distanceKm: this.totalBlockDistance(blocks),
      durationMin,
      speedKmh,
      speedRange: paceSecondsPerKm ? this.zoneSpeedRange(zone, paceSecondsPerKm) : null,
      zone,
      paceRange: paceSecondsPerKm ? this.zonePaceRange(zone, paceSecondsPerKm) : null,
      blocks,
      reportFields: ['distanceKm', 'durationMin', 'pace', 'speedKmh', 'zone', 'heartRate', 'rpe', 'notes'],
    };
  }

  private runBlock(
    label: string,
    durationMin: number,
    zone: string,
    testPaceSecondsPerKm: number | null,
    guidance?: string,
    prescribedPaceSecondsPerKm?: number,
  ) {
    const paceSeconds = prescribedPaceSecondsPerKm
      ?? (testPaceSecondsPerKm ? this.zonePaceSeconds(zone, testPaceSecondsPerKm) : this.defaultZonePaceSeconds(zone));

    return {
      label,
      durationMin,
      durationType: 'time',
      distanceValue: Number(((durationMin * 60) / paceSeconds).toFixed(2)),
      distanceUnit: 'km',
      zone,
      paceRange: testPaceSecondsPerKm ? this.zonePaceRange(zone, testPaceSecondsPerKm) : null,
      speedRange: testPaceSecondsPerKm ? this.zoneSpeedRange(zone, testPaceSecondsPerKm) : null,
      guidance,
    };
  }

  private totalBlockDistance(blocks: Array<{ distanceValue: number }>) {
    return Number(blocks.reduce((total, block) => total + block.distanceValue, 0).toFixed(1));
  }

  private defaultZonePaceSeconds(zone: string) {
    const defaults: Record<string, number> = { Z1: 480, Z2: 420, Z3: 390, Z4: 360, Z5: 330, Base: 450 };
    return defaults[zone] ?? 420;
  }

  private aerobicPrescription(durationMin: number, zone: string, modality: string) {
    const mainDuration = Math.max(durationMin - 10, 15);

    return {
      type: 'aerobic',
      modality,
      distanceKm: null,
      durationMin,
      speedKmh: null,
      zone,
      paceRange: null,
      guidance: `Fazer ${durationMin} min de exercicio aerobico, de preferencia bike ou outro aparelho aerobico, em intensidade ${zone}. Manter esforco controlado para nao atrapalhar os treinos de corrida dos outros dias.`,
      blocks: [
        { label: 'Aquecimento', durationMin: 5, zone: 'Z1', guidance: 'Comecar leve e soltar a musculatura.' },
        {
          label: 'Principal',
          durationMin: mainDuration,
          zone,
          guidance: 'Manter respiracao confortavel, sem transformar em treino forte.',
        },
        { label: 'Desaquecimento', durationMin: 5, zone: 'Z1', guidance: 'Reduzir gradualmente a intensidade.' },
      ],
      reportFields: ['durationMin', 'modality', 'zone', 'heartRate', 'rpe', 'notes'],
    };
  }

  private strengthPrescription(durationMin: number, modality: string, context: { experience: string; safetyAdjustment: boolean; rotation: number }) {
    if (modality !== 'fortalecimento_corredores') {
      return this.genericStrengthPrescription(durationMin, context);
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
        intensity: exercise.level === 'advanced' ? 'Forte' : 'Moderada',
        restSeconds: exercise.level === 'advanced' ? 90 : 60,
        cadence: null,
        loadField: false,
      })),
      reportFields: ['exercise', 'sets', 'reps', 'load', 'rpe', 'completed', 'notes', 'videoUrl'],
    };
  }

  private genericStrengthPrescription(durationMin: number, context: { experience: string; safetyAdjustment: boolean; rotation: number }) {
    const selected = selectGymExercises({ durationMin, ...context });
    const novice = context.safetyAdjustment || ['nunca', 'poucas', 'voltando', 'menos de 1 ano'].some((term) => context.experience.toLowerCase().includes(term));
    return {
      type: 'strength',
      category: 'Musculacao',
      durationMin,
      distanceKm: null,
      exercises: selected.map((exercise) => ({
        id: exercise.id,
        category: 'Musculacao',
        name: exercise.name,
        description: exercise.description,
        videoUrl: null,
        sets: novice ? 2 : exercise.level === 'advanced' ? 4 : 3,
        reps: novice ? '12 a 15' : exercise.level === 'advanced' ? '6 a 10' : '8 a 12',
        intensity: novice ? 'RPE 5 a 6' : exercise.level === 'advanced' ? 'RPE 7 a 8' : 'RPE 7',
        restSeconds: novice ? 60 : exercise.level === 'advanced' ? 90 : 75,
        cadence: exercise.group === 'core' ? 'Execucao lenta e controlada' : '2s na fase excentrica / subida controlada',
        loadField: exercise.group !== 'core' && !exercise.id.startsWith('flexao-'),
      })),
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
    const targetFactors: Record<string, number> = {
      Z1: 1.57,
      Z2: 1.36,
      Z3: 1.21,
      Z4: 1.07,
      Z5: 0.95,
      Base: 1.45,
    };
    const target = Math.round(paceSecondsPerKm * (targetFactors[zone] ?? 1.3));
    const fast = Math.max(target - 12, 1);
    const slow = target + 12;

    return `${formatPace(fast)} a ${formatPace(slow)}`;
  }

  private zoneSpeedRange(zone: string, paceSecondsPerKm: number) {
    const targetFactors: Record<string, number> = {
      Z1: 1.57,
      Z2: 1.36,
      Z3: 1.21,
      Z4: 1.07,
      Z5: 0.95,
      Base: 1.45,
    };
    const target = Math.round(paceSecondsPerKm * (targetFactors[zone] ?? 1.3));
    const fast = Math.max(target - 12, 1);
    const slow = target + 12;
    const minimum = (3600 / slow).toFixed(1);
    const maximum = (3600 / fast).toFixed(1);
    return `${minimum} a ${maximum} km/h`;
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
      completion?: {
        status: string;
        durationMin: number | null;
        distanceKm: number | null;
        avgPaceSecondsKm: number | null;
        perceivedEffort: number | null;
        notes: string | null;
        details: unknown;
      } | null;
    }>;
  }, unlocked = true) {
    if (!unlocked) {
      return {
        id: plan.id,
        name: plan.name,
        goal: plan.goal,
        startDate: plan.startDate,
        endDate: plan.endDate,
        recommendation: null,
        locked: true,
        checkoutUrl: subscriptionCheckoutUrl,
        priceLabel: 'R$ 19,90 por mes',
        sessions: [],
      };
    }
    return {
      id: plan.id,
      name: plan.name,
      goal: plan.goal,
      startDate: plan.startDate,
      endDate: plan.endDate,
      recommendation: plan.aiRecommendation,
      locked: false,
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
        completion: session.completion
          ? {
              status: session.completion.status,
              durationMin: session.completion.durationMin,
              distanceKm: session.completion.distanceKm,
              avgPaceSecondsKm: session.completion.avgPaceSecondsKm,
              perceivedEffort: session.completion.perceivedEffort,
              notes: session.completion.notes,
              details: session.completion.details,
            }
          : null,
      })),
    };
  }
}

function hasSubscriptionAccess(status: string) {
  return status === 'active' || status === 'manual_active' || status === 'grace';
}

function onboardingRequiredPlan() {
  return {
    id: 'onboarding-required',
    name: 'Entrevista inicial',
    goal: '',
    startDate: startOfWeek(new Date()),
    endDate: addDays(startOfWeek(new Date()), 6),
    recommendation: null,
    requiresOnboarding: true,
    requiresTest: false,
    locked: false,
    sessions: [],
  };
}

function testRequiredPlan() {
  return {
    id: 'test-required',
    name: 'Teste inicial',
    goal: '',
    startDate: startOfWeek(new Date()),
    endDate: addDays(startOfWeek(new Date()), 6),
    recommendation: null,
    requiresOnboarding: false,
    requiresTest: true,
    locked: false,
    sessions: [],
  };
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

function isRunningModality(modality: string) {
  return modality === 'corrida' || modality === 'esteira';
}

function isStravaRunningActivity(type: string | null, name: string | null) {
  const value = `${type ?? ''} ${name ?? ''}`.toLowerCase();
  return value.includes('run') || value.includes('corrida');
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toInputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function numericValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumericValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function weekRotation(date: Date) {
  return Math.floor(date.getTime() / (7 * 24 * 60 * 60 * 1000));
}
function normalizeModalityDurations(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).reduce<Record<string, number>>((acc, [key, duration]) => {
    const parsedDuration = Number(duration);
    if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
      acc[key] = parsedDuration;
    }
    return acc;
  }, {});
}

function planMatchesAvailability(inputSnapshot: unknown, availability: Array<{ weekday: number; modalities: string[]; availableMin: number | null; modalityDurations: unknown }>) {
  if (snapshotUsedWeeklyOverride(inputSnapshot)) {
    return true;
  }

  const snapshotAvailability = readSnapshotAvailability(inputSnapshot);
  if (!snapshotAvailability) {
    return false;
  }

  return JSON.stringify(snapshotAvailability) === JSON.stringify(availabilitySignature(availability));
}

function planMatchesLatestTest(inputSnapshot: unknown, latestTestId: string | null) {
  if (!inputSnapshot || typeof inputSnapshot !== 'object') {
    return latestTestId === null;
  }

  const snapshotTestId = (inputSnapshot as { latestTestId?: unknown }).latestTestId;
  return (typeof snapshotTestId === 'string' ? snapshotTestId : null) === latestTestId;
}

function snapshotUsedWeeklyOverride(inputSnapshot: unknown) {
  return Boolean(inputSnapshot && typeof inputSnapshot === 'object' && (inputSnapshot as { weeklyOverrideUsed?: unknown }).weeklyOverrideUsed);
}

function readSnapshotAvailability(inputSnapshot: unknown) {
  if (!inputSnapshot || typeof inputSnapshot !== 'object' || !('availabilityDays' in inputSnapshot)) {
    return null;
  }

  const availabilityDays = (inputSnapshot as { availabilityDays?: unknown }).availabilityDays;
  if (!Array.isArray(availabilityDays)) {
    return null;
  }

  return availabilityDays
    .map((day) => {
      if (!day || typeof day !== 'object') {
        return null;
      }
      const item = day as { weekday?: unknown; modalities?: unknown; availableMin?: unknown; modalityDurations?: unknown };
      return {
        weekday: Number(item.weekday),
        modalities: Array.isArray(item.modalities) ? [...item.modalities].map(String).sort() : [],
        availableMin: Number(item.availableMin ?? 0),
        modalityDurations: normalizeModalityDurations(item.modalityDurations) ?? {},
      };
    })
    .filter((day): day is { weekday: number; modalities: string[]; availableMin: number; modalityDurations: Record<string, number> } => Boolean(day))
    .sort((left, right) => left.weekday - right.weekday);
}

function availabilitySignature(availability: Array<{ weekday: number; modalities: string[]; availableMin: number | null; modalityDurations: unknown }>) {
  return availability
    .map((day) => ({
      weekday: day.weekday,
      modalities: [...day.modalities].sort(),
      availableMin: day.availableMin ?? 0,
      modalityDurations: normalizeModalityDurations(day.modalityDurations) ?? {},
    }))
    .sort((left, right) => left.weekday - right.weekday);
}

function formatDate(date: Date) {
  return `${date.getUTCDate().toString().padStart(2, '0')}/${(date.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}

function formatPace(secondsPerKm: number) {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
}
