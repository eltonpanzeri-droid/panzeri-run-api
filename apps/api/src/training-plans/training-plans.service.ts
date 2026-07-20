import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runnerStrengthCategory, selectRunnerStrengthExercises } from './runner-strength-library';
import { selectGymExercises } from './gym-exercise-library';
import {
  buildWeeklyMethodologyDecision,
  hasSafetyConcern,
  MethodologyInput,
  PANZERI_METHODOLOGY_VERSION,
  PANZERI_PRESCRIPTION_PRINCIPLES,
} from './training-methodology';
import { PrescriptionAgentService, PaceEvidence } from './prescription-agent.service';
import { StravaAnalysisAgentService } from './strava-analysis-agent.service';

interface SessionTemplate {
  title: string;
  modality: string;
  sessionType: string;
  zone: string;
  durationMin: number;
  notes: string;
}

interface RunStep {
  label: string;
  durationMin: number;
  durationMinLower: number;
  durationMinUpper: number;
  durationRange: string;
  durationType: string;
  distanceValue: number;
  distanceUnit: string;
  paceRange?: string | null;
  speedRange?: string | null;
  guidance?: string;
}

interface RunBlock extends Partial<RunStep> {
  label: string;
  zone?: string;
  repeatCount?: number;
  steps?: RunStep[];
}

interface WeeklyAvailabilityInput {
  weekday: number;
  noTraining: boolean;
  modalities: string[];
  availableMin?: number | null;
  modalityDurations?: Record<string, number>;
}

const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
const planEngineVersion = 'rules-v11-' + PANZERI_METHODOLOGY_VERSION;
const MAX_RUN_PACE_SECONDS = 510; // 8:30/km - nenhuma corrida (qualquer zona) pode ser prescrita mais lenta que isso

@Injectable()
export class TrainingPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prescriptionAgent: PrescriptionAgentService,
    private readonly stravaAnalysisAgent: StravaAnalysisAgentService,
  ) {}

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

    if (
      !plan ||
      plan.generatedBy !== planEngineVersion ||
      plan.startDate.getTime() !== weekStart.getTime() ||
      !planMatchesLatestTest(plan.inputSnapshot, latestTest?.id ?? null) ||
      !planMatchesAvailability(plan.inputSnapshot, availability)
    ) {
      return this.generateWeek(userId);
    }

    return this.presentPlan(plan, hasSubscriptionAccess(user.subscriptionStatus), Boolean(latestTest));
  }

  async generateWeek(userId: string, weeklyOverride?: WeeklyAvailabilityInput[]) {
    const historyStart = addDays(startOfWeek(new Date()), -35);
    const [user, latestTest, availability, onboarding, previousPlans, recentStrava, latestExecutionInsight, activePlanBeforeAdjustment] = await Promise.all([
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
      this.prisma.trainingPlan.findFirst({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    ]);

    if (!onboarding?.completedAt) return onboardingRequiredPlan();

    const answers = jsonObject(onboarding.answers);
    const paceFallback = estimatePaceFromAnswers(answers);
    const effectivePaceSecondsPerKm = latestTest?.paceSecondsPerKm ?? paceFallback?.paceSecondsPerKm ?? DEFAULT_PACE_SECONDS_PER_KM;
    const paceSource: 'test' | 'self_report_5k' | 'qualitative' | 'default' = latestTest ? 'test' : paceFallback?.source ?? 'default';

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

    const strengthCountAdjustment = strengthFeedbackAdjustment(previousPlans);

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
    const stravaAnalysis = await this.stravaAnalysisAgent.analyze(recentStrava);
    const methodologyInput: MethodologyInput = {
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
      stravaAnalysis,
    };
    const stravaPacedRuns = stravaRuns.filter((activity) => (activity.avgPaceSecKm ?? 0) > 0 && (activity.distanceKm ?? 0) >= 1);
    const stravaAveragePaceSecondsPerKm = stravaPacedRuns.length
      ? Math.round(stravaPacedRuns.reduce((total, activity) => total + (activity.avgPaceSecKm ?? 0), 0) / stravaPacedRuns.length)
      : null;
    const paceEvidence: PaceEvidence = {
      testPace: latestTest ? { secondsPerKm: latestTest.paceSecondsPerKm, daysAgo: Math.floor((Date.now() - latestTest.createdAt.getTime()) / 86400000) } : null,
      selfReportedPace: paceFallback ? { secondsPerKm: paceFallback.paceSecondsPerKm, source: paceFallback.source } : null,
      stravaAveragePace: stravaAveragePaceSecondsPerKm ? { secondsPerKm: stravaAveragePaceSecondsPerKm, sampleRuns: stravaPacedRuns.length } : null,
    };
    const aiDecision = await this.prescriptionAgent.proposeWeeklyDecision(methodologyInput, paceEvidence);
    const methodology = aiDecision ?? { ...buildWeeklyMethodologyDecision(methodologyInput), source: 'deterministic' as const };
    const resolvedPaces = methodology.paceAssessment
      ? { easy: methodology.paceAssessment.easyPaceSecondsPerKm, intense: methodology.paceAssessment.intensePaceSecondsPerKm }
      : this.fallbackPaces(effectivePaceSecondsPerKm);

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
                rotation: weekRotation(weekStart) * 7 + day.weekday,
                countAdjustment: strengthCountAdjustment,
              })
            : modality === 'bike'
            ? this.aerobicPrescription(durationMin, template.zone, modality)
            : this.runPrescription(durationMin, template.zone, resolvedPaces, modality, template.sessionType);
        const isStrength = modality === 'forca' || modality === 'fortalecimento_corredores';
        const isAerobic = modality === 'bike';

        return {
          userId,
          scheduledDate,
          weekday: day.weekday,
          modality,
          title: isRunningModality(modality) ? 'Treino de corrida' : template.title,
          sessionType: template.sessionType,
          locationSuggestion: 'Livre',
          durationMin,
          distanceKm: prescription.distanceKm,
          intensityZone: template.zone,
          paceMinSec: !isStrength && !isAerobic ? formatPace(template.zone === 'Z4' ? resolvedPaces.intense : resolvedPaces.easy) : null,
          structure: prescription as unknown as Prisma.InputJsonObject,
          notes: template.notes,
          videoRefs: [],
        };
      });
    });

    await this.prisma.trainingPlan.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'archived' },
    });

    const today = todayInSaoPaulo();
    const sessionsToCreate = sessions.filter((session) => session.scheduledDate.getTime() >= today.getTime());
    const plan = await this.prisma.trainingPlan.create({
      data: {
        userId,
        name: 'Plano semanal',
        goal: user.preferences?.mainGoal ?? 'Evoluir com consistencia',
        startDate: weekStart,
        endDate: addDays(weekStart, 6),
        generatedBy: planEngineVersion,
        aiRecommendation: composeRecommendation(paceSource, methodology.recommendation),
        inputSnapshot: toInputJson({
          user: {
            heightCm: user.heightCm,
            weightKg: user.weightKg,
            sleep: user.healthProfile?.averageSleep,
            stress: user.healthProfile?.stressLevel,
          },
          latestTestId: latestTest?.id,
          paceSource,
          resolvedPaces,
          paceEvidence,
          methodology: {
            version: PANZERI_METHODOLOGY_VERSION,
            principles: PANZERI_PRESCRIPTION_PRINCIPLES,
            rationale: methodology.rationale,
            safetyAdjustment: methodology.safetyAdjustment,
            targetLowIntensityShare: methodology.targetLowIntensityShare,
            decisionSource: methodology.source,
            paceAssessment: methodology.paceAssessment ?? null,
            history: methodologyHistory,
            stravaRunMinutes: Math.round(stravaRuns.reduce((total, activity) => total + (activity.movingTimeSec ?? 0), 0) / 60),
            analysisAgent: latestExecutionInsight ? executionSummary : null,
            stravaAnalysis,
            decisionDateTime: saoPauloDateTime(new Date()),
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
          create: sessionsToCreate,
        },
      },
      include: {
        sessions: {
          orderBy: { scheduledDate: 'asc' },
          include: { completion: true },
        },
      },
    });

    if (weeklyOverride?.length && activePlanBeforeAdjustment) {
      await this.prisma.trainingSession.updateMany({
        where: {
          planId: activePlanBeforeAdjustment.id,
          scheduledDate: { gte: weekStart, lt: today },
        },
        data: { planId: plan.id },
      });
      const adjustedPlan = await this.prisma.trainingPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: { sessions: { orderBy: { scheduledDate: 'asc' }, include: { completion: true } } },
      });
      return this.presentPlan(adjustedPlan, hasSubscriptionAccess(user.subscriptionStatus), Boolean(latestTest));
    }

    return this.presentPlan(plan, hasSubscriptionAccess(user.subscriptionStatus), Boolean(latestTest));
  }

  async regenerateSession(userId: string, sessionId: string) {
    const session = await this.prisma.trainingSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) {
      throw new BadRequestException('Treino nao encontrado para este aluno.');
    }

    const [user, latestTest, onboarding] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { preferences: true } }),
      this.prisma.fitnessTest.findFirst({ where: { userId, testType: '3km' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { answers: true } }),
    ]);

    const answers = jsonObject(onboarding?.answers);
    const safetyAdjustment = hasSafetyConcern(answers);
    const paceFallback = estimatePaceFromAnswers(answers);
    const effectivePaceSecondsPerKm = latestTest?.paceSecondsPerKm ?? paceFallback?.paceSecondsPerKm ?? DEFAULT_PACE_SECONDS_PER_KM;
    const resolvedPaces = this.fallbackPaces(effectivePaceSecondsPerKm);

    const isStrength = session.modality === 'forca' || session.modality === 'fortalecimento_corredores';
    const isAerobic = session.modality === 'bike';
    const durationMin = session.durationMin ?? 45;
    const zone = session.intensityZone ?? 'Z2';
    const rotation = weekRotation(session.scheduledDate) * 7 + session.weekday + 1;

    const prescription = isStrength
      ? this.strengthPrescription(durationMin, session.modality, {
          experience: user.preferences?.experienceLevel ?? '',
          safetyAdjustment,
          rotation,
          countAdjustment: 0,
        })
      : isAerobic
        ? this.aerobicPrescription(durationMin, zone, session.modality)
        : this.runPrescription(durationMin, zone, resolvedPaces, session.modality, session.sessionType ?? 'easy_run');

    return this.prisma.trainingSession.update({
      where: { id: sessionId },
      data: {
        distanceKm: prescription.distanceKm,
        paceMinSec: !isStrength && !isAerobic ? formatPace(zone === 'Z4' ? resolvedPaces.intense : resolvedPaces.easy) : null,
        structure: prescription as unknown as Prisma.InputJsonObject,
      },
    });
  }

  private fallbackPaces(effectivePaceSecondsPerKm: number): { easy: number; intense: number } {
    return {
      easy: Math.min(Math.round(effectivePaceSecondsPerKm * 1.15), MAX_RUN_PACE_SECONDS),
      intense: Math.round(effectivePaceSecondsPerKm * 0.95),
    };
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

  private runPrescription(durationMin: number, zone: string, resolvedPaces: { easy: number; intense: number }, modality: string, sessionType: string) {
    const targetPaceSeconds = zone === 'Z4' ? resolvedPaces.intense : resolvedPaces.easy;
    const speedKmh = Number((3600 / targetPaceSeconds).toFixed(1));
    const targetDistanceKm = Math.max(2, Math.round(((durationMin * 60) / targetPaceSeconds) * 2) / 2);
    const { paceRange, speedRange } = this.paceRangeText(targetPaceSeconds);

    if (sessionType === 'quality_run') {
      const warmupDistance = Math.min(1.5, Math.max(0.5, roundDistance(targetDistanceKm * 0.18)));
      const cooldownDistance = 0.5;
      const intenseDistance = Math.max(0.5, roundDistance(targetDistanceKm * 0.22));
      const recoveryDistance = Math.max(0.5, roundDistance(targetDistanceKm - warmupDistance - cooldownDistance - intenseDistance));
      const intenseStepKm = Math.max(0.4, Math.min(1.5, roundDistance(intenseDistance / 4)));
      const recoveryStepKm = 0.4;
      const repeatCount = Math.max(3, Math.min(8, Math.round(intenseDistance / intenseStepKm)));
      const intervalBlock: RunBlock = {
        label: 'Serie intervalada',
        zone,
        repeatCount,
        steps: [
          this.intervalStep('Correr forte', intenseStepKm, resolvedPaces.intense),
          this.intervalStep('Recuperar', recoveryStepKm, 900),
        ],
      };
      const blocks = [
        this.runDistanceBlock('Aquecimento', warmupDistance, 'Z1', resolvedPaces.easy),
        intervalBlock,
        this.runDistanceBlock('Recuperacoes e volume leve', recoveryDistance, 'Z2', resolvedPaces.easy),
        this.runDistanceBlock('Desaquecimento', cooldownDistance, 'Z1', resolvedPaces.easy),
      ];
      return {
        type: 'run', modality, distanceKm: this.totalBlockDistance(blocks), durationMin: this.midpointDuration(blocks), durationRange: this.totalDurationRange(blocks), speedKmh, zone,
        paceRange, speedRange, blocks,
        reportFields: ['distanceKm', 'durationMin', 'pace', 'speedKmh', 'zone', 'heartRate', 'rpe', 'notes'],
      };
    }

    if (sessionType === 'walk_run') {
      const walkPaceSeconds = 660;
      const minimumGapSeconds = 90; // garante que a corrida sempre seja perceptivelmente mais rapida que a caminhada
      const runPaceSeconds = Math.min(resolvedPaces.easy, MAX_RUN_PACE_SECONDS, walkPaceSeconds - minimumGapSeconds);
      const warmupDistance = 0.5;
      const cooldownDistance = 0.5;
      const mainDistance = Math.max(1, roundDistance(targetDistanceKm - warmupDistance - cooldownDistance));
      const walkStepKm = 0.3;
      const runStepKm = 0.2;
      const repeatCount = Math.max(3, Math.min(14, Math.round(mainDistance / (walkStepKm + runStepKm))));
      const intervalBlock: RunBlock = {
        label: 'Bloco intervalado',
        zone: 'Z2',
        repeatCount,
        steps: [
          this.intervalStep('Caminhar', walkStepKm, walkPaceSeconds),
          this.intervalStep('Correr', runStepKm, runPaceSeconds),
        ],
      };
      const blocks = [
        this.runDistanceBlock('Aquecimento caminhando', warmupDistance, 'Z1', 600, 'Caminhar de forma progressiva.'),
        intervalBlock,
        this.runDistanceBlock('Desaquecimento caminhando', cooldownDistance, 'Z1', 600),
      ];
      const walkRunRange = this.paceRangeText(runPaceSeconds);
      return {
        type: 'run', modality, distanceKm: this.totalBlockDistance(blocks), durationMin: this.midpointDuration(blocks), durationRange: this.totalDurationRange(blocks),
        speedKmh: Number((3600 / runPaceSeconds).toFixed(1)), zone: 'Z2',
        paceRange: walkRunRange.paceRange, speedRange: walkRunRange.speedRange, blocks,
        reportFields: ['distanceKm', 'durationMin', 'pace', 'speedKmh', 'zone', 'heartRate', 'rpe', 'notes'],
      };
    }

    const warmupDistance = Math.min(1, Math.max(0.5, roundDistance(targetDistanceKm * 0.15)));
    const cooldownDistance = 0.5;
    const mainDistance = Math.max(1, roundDistance(targetDistanceKm - warmupDistance - cooldownDistance));
    const blocks = [
      this.runDistanceBlock('Aquecimento', warmupDistance, 'Z1', resolvedPaces.easy),
      this.runDistanceBlock('Principal', mainDistance, zone, targetPaceSeconds),
      this.runDistanceBlock('Desaquecimento', cooldownDistance, 'Z1', resolvedPaces.easy),
    ];

    return {
      type: 'run',
      modality,
      distanceKm: this.totalBlockDistance(blocks),
      durationMin: this.midpointDuration(blocks),
      durationRange: this.totalDurationRange(blocks),
      speedKmh,
      speedRange,
      zone,
      paceRange,
      blocks,
      reportFields: ['distanceKm', 'durationMin', 'pace', 'speedKmh', 'zone', 'heartRate', 'rpe', 'notes'],
    };
  }

  private paceRangeText(paceSecondsPerKm: number) {
    const fast = Math.max(paceSecondsPerKm - 12, 1);
    const slow = paceSecondsPerKm + 12;
    return {
      paceRange: `${formatPace(fast)} a ${formatPace(slow)}`,
      speedRange: `${(3600 / slow).toFixed(1)} a ${(3600 / fast).toFixed(1)} km/h`,
    };
  }

  private runDistanceBlock(label: string, distanceKm: number, zone: string, paceSecondsPerKm: number, guidance?: string) {
    const fast = Math.max(paceSecondsPerKm - 12, 1);
    const slow = paceSecondsPerKm + 12;
    const minimumSeconds = Math.round(distanceKm * fast);
    const maximumSeconds = Math.round(distanceKm * slow);

    return {
      label,
      durationMin: Math.round(((minimumSeconds + maximumSeconds) / 2) / 60),
      durationMinLower: minimumSeconds,
      durationMinUpper: maximumSeconds,
      durationRange: formatElapsedRange(minimumSeconds, maximumSeconds),
      durationType: 'distance',
      distanceValue: distanceKm,
      distanceUnit: 'km',
      zone,
      paceRange: `${formatPace(fast)} a ${formatPace(slow)}`,
      speedRange: `${(3600 / slow).toFixed(1)} a ${(3600 / fast).toFixed(1)} km/h`,
      guidance,
    };
  }

  private blockDistance(block: RunBlock): number {
    if (block.repeatCount && block.steps) {
      return block.repeatCount * block.steps.reduce((total, step) => total + step.distanceValue, 0);
    }
    return block.distanceValue ?? 0;
  }

  private blockDurationBounds(block: RunBlock): { lower: number; upper: number } {
    if (block.repeatCount && block.steps) {
      return {
        lower: block.repeatCount * block.steps.reduce((total, step) => total + step.durationMinLower, 0),
        upper: block.repeatCount * block.steps.reduce((total, step) => total + step.durationMinUpper, 0),
      };
    }
    return { lower: block.durationMinLower ?? 0, upper: block.durationMinUpper ?? 0 };
  }

  private totalBlockDistance(blocks: RunBlock[]) {
    return Number(blocks.reduce((total, block) => total + this.blockDistance(block), 0).toFixed(1));
  }

  private totalDurationRange(blocks: RunBlock[]) {
    const lower = blocks.reduce((total, block) => total + this.blockDurationBounds(block).lower, 0);
    const upper = blocks.reduce((total, block) => total + this.blockDurationBounds(block).upper, 0);
    return formatElapsedRange(lower, upper);
  }

  private midpointDuration(blocks: RunBlock[]) {
    const lower = blocks.reduce((total, block) => total + this.blockDurationBounds(block).lower, 0);
    const upper = blocks.reduce((total, block) => total + this.blockDurationBounds(block).upper, 0);
    return Math.round(((lower + upper) / 2) / 60);
  }

  private intervalStep(label: string, distanceKm: number, paceSecondsCenter: number, toleranceSeconds = 20) {
    const fast = Math.max(paceSecondsCenter - toleranceSeconds, 60);
    const slow = paceSecondsCenter + toleranceSeconds;
    const minimumSeconds = Math.round(distanceKm * fast);
    const maximumSeconds = Math.round(distanceKm * slow);
    return {
      label,
      durationMin: Math.round(((minimumSeconds + maximumSeconds) / 2) / 60),
      durationMinLower: minimumSeconds,
      durationMinUpper: maximumSeconds,
      durationRange: formatElapsedRange(minimumSeconds, maximumSeconds),
      durationType: 'distance',
      distanceValue: distanceKm,
      distanceUnit: 'km',
      paceRange: `${formatPace(fast)} a ${formatPace(slow)}`,
      speedRange: `${(3600 / slow).toFixed(2)} a ${(3600 / fast).toFixed(2)} km/h`,
    };
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

  private strengthPrescription(durationMin: number, modality: string, context: { experience: string; safetyAdjustment: boolean; rotation: number; countAdjustment: number }) {
    if (modality !== 'fortalecimento_corredores') {
      return this.genericStrengthPrescription(durationMin, context);
    }

    const selectedExercises = selectRunnerStrengthExercises(durationMin, context.rotation, context.countAdjustment);

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

  private genericStrengthPrescription(durationMin: number, context: { experience: string; safetyAdjustment: boolean; rotation: number; countAdjustment: number }) {
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
  }, unlocked = true, hasTest = true) {
    if (!unlocked) {
      return {
        id: plan.id,
        name: plan.name,
        goal: plan.goal,
        startDate: plan.startDate,
        endDate: plan.endDate,
        recommendation: null,
        locked: true,
        requiresTest: false,
        billingProvider: 'asaas',
        priceLabel: 'R$ 19,90 por mes',
        sessions: [],
      };
    }
    return {
      id: plan.id,
      name: plan.name,
      goal: plan.goal,
      requiresTest: !hasTest,
      startDate: plan.startDate,
      endDate: plan.endDate,
      recommendation: plan.aiRecommendation,
      locked: false,
      sessions: plan.sessions.map((session) => ({
        id: session.id,
        day: dayNames[session.weekday] ?? 'Dia',
        date: formatDate(session.scheduledDate),
        title: session.title,
        detail: [structureDurationLabel(session.structure, session.durationMin), session.intensityZone, session.paceMinSec]
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

export function hasSubscriptionAccess(status: string) {
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

const DEFAULT_PACE_SECONDS_PER_KM = 420;

const QUALITATIVE_PACE_SECONDS: Record<string, number> = {
  muito_leve: 450,
  leve: 420,
  moderado: 390,
  forte: 360,
  muito_forte: 330,
};

function parseMmSsToSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{1,3}):(\d{1,2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
  const total = minutes * 60 + seconds;
  return total > 0 ? total : null;
}

function numericAnswer(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value : null;
  if (typeof value === 'string') {
    const normalized = Number(value.replace(',', '.'));
    if (Number.isFinite(normalized) && normalized > 0) return normalized;
  }
  return null;
}

function estimatePaceFromAnswers(answers: Record<string, unknown>): { paceSecondsPerKm: number; source: 'self_report_5k' | 'qualitative' } | null {
  if (answers.ran_5k_recently === 'yes') {
    const distanceKm = numericAnswer(answers.longest_distance_recent);
    const distanceSeconds = parseMmSsToSeconds(answers.longest_distance_recent_time);
    if (distanceKm && distanceSeconds) {
      const threeKmEquivalentSeconds = distanceSeconds * Math.pow(3 / distanceKm, 1.06);
      return { paceSecondsPerKm: Math.round(threeKmEquivalentSeconds / 3), source: 'self_report_5k' };
    }
  }

  const rating = typeof answers.fitness_self_rating === 'string' ? answers.fitness_self_rating : null;
  if (rating && rating in QUALITATIVE_PACE_SECONDS) {
    return { paceSecondsPerKm: QUALITATIVE_PACE_SECONDS[rating], source: 'qualitative' };
  }

  return null;
}

function composeRecommendation(paceSource: 'test' | 'self_report_5k' | 'qualitative' | 'default', recommendation: string) {
  const note =
    paceSource === 'self_report_5k'
      ? 'Como voce ainda nao fez o teste oficial de 3 km, usamos o tempo de 5 km que voce informou para calcular os ritmos do seu treino. Assim que fizer o teste de 3 km, o treino sera recalculado automaticamente com mais precisao.'
      : paceSource === 'qualitative'
        ? 'Como voce ainda nao fez o teste oficial de 3 km, usamos o nivel de condicionamento que voce informou para estimar os ritmos do seu treino. Assim que fizer o teste de 3 km, o treino sera recalculado automaticamente com mais precisao.'
        : paceSource === 'default'
          ? 'Ainda nao temos seu teste de 3 km nem outra referencia de ritmo, entao usamos um ritmo geral inicial. Faca o teste de 3 km assim que possivel para deixar seu treino muito mais preciso e individualizado.'
          : null;

  return note ? `${note}\n\n${recommendation}` : recommendation;
}

function strengthFeedbackAdjustment(previousPlans: Array<{ sessions: Array<{ modality: string; scheduledDate: Date; completion: { notes: string | null } | null }> }>): number {
  const strengthSessions = previousPlans
    .flatMap((plan) => plan.sessions)
    .filter((session) => (session.modality === 'forca' || session.modality === 'fortalecimento_corredores') && session.completion?.notes)
    .sort((a, b) => b.scheduledDate.getTime() - a.scheduledDate.getTime());

  const latestNote = strengthSessions[0]?.completion?.notes?.toLowerCase() ?? '';
  if (!latestNote) return 0;

  const tooShort = ['muito curto', 'curto demais', 'acabou rapido', 'pouco tempo', 'rapido demais', 'faltou treino'].some((term) => latestNote.includes(term));
  if (tooShort) return 1;

  const tooLong = ['muito longo', 'longo demais', 'muito tempo', 'demorado', 'cansativo demais'].some((term) => latestNote.includes(term));
  if (tooLong) return -1;

  return 0;
}

function pickModality(modalities: string[], fallback: string) {
  if (modalities.includes(fallback)) {
    return fallback;
  }

  return modalities[0] ?? fallback;
}

function startOfWeek(date: Date) {
  const parts = saoPauloDateParts(date);
  const start = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = start.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + diff);
  return start;
}

function todayInSaoPaulo() {
  const parts = saoPauloDateParts(new Date());
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function saoPauloDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function saoPauloDateTime(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium', hour12: false,
  }).format(date);
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

function structureDurationLabel(structure: unknown, durationMin: number | null) {
  const value = jsonObject(structure).durationRange;
  if (typeof value === 'string' && value) return `Tempo ${value}`;
  return durationMin ? `${durationMin} min` : null;
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

function roundDistance(value: number) {
  return Number((Math.round(value * 10) / 10).toFixed(1));
}

function formatElapsedRange(minimumSeconds: number, maximumSeconds: number) {
  return `${formatElapsed(minimumSeconds)} a ${formatElapsed(maximumSeconds)}`;
}

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
