import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';

@Injectable()
export class CoachService {
  constructor(private readonly prisma: PrismaService) {}

  async createStudent(dto: CreateStudentDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('E-mail ja cadastrado.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash,
        role: 'student',
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return {
      user,
      message: 'Aluno criado. Envie o e-mail e a senha inicial para ele acessar o app.',
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
          where: { status: 'active' },
          orderBy: { createdAt: 'desc' },
          take: 1,
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
    };
  }
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
