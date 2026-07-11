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
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            startDate: plan.startDate,
            endDate: plan.endDate,
            recommendation: plan.aiRecommendation,
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
        title: reportType === 'technical' ? 'Prestacao tecnica do agente' : 'Relatorio de evolucao do aluno',
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

function buildTechnicalReportContent(detail: any) {
  const summary = detail.plan?.summary ?? emptySummary();
  const tests = detail.tests ?? [];
  const availability = detail.availability ?? [];
  const sessions = detail.plan?.sessions ?? [];
  const runningSessions = sessions.filter((session: any) => isRunningModality(session.modality));
  const strengthSessions = sessions.filter((session: any) => isStrengthLikeModality(session.modality));
  const aerobicSessions = sessions.filter((session: any) => isAerobicCrossTraining(session.modality));
  const runningKm = round(runningSessions.reduce((total: number, session: any) => total + Number(session.distanceKm ?? 0), 0));
  const runningMinutes = runningSessions.reduce((total: number, session: any) => total + Number(session.durationMin ?? 0), 0);
  const strengthMinutes = strengthSessions.reduce((total: number, session: any) => total + Number(session.durationMin ?? 0), 0);
  const aerobicMinutes = aerobicSessions.reduce((total: number, session: any) => total + Number(session.durationMin ?? 0), 0);
  const zoneDistribution = buildZoneDistribution(runningSessions);
  const availableDays = availability.filter((day: any) => !day.noTraining);
  const availableMinutes = availableDays.reduce((total: number, day: any) => total + availabilityMinutes(day), 0);
  const recentExecution = summarizeRecentExecution(sessions, detail.unmatchedStravaActivities ?? []);
  const latestTest = tests[0];
  const easyKm = round((zoneDistribution.Z1?.km ?? 0) + (zoneDistribution.Z2?.km ?? 0));
  const qualityKm = round((zoneDistribution.Z3?.km ?? 0) + (zoneDistribution.Z4?.km ?? 0) + (zoneDistribution.Z5?.km ?? 0));
  const easyShare = runningKm ? Math.round((easyKm / runningKm) * 100) : 0;
  const qualityShare = runningKm ? Math.round((qualityKm / runningKm) * 100) : 0;

  return {
    generatedAt: new Date().toISOString(),
    type: 'technical',
    student: { id: detail.id, name: detail.name, email: detail.email, goal: detail.goal },
    metrics: {
      sessions: summary.prescribedSessions,
      weeklyKm: summary.prescribedKm,
      runningKm,
      strengthSessions: strengthSessions.length,
      easyIntensityShare: `${easyShare}%`,
      qualityIntensityShare: `${qualityShare}%`,
      recentCompletionRate: `${recentExecution.completionRate}%`,
      recentAverageEffort: recentExecution.averageEffort ?? 'Sem PSE',
      latest3km: tests[0]?.pace ?? 'Sem teste',
      availabilityDays: availableDays.length,
      availableMinutes,
    },
    sections: [
      {
        title: 'Base individual usada',
        text: [
          `Objetivo registrado: ${detail.goal ?? 'nao informado'}.`,
          `Teste de 3 km mais recente: ${latestTest ? `${latestTest.pace} por km, VO2 estimado ${latestTest.vo2max}` : 'nao informado; o plano fica conservador ate o aluno cadastrar o teste'}.`,
          `Rotina informada: ${availableDays.length} dia(s) com possibilidade de treino, somando aproximadamente ${availableMinutes || 'tempo nao informado'} min disponiveis na semana.`,
          `Modalidades previstas pela rotina/plano: ${runningSessions.length} corrida(s), ${strengthSessions.length} treino(s) de forca/fortalecimento e ${aerobicSessions.length} aerobico(s) alternativo(s).`,
        ].join(' '),
      },
      {
        title: 'Distribuicao de volume e intensidade',
        text: [
          `Plano atual: ${detail.plan?.name ?? 'sem plano ativo'}. Foram prescritos ${summary.prescribedSessions} treino(s), ${summary.prescribedKm} km totais e ${runningKm} km de corrida.`,
          `A distribuicao estimada da corrida por zona ficou: ${formatZoneDistribution(zoneDistribution, runningKm)}.`,
          `Isso deixa ${easyKm} km em Z1/Z2 (${easyShare}% do volume de corrida) e ${qualityKm} km em Z3/Z4/Z5 (${qualityShare}%).`,
          `A decisao tecnica e usar a maior parte do volume em baixa intensidade para sustentar consistencia e reduzir risco de fadiga, ajustando intensidade apenas quando o teste, a rotina e a execucao recente permitirem.`,
        ].join(' '),
      },
      {
        title: 'Por que este desenho foi escolhido',
        text: [
          runningSessions.length
            ? `A media prescrita por corrida foi de ${round(runningKm / runningSessions.length)} km e ${Math.round(runningMinutes / runningSessions.length)} min.`
            : 'Nao ha corrida prescrita nesta semana.',
          strengthSessions.length
            ? `Foram mantidos ${strengthSessions.length} treino(s) de forca/fortalecimento, somando ${strengthMinutes} min, para dar suporte muscular sem transformar a semana em uma carga apenas cardiovascular.`
            : 'Nao ha treino de forca nesta semana; isso deve ser revisto se o objetivo exigir maior protecao musculoesqueletica.',
          aerobicSessions.length
            ? `Os ${aerobicSessions.length} treino(s) aerobico(s) alternativo(s), somando ${aerobicMinutes} min, devem entrar como manutencao de condicionamento sem competir com a corrida principal.`
            : 'Nao houve aerobico alternativo planejado nesta semana.',
          availableDays.length && runningSessions.length
            ? `Como a rotina oferece ${availableDays.length} dia(s) uteis, o volume precisou ser distribuido em ${runningSessions.length} sessao(oes) de corrida; se a rotina reduzir, o agente deve evitar simplesmente concentrar tudo em poucos dias sem avaliar fadiga.`
            : 'A rotina ainda nao permite uma leitura completa de distribuicao semanal.',
        ].join(' '),
      },
      {
        title: 'Leitura da execucao recente',
        text: [
          `Execucao observada: ${recentExecution.completed}/${recentExecution.eligible} treino(s) elegiveis concluidos (${recentExecution.completionRate}%).`,
          `Volume registrado no app/Strava: ${recentExecution.completedKm} km de ${recentExecution.prescribedKm} km previstos nos treinos ja vencidos.`,
          recentExecution.averageEffort !== null
            ? `PSE media informada: ${recentExecution.averageEffort}/10.`
            : 'PSE ainda insuficiente para interpretar resposta subjetiva.',
          recentExecution.paceFindings.length
            ? `Ritmo observado: ${recentExecution.paceFindings.slice(0, 3).join(' ')}`
            : 'Ainda nao ha pace suficiente para comparar se o aluno esta correndo acima ou abaixo da faixa prescrita.',
          recentExecution.feedbacks.length
            ? `Comentarios recentes do aluno: ${recentExecution.feedbacks.slice(0, 3).join(' | ')}.`
            : 'Ainda nao ha comentarios recentes relevantes.',
          recentExecution.unmatchedCount
            ? `Tambem existem ${recentExecution.unmatchedCount} atividade(s) do Strava sem treino correspondente; isso pode indicar treino extra, troca de modalidade ou falha de pareamento.`
            : 'Nao ha atividades extras do Strava sem correspondencia no periodo analisado.',
        ].join(' '),
      },
      {
        title: 'Decisao de progressao',
        text: buildProgressionDecision(summary, recentExecution, easyShare, qualityShare, runningKm),
      },
      {
        title: 'Pontos objetivos para supervisao',
        text: [
          `Conferir ${summary.differentSessions} treino(s) feito(s) diferente do proposto e ${summary.missedSessions} treino(s) sem registro.`,
          `Validar se a proporcao ${easyShare}% leve / ${qualityShare}% moderada-forte esta coerente com objetivo, teste de 3 km e fadiga relatada.`,
          `Se o aluno seguir acima do ritmo prescrito, o proximo ajuste deve proteger recuperacao antes de aumentar volume.`,
          `Se o aluno cumprir o plano com PSE baixa/moderada e sem dor, o agente pode considerar pequeno aumento de volume ou refinamento de pace na proxima semana.`,
        ].join(' '),
      },
    ],
  };
}

function isRunningModality(modality: string | null | undefined) {
  const value = String(modality ?? '').toLowerCase();
  return value.includes('corrida') || value.includes('esteira');
}

function isStrengthLikeModality(modality: string | null | undefined) {
  const value = String(modality ?? '').toLowerCase();
  return value.includes('musculacao') || value.includes('forca') || value.includes('fortalecimento');
}

function isAerobicCrossTraining(modality: string | null | undefined) {
  const value = String(modality ?? '').toLowerCase();
  return value.includes('bike') || value.includes('aerobico');
}

function availabilityMinutes(day: any) {
  const durations = day?.modalityDurations;
  if (durations && typeof durations === 'object') {
    return Object.values(durations).reduce((total: number, value: any) => total + Number(value ?? 0), 0);
  }
  return Number(day?.availableMin ?? 0);
}

function buildZoneDistribution(sessions: any[]) {
  const distribution: Record<string, { km: number; minutes: number }> = {};
  for (const session of sessions) {
    const blocks = extractRunBlocks(session);
    if (blocks.length) {
      for (const block of blocks) {
        const zone = String(block.zone ?? session.zone ?? 'Sem zona').toUpperCase();
        const distance = Number(block.distanceValue ?? block.distanceKm ?? 0);
        const minutes = Number(block.durationMin ?? 0);
        distribution[zone] = distribution[zone] ?? { km: 0, minutes: 0 };
        distribution[zone].km += Number.isFinite(distance) ? distance : 0;
        distribution[zone].minutes += Number.isFinite(minutes) ? minutes : 0;
      }
      continue;
    }
    const zone = String(session.zone ?? 'Sem zona').toUpperCase();
    distribution[zone] = distribution[zone] ?? { km: 0, minutes: 0 };
    distribution[zone].km += Number(session.distanceKm ?? 0);
    distribution[zone].minutes += Number(session.durationMin ?? 0);
  }
  for (const value of Object.values(distribution)) {
    value.km = round(value.km);
    value.minutes = Math.round(value.minutes);
  }
  return distribution;
}

function extractRunBlocks(session: any) {
  const structure = session?.structure;
  if (!structure || typeof structure !== 'object') return [];
  if (Array.isArray(structure.blocks)) return structure.blocks;
  if (Array.isArray(structure.steps)) return structure.steps;
  if (Array.isArray(structure)) return structure;
  return [];
}

function formatZoneDistribution(distribution: Record<string, { km: number; minutes: number }>, totalKm: number) {
  const zones = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
  const text = zones
    .filter((zone) => distribution[zone]?.km || distribution[zone]?.minutes)
    .map((zone) => {
      const item = distribution[zone];
      const percent = totalKm ? Math.round((item.km / totalKm) * 100) : 0;
      return `${zone}: ${item.km} km (${percent}%)`;
    });
  return text.length ? text.join(', ') : 'sem zonas calculadas';
}

function summarizeRecentExecution(sessions: any[], unmatchedStravaActivities: any[]) {
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);
  const eligibleSessions = sessions.filter((session: any) => new Date(session.date ?? session.scheduledDate) <= today);
  const completed = eligibleSessions.filter((session: any) => session.completionStatus === 'done' || session.completionStatus === 'adjusted');
  const prescribedKm = round(eligibleSessions.reduce((total: number, session: any) => total + Number(session.distanceKm ?? 0), 0));
  const completedKm = round(completed.reduce((total: number, session: any) => total + Number(session.completedDistanceKm ?? session.stravaActivity?.distanceKm ?? 0), 0));
  const efforts = completed.map((session: any) => Number(session.perceivedEffort)).filter((value: number) => Number.isFinite(value) && value > 0);
  const averageEffort = efforts.length ? Math.round((efforts.reduce((total: number, value: number) => total + value, 0) / efforts.length) * 10) / 10 : null;
  const paceFindings = completed
    .map((session: any) => comparePace(session))
    .filter(Boolean) as string[];
  return {
    eligible: eligibleSessions.length,
    completed: completed.length,
    completionRate: eligibleSessions.length ? Math.round((completed.length / eligibleSessions.length) * 100) : 0,
    prescribedKm,
    completedKm,
    averageEffort,
    paceFindings,
    feedbacks: completed.map((session: any) => session.feedback).filter(Boolean),
    unmatchedCount: unmatchedStravaActivities.length,
  };
}

function comparePace(session: any) {
  const completedPace = Number(session.completedPaceSecondsKm ?? session.stravaActivity?.paceSecondsKm);
  if (!Number.isFinite(completedPace) || completedPace <= 0) return null;
  const target = parsePaceRange(session.pace ?? session.structure?.paceRange);
  if (!target) return null;
  const title = session.title ?? 'treino';
  if (completedPace < target.fast - 5) return `${title}: correu acima da faixa (${formatPace(Math.round(completedPace))} vs alvo ${formatPace(target.fast)} a ${formatPace(target.slow)}).`;
  if (completedPace > target.slow + 5) return `${title}: correu abaixo da faixa (${formatPace(Math.round(completedPace))} vs alvo ${formatPace(target.fast)} a ${formatPace(target.slow)}).`;
  return `${title}: pace dentro da faixa prescrita (${formatPace(Math.round(completedPace))}).`;
}

function parsePaceRange(value: string | null | undefined) {
  if (!value) return null;
  const matches = [...String(value).matchAll(/(\d{1,2}):(\d{2})/g)];
  if (!matches.length) return null;
  const seconds = matches.map((match) => Number(match[1]) * 60 + Number(match[2])).sort((a, b) => a - b);
  return {
    fast: seconds[0],
    slow: seconds[seconds.length - 1],
  };
}

function buildProgressionDecision(summary: any, execution: ReturnType<typeof summarizeRecentExecution>, easyShare: number, qualityShare: number, runningKm: number) {
  if (!summary.prescribedSessions) {
    return 'Ainda nao existe plano suficiente para justificar progressao. Primeiro o agente deve consolidar objetivo, teste de 3 km, rotina e semana inicial.';
  }
  if (execution.averageEffort !== null && execution.averageEffort >= 8) {
    return `A PSE media recente esta alta (${execution.averageEffort}/10). Mesmo que o volume semanal seja ${runningKm} km, a decisao tecnica deve ser segurar progressao e preservar recuperacao antes de aumentar distancia ou intensidade.`;
  }
  if (execution.completionRate >= 80 && (execution.averageEffort === null || execution.averageEffort <= 6)) {
    return `O aluno cumpriu ${execution.completionRate}% dos treinos elegiveis com PSE media ${execution.averageEffort ?? 'nao informada'}. Isso sugere possibilidade de progredir com cautela, priorizando pequeno aumento de volume ou precisao de pace, sem elevar simultaneamente volume e intensidade.`;
  }
  if (execution.completionRate < 50) {
    return `A execucao recente esta baixa (${execution.completionRate}%). A prioridade nao deve ser aumentar carga; deve ser simplificar a semana, adequar dias/horarios e reduzir barreiras para o aluno cumprir o minimo consistente.`;
  }
  return `A semana esta em zona intermediaria: ${execution.completionRate}% de execucao, ${easyShare}% do volume em Z1/Z2 e ${qualityShare}% em Z3/Z4/Z5. O agente deve manter progressao conservadora, observando se o aluno consegue transformar o plano prescrito em rotina real.`;
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
        text: done.length ? `PSE media informada: ${avgEffort ?? 'nao informada'}/10. Comentarios recentes: ${done.map((session: any) => session.feedback).filter(Boolean).slice(0, 3).join(' | ') || 'sem comentarios recentes'}.` : 'Ainda nao ha feedback manual suficiente para conclusao.',
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









