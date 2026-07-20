import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { MergeStudentDto } from './dto/merge-student.dto';
import { ResetStudentPasswordDto } from './dto/reset-student-password.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { UpdateTrainingSessionDto } from './dto/update-training-session.dto';
import { TrainingPlansService } from '../training-plans/training-plans.service';
import { StravaService } from '../strava/strava.service';
import { MessagingService } from '../messaging/messaging.service';
import { SendStudentMessageDto } from './dto/send-student-message.dto';
import { runnerStrengthExercises } from '../training-plans/runner-strength-library';
import { gymExerciseLibrary } from '../training-plans/gym-exercise-library';

@Injectable()
export class CoachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingPlans: TrainingPlansService,
    private readonly strava: StravaService,
    private readonly messaging: MessagingService,
  ) {}

  async createStudent(dto: CreateStudentDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('E-mail ja cadastrado.');
    }

    const temporaryPassword = dto.password ?? randomBytes(18).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    let user;
    try {
      user = await this.prisma.user.create({
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
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('E-mail ja cadastrado.');
      }
      throw error;
    }

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

  async mergeStudent(targetId: string, dto: MergeStudentDto) {
    const target = await this.assertStudent(targetId);
    const sourceEmail = dto.sourceEmail.toLowerCase().trim();
    const source = await this.prisma.user.findUnique({ where: { email: sourceEmail } });

    if (!source || source.role !== 'student') {
      throw new BadRequestException('Nao encontrei nenhum aluno com esse e-mail.');
    }
    if (source.id === targetId) {
      throw new BadRequestException('Informe o e-mail da OUTRA conta duplicada, diferente da conta selecionada.');
    }

    const existingInterview = await this.prisma.onboardingInterview.findUnique({ where: { userId: targetId } });
    if (existingInterview?.completedAt) {
      throw new BadRequestException('Esta conta ja tem uma entrevista concluida. Resolva manualmente antes de mesclar.');
    }

    const [existingHealth, existingPreferences, existingAvailability] = await Promise.all([
      this.prisma.healthProfile.findUnique({ where: { userId: targetId } }),
      this.prisma.userPreferences.findUnique({ where: { userId: targetId } }),
      this.prisma.weeklyAvailability.findMany({ where: { userId: targetId }, select: { id: true } }),
    ]);

    await this.prisma.$transaction([
      ...(existingInterview ? [this.prisma.onboardingInterview.delete({ where: { userId: targetId } })] : []),
      ...(existingHealth ? [this.prisma.healthProfile.delete({ where: { userId: targetId } })] : []),
      ...(existingPreferences ? [this.prisma.userPreferences.delete({ where: { userId: targetId } })] : []),
      ...(existingAvailability.length ? [this.prisma.weeklyAvailability.deleteMany({ where: { userId: targetId } })] : []),
      this.prisma.onboardingInterview.updateMany({ where: { userId: source.id }, data: { userId: targetId } }),
      this.prisma.healthProfile.updateMany({ where: { userId: source.id }, data: { userId: targetId } }),
      this.prisma.userPreferences.updateMany({ where: { userId: source.id }, data: { userId: targetId } }),
      this.prisma.weeklyAvailability.updateMany({ where: { userId: source.id }, data: { userId: targetId } }),
      this.prisma.fitnessTest.updateMany({ where: { userId: source.id }, data: { userId: targetId } }),
      this.prisma.user.update({ where: { id: source.id }, data: { accountStatus: 'archived', refreshTokenHash: null } }),
    ]);

    return {
      message: `Dados de anamnese, saude, preferencias, disponibilidade e testes de ${source.email} foram transferidos para ${target.email}. A conta duplicada foi arquivada.`,
    };
  }

  async regenerateStudentWeek(studentId: string) {
    await this.assertStudent(studentId);
    await this.trainingPlans.generateWeek(studentId);
    return { message: 'Nova semana de treinos gerada.' };
  }

  async regenerateStudentSession(studentId: string, sessionId: string) {
    await this.assertStudent(studentId);
    return this.trainingPlans.regenerateSession(studentId, sessionId);
  }

  exerciseLibrary() {
    return {
      fortalecimentoCorredores: runnerStrengthExercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        description: exercise.description,
        hasVideo: Boolean(exercise.videoUrl),
        videoUrl: exercise.videoUrl,
      })),
      musculacao: gymExerciseLibrary.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        description: exercise.description,
        hasVideo: Boolean(exercise.videoUrl),
        videoUrl: exercise.videoUrl,
      })),
    };
  }

  async sendStudentMessage(studentId: string, dto: SendStudentMessageDto) {
    await this.assertStudent(studentId);
    const results: Record<string, boolean> = {};

    if (dto.channels.includes('email')) {
      const result = await this.messaging.sendEmail(studentId, {
        subject: 'Mensagem do seu treinador - Panzeri Run',
        content: dto.message,
        trigger: 'manual',
      });
      results.email = result.ok;
    }

    return results;
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

  async dashboard(input: { search: string; page: number; pageSize: number; includeArchived?: boolean }) {
    const studentWhere: Prisma.UserWhereInput = {
      role: 'student',
      ...(input.includeArchived ? {} : { accountStatus: { not: 'archived' } }),
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
      this.prisma.user.count({ where: { role: 'student', ...(input.includeArchived ? {} : { accountStatus: { not: 'archived' } }) } }),
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
    const student = await (this.prisma.user as any).findFirstOrThrow({
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
        coachReports: { orderBy: { createdAt: 'desc' }, take: 20 },
        reassessments: {
          where: { completedAt: { not: null } },
          orderBy: { completedAt: 'desc' },
          take: 5,
        },
      },
    });

    const plan = student.plans.find((item: any) => item.status === 'active') ?? student.plans[0] ?? null;
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
      student.plans.reduce((plans: Map<string, any>, historyPlan: any) => {
        const weekKey = historyPlan.startDate.toISOString().slice(0, 10);
        if (!plans.has(weekKey)) plans.set(weekKey, historyPlan);
        return plans;
      }, new Map<string, any>()).values(),
    ) as any[];

    return {
      id: student.id,
      name: student.name,
      email: student.email,
      phone: student.phone,
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
      availability: student.availability.map((day: any) => ({
        weekday: day.weekday,
        noTraining: day.noTraining,
        modalities: day.modalities,
        availableMin: day.availableMin,
        modalityDurations: day.modalityDurations,
      })),
      tests: student.tests.map((test: any) => ({
        date: test.createdAt.toISOString(),
        totalSeconds: test.totalSeconds,
        pace: formatPace(test.paceSecondsPerKm),
        vo2max: test.vo2maxEstimated,
      })),
      reassessments: student.reassessments.map((reassessment: any) => ({
        completedAt: reassessment.completedAt,
        answers: reassessment.answers,
        evolutionSummary: reassessment.evolutionSummary,
        evolutionWins: reassessment.evolutionWins ?? [],
        evolutionConcerns: reassessment.evolutionConcerns ?? [],
      })),
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            startDate: plan.startDate,
            endDate: plan.endDate,
            recommendation: plan.aiRecommendation,
            methodology: readMethodologySnapshot(plan.inputSnapshot),
            summary,
            sessions: plan.sessions.map((session: any) => ({
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
              satisfaction: session.completion?.satisfaction ?? null,
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
      reports: student.coachReports.map((report: any) => ({
        id: report.id,
        reportType: report.reportType,
        title: report.title,
        content: report.content,
        createdAt: report.createdAt,
      })),
      unmatchedStravaActivities: stravaActivities
        .filter((activity) => !usedStravaIds.has(activity.id))
        .map((activity) => serializeStravaActivity(activity)),
      history: uniqueHistory.map((historyPlan: any) => ({
        id: historyPlan.id,
        name: historyPlan.name,
        status: historyPlan.status,
        startDate: historyPlan.startDate,
        endDate: historyPlan.endDate,
        summary: summarizeSessions(historyPlan.sessions),
        sessions: historyPlan.sessions.map((session: any) => ({
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
          satisfaction: session.completion?.satisfaction ?? null,
          feedback: session.completion?.notes ?? null,
        })),
      })),
    };
  }

  async coupons() {
    const prisma = this.prisma as any;
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
      include: { redemptions: { include: { user: { select: { id: true, name: true, email: true, subscriptionStatus: true } } } } },
    });
    return {
      coupons: coupons.map((coupon: any) => ({
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        discountPercent: coupon.discountPercent,
        active: coupon.active,
        usageCount: coupon.usageCount,
        createdAt: coupon.createdAt,
        redemptions: coupon.redemptions.map((redemption: any) => ({
          id: redemption.id,
          createdAt: redemption.createdAt,
          student: redemption.user,
        })),
      })),
    };
  }

  async createCoupon(dto: { code: string; name?: string; discountPercent?: number; active?: boolean }) {
    const code = normalizeCouponCode(dto.code);
    if (!code) throw new BadRequestException('Informe o codigo do cupom.');
    const discountPercent = clampPercent(dto.discountPercent ?? 100);
    const prisma = this.prisma as any;
    return prisma.coupon.create({
      data: {
        code,
        name: dto.name?.trim() || code,
        discountPercent,
        active: dto.active ?? true,
      },
    });
  }

  async updateCoupon(couponId: string, dto: { code?: string; name?: string; discountPercent?: number; active?: boolean }) {
    const data: Record<string, unknown> = {};
    if (dto.code !== undefined) data.code = normalizeCouponCode(dto.code);
    if (dto.name !== undefined) data.name = dto.name.trim() || normalizeCouponCode(dto.code ?? 'Cupom');
    if (dto.discountPercent !== undefined) data.discountPercent = clampPercent(dto.discountPercent);
    if (dto.active !== undefined) data.active = dto.active;
    if (!Object.keys(data).length) throw new BadRequestException('Nenhuma alteracao informada.');
    const prisma = this.prisma as any;
    return prisma.coupon.update({ where: { id: couponId }, data });
  }

  async finance() {
    const [students, subscriptions, coupons] = await Promise.all([
      this.prisma.user.groupBy({ by: ['subscriptionStatus'], where: { role: 'student' }, _count: true }),
      this.prisma.billingSubscription.findMany({ include: { user: { select: { id: true, name: true, email: true, subscriptionStatus: true } } } }),
      (this.prisma as any).coupon.findMany({ include: { redemptions: true } }),
    ]);
    const countByStatus = Object.fromEntries(students.map((item) => [item.subscriptionStatus, item._count]));
    const active = Number(countByStatus.active ?? 0) + Number(countByStatus.manual_active ?? 0) + Number(countByStatus.grace ?? 0);
    const courtesy = Number(countByStatus.manual_active ?? 0);
    const paying = Number(countByStatus.active ?? 0) + Number(countByStatus.grace ?? 0);
    return {
      priceCents: 1990,
      priceLabel: 'R$ 19,90',
      activePlans: active,
      payingPlans: paying,
      courtesyPlans: courtesy,
      pendingPlans: Number(countByStatus.pending ?? 0),
      overduePlans: Number(countByStatus.overdue ?? 0),
      canceledPlans: Number(countByStatus.canceled ?? 0),
      estimatedMonthlyRevenueCents: paying * 1990,
      subscriptions: subscriptions.map((item) => ({
        id: item.id,
        provider: item.provider,
        providerStatus: item.providerStatus,
        nextChargeAt: item.nextChargeAt,
        checkoutUrl: item.checkoutUrl,
        student: item.user,
      })),
      coupons: coupons.map((coupon: any) => ({
        id: coupon.id,
        code: coupon.code,
        discountPercent: coupon.discountPercent,
        active: coupon.active,
        usageCount: coupon.usageCount,
        redemptions: coupon.redemptions.length,
      })),
    };
  }

  async generateStudentReport(studentId: string, reportType: string) {
    if (!['technical', 'evolution'].includes(reportType)) {
      throw new BadRequestException('Tipo de relatorio invalido.');
    }
    const detail = await this.student(studentId);
    const content = reportType === 'technical' ? buildTechnicalReportContent(detail) : buildEvolutionReportContent(detail);
    const prisma = this.prisma as any;
    return prisma.coachReport.create({
      data: {
        userId: studentId,
        reportType,
        title: reportType === 'technical' ? 'Prestacao de contas tecnica do agente' : 'Relatorio de evolucao do aluno',
        content: content as Prisma.InputJsonObject,
      },
    });
  }
  private assertStudent(studentId: string) {
    return this.prisma.user.findFirstOrThrow({
      where: { id: studentId, role: 'student' },
    });
  }
}

function normalizeCouponCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function satisfactionSummary(sessions: any[]) {
  const labels: Record<string, string> = {
    amei: 'Amei',
    gostei: 'Gostei',
    neutro: 'Neutro',
    nao_gostei: 'Nao gostei',
    detestei: 'Detestei',
  };
  const counts = sessions.reduce((acc: Record<string, number>, session: any) => {
    if (session.satisfaction) acc[session.satisfaction] = (acc[session.satisfaction] ?? 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(counts);
  if (!entries.length) return 'sem registro';
  return entries.map(([value, count]) => `${labels[value] ?? value} (${count})`).join(', ');
}

function readMethodologySnapshot(inputSnapshot: unknown) {
  if (!inputSnapshot || typeof inputSnapshot !== 'object' || !('methodology' in inputSnapshot)) return null;
  const methodology = (inputSnapshot as { methodology?: unknown }).methodology;
  if (!methodology || typeof methodology !== 'object') return null;
  const { rationale, safetyAdjustment, targetLowIntensityShare, decisionSource, paceAssessment } = methodology as {
    rationale?: unknown;
    safetyAdjustment?: unknown;
    targetLowIntensityShare?: unknown;
    decisionSource?: unknown;
    paceAssessment?: unknown;
  };
  const paceAssessmentObject = paceAssessment && typeof paceAssessment === 'object'
    ? (paceAssessment as { easyPaceSecondsPerKm?: unknown; intensePaceSecondsPerKm?: unknown; rationale?: unknown })
    : null;
  return {
    rationale: Array.isArray(rationale) ? rationale.filter((item): item is string => typeof item === 'string') : [],
    safetyAdjustment: Boolean(safetyAdjustment),
    targetLowIntensityShare: typeof targetLowIntensityShare === 'number' ? targetLowIntensityShare : null,
    decisionSource: decisionSource === 'ai' ? 'ai' : 'deterministic',
    paceAssessment: paceAssessmentObject
      && typeof paceAssessmentObject.easyPaceSecondsPerKm === 'number'
      && typeof paceAssessmentObject.intensePaceSecondsPerKm === 'number'
      && typeof paceAssessmentObject.rationale === 'string'
      ? {
          easyPaceSecondsPerKm: paceAssessmentObject.easyPaceSecondsPerKm,
          intensePaceSecondsPerKm: paceAssessmentObject.intensePaceSecondsPerKm,
          rationale: paceAssessmentObject.rationale,
        }
      : null,
  };
}

function buildTechnicalReportContent(detail: any) {
  const summary = detail.plan?.summary ?? emptySummary();
  const tests = detail.tests ?? [];
  const availability = detail.availability ?? [];
  const rationale: string[] = detail.plan?.methodology?.rationale ?? [];
  const decisionSource = detail.plan?.methodology?.decisionSource;
  const sourceLabel = decisionSource === 'ai' ? 'Agente de IA (Metodologia Elton Panzeri)' : 'Motor deterministico (regras fixas)';
  const paceAssessment = detail.plan?.methodology?.paceAssessment as { easyPaceSecondsPerKm: number; intensePaceSecondsPerKm: number; rationale: string } | null;
  return {
    generatedAt: new Date().toISOString(),
    type: 'technical',
    student: { id: detail.id, name: detail.name, email: detail.email, goal: detail.goal },
    metrics: {
      sessions: summary.prescribedSessions,
      weeklyKm: summary.prescribedKm,
      latest3km: tests[0]?.pace ?? 'Sem teste',
      availabilityDays: availability.filter((day: any) => !day.noTraining).length,
    },
    sections: [
      {
        title: 'Leitura inicial do aluno',
        text: `Objetivo registrado: ${detail.goal}. Teste recente: ${tests[0]?.pace ?? 'nao informado'}. Disponibilidade util na semana: ${availability.filter((day: any) => !day.noTraining).length} dia(s).`,
      },
      {
        title: 'Plano criado',
        text: `Plano atual: ${detail.plan?.name ?? 'sem plano ativo'}. Foram prescritos ${summary.prescribedSessions} treino(s), com ${summary.prescribedKm} km planejados quando aplicavel.`,
      },
      {
        title: 'Justificativa tecnica',
        text: rationale.length
          ? `Decisao gerada por: ${sourceLabel}. Decisoes desta semana: ${rationale.join(' ')}`
          : 'O plano foi montado cruzando objetivo, teste de 3 km, rotina semanal informada, modalidades disponiveis e sinais de saude/recuperacao. A progressao deve respeitar aderencia, feedback, dor, fadiga e dados externos do Strava quando disponiveis.',
      },
      {
        title: 'Avaliacao do pace real do aluno',
        text: paceAssessment
          ? `Pace facil considerado: ${formatPace(paceAssessment.easyPaceSecondsPerKm)}. Pace intenso considerado: ${formatPace(paceAssessment.intensePaceSecondsPerKm)}. Raciocinio do agente: ${paceAssessment.rationale}`
          : 'Sem avaliacao contextual do agente de IA nesta semana — pace calculado por uma regra generica de reserva (teste oficial, senao auto-relato, senao valor padrao).',
      },
      {
        title: 'Expectativa de resposta',
        text: 'A expectativa e aumentar consistencia, preservar seguranca e ajustar volume/intensidade conforme execucao real. Caso a aderencia caia, o agente deve reduzir complexidade e adequar rotina antes de elevar carga.',
      },
      {
        title: 'Pontos para supervisao do treinador',
        text: `Monitorar treinos diferentes do proposto (${summary.differentSessions}), treinos sem registro (${summary.missedSessions}) e comentarios do aluno. Validar manualmente se houver dor, fadiga alta ou queda consistente de desempenho.`,
      },
    ],
  };
}

function buildEvolutionReportContent(detail: any) {
  const summary = detail.plan?.summary ?? emptySummary();
  const sessions = detail.plan?.sessions ?? [];
  const done = sessions.filter((session: any) => session.completionStatus === 'done' || session.completionStatus === 'adjusted');
  const strava = [
    ...sessions.map((session: any) => session.stravaActivity).filter(Boolean),
    ...(detail.unmatchedStravaActivities ?? []),
  ];
  const avgEffort = done.length
    ? Math.round((done.reduce((total: number, session: any) => total + Number(session.perceivedEffort ?? 0), 0) / done.length) * 10) / 10
    : null;
  const stravaKm = round(strava.reduce((total: number, activity: any) => total + Number(activity.distanceKm ?? 0), 0));
  const stravaMinutes = Math.round(strava.reduce((total: number, activity: any) => total + Number(activity.durationMin ?? 0), 0));
  const latestInsight = detail.analysisAgent?.summary;
  return {
    generatedAt: new Date().toISOString(),
    type: 'evolution',
    student: { id: detail.id, name: detail.name, email: detail.email, goal: detail.goal },
    metrics: {
      adherencePercent: summary.adherencePercent,
      completedSessions: summary.completedSessions,
      prescribedSessions: summary.prescribedSessions,
      prescribedKm: summary.prescribedKm,
      completedKm: summary.completedKm,
      stravaKm,
      stravaMinutes,
      averageEffort: avgEffort,
      trend: latestInsight?.progression?.loadTrend ?? 'sem tendencia calculada',
    },
    sections: [
      {
        title: 'Execucao do plano',
        text: `Aderencia atual: ${summary.adherencePercent}%. Foram concluidos ${summary.completedSessions} de ${summary.prescribedSessions} treino(s), com ${summary.completedKm}/${summary.prescribedKm} km registrados no app.`,
      },
      {
        title: 'Feedback do aluno',
        text: done.length
          ? `PSE media informada: ${avgEffort ?? 'nao informada'}/10. Satisfacao com o treino proposto: ${satisfactionSummary(done)}. Comentarios recentes: ${done.map((session: any) => session.feedback).filter(Boolean).slice(0, 3).join(' | ') || 'sem comentarios recentes'}.`
          : 'Ainda nao ha feedback manual suficiente para conclusao.',
      },
      {
        title: 'Dados do Strava',
        text: strava.length ? `Foram encontrados ${strava.length} atividade(s) no Strava no periodo observado, somando ${stravaKm} km e ${stravaMinutes} min. O agente deve comparar modalidade, distancia, tempo, pace, frequencia cardiaca e cadencia quando disponiveis.` : 'Ainda nao ha atividades Strava suficientes no periodo observado.',
      },
      {
        title: 'Tendencia observada',
        text: latestInsight?.coachAnalysis?.text ?? 'Sem tendencia automatica consolidada. A proxima analise deve priorizar consistencia, resposta cardiovascular e diferenca entre prescrito e realizado.',
      },
      {
        title: 'Proximas decisoes sugeridas',
        text: 'Manter ajuste semanal baseado na rotina real. Se houver boa aderencia e feedback leve/moderado, progredir carga com cautela. Se houver baixa aderencia ou esforco alto, reduzir volume/intensidade e simplificar a semana.',
      },
    ],
  };
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

function statusFromSummary(summary: { prescribedSessions: number; eligibleSessions: number }) {
  // Este status reflete apenas o estagio de acesso ao treino (existe plano? ja teve algum treino
  // elegivel?) — a qualidade da aderencia ja aparece na coluna "Aderencia" e no detalhe do aluno,
  // nao deve ser duplicada aqui como um rotulo de alerta que confunde quem acabou de comecar.
  if (!summary.prescribedSessions) return 'Sem plano';
  if (!summary.eligibleSessions) return 'Aguardando primeiro treino';
  return 'Acesso liberado';
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








