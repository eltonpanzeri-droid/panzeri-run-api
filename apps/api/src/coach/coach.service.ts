import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { ResetStudentPasswordDto } from './dto/reset-student-password.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { UpdateTrainingSessionDto } from './dto/update-training-session.dto';
import { TrainingPlansService } from '../training-plans/training-plans.service';
import { StravaService } from '../strava/strava.service';

@Injectable()
export class CoachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingPlans: TrainingPlansService,
    private readonly strava: StravaService,
  ) {}

  async createStudent(dto: CreateStudentDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('E-mail ja cadastrado.');
    }

    const temporaryPassword = dto.password ?? randomBytes(18).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash,
        role: 'student',
        accountStatus: dto.password ? 'active' : 'paused',
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        accountStatus: true,
        createdAt: true,
      },
    });

    if (!dto.password) {
      const invite = await this.createStudentInvite(user.id);
      return {
        user,
        message: 'Aluno criado. Envie o convite para ele criar a propria senha.',
        ...invite,
      };
    }

    return {
      user,
      message: 'Aluno criado. Envie o e-mail e a senha inicial para ele acessar o app.',
      accessText: buildAccessText(user.email, dto.password),
    };
  }

  async updateStudent(studentId: string, dto: UpdateStudentDto) {
    await this.assertStudent(studentId);
    const data: { name?: string; email?: string; accountStatus?: string; subscriptionStatus?: string; subscriptionUpdatedAt?: Date; refreshTokenHash?: null } = {};

    if (dto.name) {
      data.name = dto.name.trim();
    }

    if (dto.email) {
      const email = dto.email.toLowerCase().trim();
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== studentId) {
        throw new BadRequestException('E-mail ja cadastrado.');
      }
      data.email = email;
    }

    if (dto.accountStatus) {
      data.accountStatus = dto.accountStatus;
      if (dto.accountStatus !== 'active') {
        data.refreshTokenHash = null;
      }
    }

    if (dto.subscriptionStatus) {
      data.subscriptionStatus = dto.subscriptionStatus;
      data.subscriptionUpdatedAt = new Date();
    }

    if (!Object.keys(data).length) {
      throw new BadRequestException('Nenhum dado para atualizar.');
    }

    return this.prisma.user.update({
      where: { id: studentId },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        accountStatus: true,
        subscriptionStatus: true,
        subscriptionUpdatedAt: true,
        updatedAt: true,
      },
    });
  }

  async resetStudentPassword(studentId: string, dto: ResetStudentPasswordDto) {
    await this.assertStudent(studentId);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    await this.prisma.user.update({
      where: { id: studentId },
      data: { passwordHash, refreshTokenHash: null },
    });

    return {
      message: 'Senha do aluno atualizada.',
      accessText: buildAccessText((await this.prisma.user.findUniqueOrThrow({ where: { id: studentId }, select: { email: true } })).email, dto.password),
    };
  }

  async updateTrainingSession(studentId: string, sessionId: string, dto: UpdateTrainingSessionDto) {
    await this.assertStudent(studentId);
    const session = await this.prisma.trainingSession.findFirst({
      where: { id: sessionId, userId: studentId },
      select: { id: true },
    });
    if (!session) {
      throw new BadRequestException('Treino nao encontrado para este aluno.');
    }

    const data = {
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.modality !== undefined ? { modality: dto.modality.trim() } : {}),
      ...(dto.durationMin !== undefined ? { durationMin: dto.durationMin || null } : {}),
      ...(dto.distanceKm !== undefined ? { distanceKm: dto.distanceKm || null } : {}),
      ...(dto.intensityZone !== undefined ? { intensityZone: dto.intensityZone.trim() || null } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
      ...(dto.structure !== undefined ? { structure: dto.structure as Prisma.InputJsonObject } : {}),
    };
    if (!Object.keys(data).length) {
      throw new BadRequestException('Nenhuma alteracao informada.');
    }

    return this.prisma.trainingSession.update({ where: { id: sessionId }, data });
  }

  async createStudentInvite(studentId: string) {
    const user = await this.assertStudent(studentId);
    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
    });

    return {
      inviteLink: `${publicAppUrl()}/reset-password?token=${token}`,
      accessText: `Acesso Panzeri Run\n\nLink para criar senha: ${publicAppUrl()}/reset-password?token=${token}\nE-mail: ${user.email}`,
    };
  }

  async reopenStudentOnboarding(studentId: string) {
    await this.assertStudent(studentId);
    await this.prisma.onboardingInterview.upsert({
      where: { userId: studentId },
      create: { userId: studentId, answers: {}, currentStep: 0 },
      update: { completedAt: null, currentStep: 0 },
    });
    return { message: 'Entrevista liberada para revisao.' };
  }

  async dashboard(input: { search: string; page: number; pageSize: number }) {
    const studentWhere: Prisma.UserWhereInput = {
      role: 'student',
      ...(input.search ? {
        OR: [
          { name: { contains: input.search, mode: 'insensitive' } },
          { email: { contains: input.search, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const weekStart = coachWeekStart(new Date());
    const weekEnd = addDays(weekStart, 6);
    weekEnd.setUTCHours(23, 59, 59, 999);
    const [students, filteredCount, totalStudents, activePlanUsers, prescribedSessions, eligibleSessions, completedSessions, differentSessions] = await Promise.all([
      this.prisma.user.findMany({
      where: studentWhere,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        preferences: true,
        tests: {
          where: { testType: '3km' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        plans: {
          where: { status: 'active' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sessions: { orderBy: { scheduledDate: 'asc' }, include: { completion: true } } },
        },
      },
      }),
      this.prisma.user.count({ where: studentWhere }),
      this.prisma.user.count({ where: { role: 'student' } }),
      this.prisma.trainingPlan.findMany({ where: { status: 'active' }, distinct: ['userId'], select: { userId: true } }),
      this.prisma.trainingSession.count({ where: { scheduledDate: { gte: weekStart, lte: weekEnd }, plan: { status: 'active' } } }),
      this.prisma.trainingSession.count({ where: { scheduledDate: { gte: weekStart, lte: new Date() }, plan: { status: 'active' } } }),
      this.prisma.workoutCompletion.count({ where: { status: { in: ['done', 'adjusted'] }, session: { scheduledDate: { gte: weekStart, lte: new Date() }, plan: { status: 'active' } } } }),
      this.prisma.workoutCompletion.count({ where: { status: 'adjusted', session: { scheduledDate: { gte: weekStart, lte: new Date() }, plan: { status: 'active' } } } }),
    ]);

    const rows = students.map((student) => {
      const plan = student.plans[0] ?? null;
      const summary = plan ? summarizeSessions(plan.sessions) : emptySummary();
      return {
        id: student.id,
        name: student.name,
        email: student.email,
        goal: student.preferences?.mainGoal ?? 'Objetivo nao informado',
        planName: plan?.name ?? 'Sem plano ativo',
        adherencePercent: summary.adherencePercent,
        completedSessions: summary.completedSessions,
        prescribedSessions: summary.prescribedSessions,
        eligibleSessions: summary.eligibleSessions,
        differentSessions: summary.differentSessions,
        missedSessions: summary.missedSessions,
        prescribedKm: summary.prescribedKm,
        completedKm: summary.completedKm,
        lastThreeKm: student.tests[0]?.totalSeconds ? formatDuration(student.tests[0].totalSeconds) : 'Sem teste',
        status: statusFromSummary(summary),
        accountStatus: student.accountStatus,
        subscriptionStatus: student.subscriptionStatus,
      };
    });

    return {
      totals: {
        students: totalStudents,
        activePlans: activePlanUsers.length,
        prescribedSessions,
        eligibleSessions,
        completedSessions,
        differentSessions,
        adherencePercent: eligibleSessions ? Math.round((completedSessions / eligibleSessions) * 100) : 0,
      },
      students: rows,
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        totalItems: filteredCount,
        totalPages: Math.max(Math.ceil(filteredCount / input.pageSize), 1),
      },
    };
  }

  async student(studentId: string) {
    await this.assertStudent(studentId);
    await this.trainingPlans.current(studentId);
    await this.strava.syncIfStale(studentId).catch(() => undefined);
    const student = await this.prisma.user.findFirstOrThrow({
      where: { id: studentId, role: 'student' },
      include: {
        onboardingInterview: true,
        healthProfile: true,
        preferences: true,
        availability: { orderBy: { weekday: 'asc' } },
        tests: {
          where: { testType: '3km' },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
        plans: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: { sessions: { orderBy: { scheduledDate: 'asc' }, include: { completion: true } } },
        },
      },
    });

    const plan = student.plans.find((item) => item.status === 'active') ?? student.plans[0] ?? null;
    const analysisInsight = plan
      ? await this.prisma.trainingExecutionInsight.findUnique({ where: { planId: plan.id } })
      : null;
    const stravaActivities = plan
      ? await this.prisma.stravaActivity.findMany({
          where: {
            userId: studentId,
            startDate: { gte: plan.startDate, lte: plan.endDate ?? addDays(plan.startDate, 6) },
          },
          orderBy: { startDate: 'asc' },
        })
      : [];
    const usedStravaIds = new Set<string>();
    const stravaBySession = new Map<string, (typeof stravaActivities)[number]>();
    for (const session of plan?.sessions ?? []) {
      const activity = stravaActivities.find((candidate) =>
        !usedStravaIds.has(candidate.id) &&
        sameUtcDay(candidate.startDate, session.scheduledDate) &&
        stravaMatchesModality(candidate, session.modality),
      );
      if (activity) {
        usedStravaIds.add(activity.id);
        stravaBySession.set(session.id, activity);
      }
    }
    const summary = plan ? summarizeSessions(plan.sessions) : emptySummary();
    const uniqueHistory = Array.from(
      student.plans.reduce((plans, historyPlan) => {
        const weekKey = historyPlan.startDate.toISOString().slice(0, 10);
        if (!plans.has(weekKey)) plans.set(weekKey, historyPlan);
        return plans;
      }, new Map<string, (typeof student.plans)[number]>()).values(),
    );

    return {
      id: student.id,
      name: student.name,
      email: student.email,
      accountStatus: student.accountStatus,
      subscriptionStatus: student.subscriptionStatus,
      subscriptionUpdatedAt: student.subscriptionUpdatedAt,
      analysisAgent: analysisInsight ? {
        updatedAt: analysisInsight.updatedAt,
        summary: analysisInsight.summary,
      } : null,
      birthDate: student.birthDate,
      heightCm: student.heightCm,
      weightKg: student.weightKg,
      goal: student.preferences?.mainGoal ?? 'Objetivo nao informado',
      interview: student.onboardingInterview ? {
        answers: student.onboardingInterview.answers,
        currentStep: student.onboardingInterview.currentStep,
        completedAt: student.onboardingInterview.completedAt,
        updatedAt: student.onboardingInterview.updatedAt,
      } : null,
      health: {
        sleep: student.healthProfile?.averageSleep ?? 'Nao informado',
        stress: student.healthProfile?.stressLevel ?? 'Nao informado',
        anxiety: student.healthProfile?.anxietyLevel ?? 'Nao informado',
        injuries: student.healthProfile?.previousInjuries ?? 'Nao informado',
        healthProblems: student.healthProfile?.healthProblems ?? 'Nao informado',
        medications: student.healthProfile?.medications ?? 'Nao informado',
      },
      preferences: {
        preferredModalities: student.preferences?.preferredModalities ?? [],
        otherModalities: student.preferences?.otherModalities ?? [],
        trainingLocations: student.preferences?.trainingLocations ?? [],
      },
      availability: student.availability.map((day) => ({
        weekday: day.weekday,
        noTraining: day.noTraining,
        modalities: day.modalities,
        availableMin: day.availableMin,
        modalityDurations: day.modalityDurations,
      })),
      tests: student.tests.map((test) => ({
        date: test.createdAt.toISOString(),
        totalSeconds: test.totalSeconds,
        pace: formatPace(test.paceSecondsPerKm),
        vo2max: test.vo2maxEstimated,
      })),
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            startDate: plan.startDate,
            endDate: plan.endDate,
            recommendation: plan.aiRecommendation,
            summary,
            sessions: plan.sessions.map((session) => ({
              id: session.id,
              date: session.scheduledDate,
              weekday: session.weekday,
              title: session.title,
              modality: session.modality,
              durationMin: session.durationMin,
              distanceKm: session.distanceKm,
              zone: session.intensityZone,
              pace: session.paceMinSec,
              sessionType: session.sessionType,
              structure: session.structure,
              completionStatus: session.completion?.status ?? 'sem_registro',
              perceivedEffort: session.completion?.perceivedEffort ?? null,
              feedback: session.completion?.notes ?? null,
              completedDurationMin: session.completion?.durationMin ?? null,
              completedDistanceKm: session.completion?.distanceKm ?? null,
              completedPaceSecondsKm: session.completion?.avgPaceSecondsKm ?? null,
              completedAt: session.completion?.completedAt ?? null,
              stravaActivity: serializeStravaActivity(stravaBySession.get(session.id) ?? null),
              notes: session.notes,
            })),
          }
        : null,
      unmatchedStravaActivities: stravaActivities
        .filter((activity) => !usedStravaIds.has(activity.id))
        .map((activity) => serializeStravaActivity(activity)),
      history: uniqueHistory.map((historyPlan) => ({
        id: historyPlan.id,
        name: historyPlan.name,
        status: historyPlan.status,
        startDate: historyPlan.startDate,
        endDate: historyPlan.endDate,
        summary: summarizeSessions(historyPlan.sessions),
        sessions: historyPlan.sessions.map((session) => ({
          id: session.id,
          date: session.scheduledDate,
          weekday: session.weekday,
          title: session.title,
          modality: session.modality,
          durationMin: session.durationMin,
          distanceKm: session.distanceKm,
          zone: session.intensityZone,
          structure: session.structure,
          notes: session.notes,
          completionStatus: session.completion?.status ?? 'sem_registro',
          perceivedEffort: session.completion?.perceivedEffort ?? null,
          feedback: session.completion?.notes ?? null,
        })),
      })),
    };
  }

  private assertStudent(studentId: string) {
    return this.prisma.user.findFirstOrThrow({
      where: { id: studentId, role: 'student' },
    });
  }
}

function serializeStravaActivity(activity: {
  id: string;
  stravaId: string;
  name: string | null;
  type: string | null;
  startDate: Date;
  distanceKm: number | null;
  movingTimeSec: number | null;
  avgPaceSecKm: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
} | null) {
  if (!activity) return null;
  return {
    id: activity.id,
    stravaId: activity.stravaId,
    name: activity.name,
    type: activity.type,
    startDate: activity.startDate,
    distanceKm: activity.distanceKm,
    durationMin: activity.movingTimeSec ? Math.round(activity.movingTimeSec / 60) : null,
    paceSecondsKm: activity.avgPaceSecKm,
    averageHeartRate: activity.avgHeartRate,
    maxHeartRate: activity.maxHeartRate,
  };
}

function sameUtcDay(left: Date, right: Date) {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

function stravaMatchesModality(activity: { type: string | null; name: string | null }, modality: string) {
  const value = `${activity.type ?? ''} ${activity.name ?? ''}`.toLowerCase();
  if (modality === 'corrida' || modality === 'esteira') return value.includes('run');
  if (modality === 'bike') return value.includes('ride') || value.includes('bike');
  if (modality === 'forca' || modality === 'fortalecimento_corredores') {
    return ['weight', 'strength', 'workout', 'training', 'treinamento', 'peso', 'musculacao', 'forca']
      .some((term) => value.includes(term));
  }
  return false;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function coachWeekStart(date: Date) {
  const result = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday));
  return result;
}

function buildAccessText(email: string, password: string) {
  return `Acesso Panzeri Run\n\nLink: ${studentAppUrl()}\nE-mail: ${email}\nSenha inicial: ${password}`;
}

function studentAppUrl() {
  return process.env.STUDENT_APP_URL ?? 'https://agenteselton-panzeri-run-app.hbljgk.easypanel.host';
}

function publicAppUrl() {
  return process.env.APP_PUBLIC_URL ?? 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function summarizeSessions(sessions: Array<{ scheduledDate: Date; durationMin: number | null; distanceKm: number | null; completion: { status: string; distanceKm: number | null } | null }>) {
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);
  const prescribedSessions = sessions.length;
  const eligible = sessions.filter((session) => session.scheduledDate <= today);
  const eligibleSessions = eligible.length;
  const completedSessions = eligible.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted').length;
  const missedSessions = eligible.filter((session) => session.completion?.status === 'missed' || !session.completion).length;
  const differentSessions = eligible.filter((session) => session.completion?.status === 'adjusted').length;
  const prescribedKm = round(sessions.reduce((total, session) => total + (session.distanceKm ?? 0), 0));
  const completedKm = round(sessions.reduce((total, session) => total + (session.completion?.distanceKm ?? 0), 0));

  return {
    prescribedSessions,
    eligibleSessions,
    completedSessions,
    missedSessions,
    differentSessions,
    prescribedKm,
    completedKm,
    adherencePercent: eligibleSessions ? Math.round((completedSessions / eligibleSessions) * 100) : 0,
  };
}

function emptySummary() {
  return {
    prescribedSessions: 0,
    eligibleSessions: 0,
    completedSessions: 0,
    missedSessions: 0,
    differentSessions: 0,
    prescribedKm: 0,
    completedKm: 0,
    adherencePercent: 0,
  };
}

function statusFromSummary(summary: { prescribedSessions: number; eligibleSessions: number; adherencePercent: number; differentSessions: number }) {
  if (!summary.prescribedSessions) return 'Sem plano';
  if (!summary.eligibleSessions) return 'Aguardando';
  if (summary.adherencePercent >= 80) return 'Boa execucao';
  if (summary.differentSessions > 0) return 'Fez diferente';
  if (summary.adherencePercent >= 50) return 'Acompanhar';
  return 'Atencao';
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

function formatPace(secondsPerKm: number) {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
}
