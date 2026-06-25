import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { ResetStudentPasswordDto } from './dto/reset-student-password.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

@Injectable()
export class CoachService {
  constructor(private readonly prisma: PrismaService) {}

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
    const data: { name?: string; email?: string; accountStatus?: string } = {};

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
        updatedAt: true,
      },
    });
  }

  async resetStudentPassword(studentId: string, dto: ResetStudentPasswordDto) {
    const passwordHash = await bcrypt.hash(dto.password, 12);
    await this.prisma.user.update({
      where: { id: studentId },
      data: { passwordHash },
    });

    return {
      message: 'Senha do aluno atualizada.',
      accessText: buildAccessText((await this.prisma.user.findUniqueOrThrow({ where: { id: studentId }, select: { email: true } })).email, dto.password),
    };
  }

  async createStudentInvite(studentId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: studentId } });
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

  async dashboard() {
    const students = await this.prisma.user.findMany({
      where: { role: 'student' },
      orderBy: { createdAt: 'desc' },
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
    });

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
        differentSessions: summary.differentSessions,
        missedSessions: summary.missedSessions,
        prescribedKm: summary.prescribedKm,
        completedKm: summary.completedKm,
        lastThreeKm: student.tests[0]?.totalSeconds ? formatDuration(student.tests[0].totalSeconds) : 'Sem teste',
        status: statusFromSummary(summary),
        accountStatus: student.accountStatus,
      };
    });

    const totals = rows.reduce(
      (acc, student) => ({
        students: acc.students + 1,
        activePlans: acc.activePlans + (student.planName === 'Sem plano ativo' ? 0 : 1),
        prescribedSessions: acc.prescribedSessions + student.prescribedSessions,
        completedSessions: acc.completedSessions + student.completedSessions,
        differentSessions: acc.differentSessions + student.differentSessions,
      }),
      { students: 0, activePlans: 0, prescribedSessions: 0, completedSessions: 0, differentSessions: 0 },
    );

    return {
      totals: {
        ...totals,
        adherencePercent: totals.prescribedSessions ? Math.round((totals.completedSessions / totals.prescribedSessions) * 100) : 0,
      },
      students: rows,
    };
  }

  async student(studentId: string) {
    const student = await this.prisma.user.findUniqueOrThrow({
      where: { id: studentId },
      include: {
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

    const plan = student.plans[0] ?? null;
    const summary = plan ? summarizeSessions(plan.sessions) : emptySummary();

    return {
      id: student.id,
      name: student.name,
      email: student.email,
      accountStatus: student.accountStatus,
      goal: student.preferences?.mainGoal ?? 'Objetivo nao informado',
      health: {
        sleep: student.healthProfile?.averageSleep ?? 'Nao informado',
        stress: student.healthProfile?.stressLevel ?? 'Nao informado',
        injuries: student.healthProfile?.previousInjuries ?? 'Nao informado',
      },
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
              completionStatus: session.completion?.status ?? 'sem_registro',
              perceivedEffort: session.completion?.perceivedEffort ?? null,
            })),
          }
        : null,
      history: student.plans.map((historyPlan) => ({
        id: historyPlan.id,
        name: historyPlan.name,
        status: historyPlan.status,
        startDate: historyPlan.startDate,
        endDate: historyPlan.endDate,
        summary: summarizeSessions(historyPlan.sessions),
      })),
    };
  }
}

function buildAccessText(email: string, password: string) {
  return `Acesso Panzeri Run\n\nLink: ${publicAppUrl()}\nE-mail: ${email}\nSenha inicial: ${password}`;
}

function publicAppUrl() {
  return process.env.APP_PUBLIC_URL ?? 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function summarizeSessions(sessions: Array<{ durationMin: number | null; distanceKm: number | null; completion: { status: string; distanceKm: number | null } | null }>) {
  const prescribedSessions = sessions.length;
  const completedSessions = sessions.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted').length;
  const missedSessions = sessions.filter((session) => session.completion?.status === 'missed' || !session.completion).length;
  const differentSessions = sessions.filter((session) => session.completion?.status === 'adjusted').length;
  const prescribedKm = round(sessions.reduce((total, session) => total + (session.distanceKm ?? 0), 0));
  const completedKm = round(sessions.reduce((total, session) => total + (session.completion?.distanceKm ?? 0), 0));

  return {
    prescribedSessions,
    completedSessions,
    missedSessions,
    differentSessions,
    prescribedKm,
    completedKm,
    adherencePercent: prescribedSessions ? Math.round((completedSessions / prescribedSessions) * 100) : 0,
  };
}

function emptySummary() {
  return {
    prescribedSessions: 0,
    completedSessions: 0,
    missedSessions: 0,
    differentSessions: 0,
    prescribedKm: 0,
    completedKm: 0,
    adherencePercent: 0,
  };
}

function statusFromSummary(summary: { prescribedSessions: number; adherencePercent: number; differentSessions: number }) {
  if (!summary.prescribedSessions) return 'Sem plano';
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
