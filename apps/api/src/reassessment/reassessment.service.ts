import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionAgentService } from './evolution-agent.service';
import { sanitizeInterviewAnswers } from '../training-plans/training-methodology';

export const REASSESSMENT_DUE_AFTER_DAYS = 90;

@Injectable()
export class ReassessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evolutionAgent: EvolutionAgentService,
  ) {}

  async state(userId: string) {
    const [draft, lastCompleted, onboarding] = await Promise.all([
      this.prisma.reassessment.findFirst({ where: { userId, completedAt: null }, orderBy: { createdAt: 'desc' } }),
      this.prisma.reassessment.findFirst({ where: { userId, completedAt: { not: null } }, orderBy: { completedAt: 'desc' } }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { completedAt: true } }),
    ]);

    const referenceDate = lastCompleted?.completedAt ?? onboarding?.completedAt ?? null;
    const daysSinceLast = referenceDate ? Math.floor((Date.now() - referenceDate.getTime()) / 86400000) : null;

    return {
      due: daysSinceLast !== null && daysSinceLast >= REASSESSMENT_DUE_AFTER_DAYS,
      daysSinceLast,
      answers: asAnswerObject(draft?.answers),
      currentStep: draft?.currentStep ?? 0,
      lastCompletedAt: lastCompleted?.completedAt ?? null,
    };
  }

  async saveAnswer(userId: string, dto: { key: string; value: unknown; currentStep: number }) {
    if (!/^[a-z0-9_]+$/i.test(dto.key) || dto.currentStep < 0) {
      throw new BadRequestException('Resposta de reavaliacao invalida.');
    }
    const draft = await this.prisma.reassessment.findFirst({ where: { userId, completedAt: null }, orderBy: { createdAt: 'desc' } });
    const answers = asAnswerObject(draft?.answers);
    answers[dto.key] = JSON.parse(JSON.stringify(dto.value)) as Prisma.InputJsonValue;

    if (draft) {
      return this.prisma.reassessment.update({ where: { id: draft.id }, data: { answers, currentStep: dto.currentStep } });
    }
    return this.prisma.reassessment.create({ data: { userId, answers, currentStep: dto.currentStep } });
  }

  async complete(userId: string) {
    const draft = await this.prisma.reassessment.findFirst({ where: { userId, completedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!draft) {
      throw new BadRequestException('Nenhuma reavaliacao em andamento.');
    }

    const [user, onboarding, previousReassessments, fitnessTests, plans] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { preferences: true } }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { answers: true } }),
      this.prisma.reassessment.findMany({
        where: { userId, completedAt: { not: null }, NOT: { id: draft.id } },
        orderBy: { completedAt: 'desc' },
        take: 5,
      }),
      this.prisma.fitnessTest.findMany({ where: { userId, testType: '3km' }, orderBy: { createdAt: 'desc' }, take: 6 }),
      this.prisma.trainingPlan.findMany({
        where: { userId },
        orderBy: { startDate: 'desc' },
        take: 8,
        include: { sessions: { include: { completion: true } } },
      }),
    ]);

    const completed = await this.prisma.reassessment.update({ where: { id: draft.id }, data: { completedAt: new Date() } });

    const report = await this.evolutionAgent.analyze({
      studentName: user.name,
      goal: user.preferences?.mainGoal ?? '',
      firstInterviewAnswers: sanitizeInterviewAnswers(asAnswerObject(onboarding?.answers)),
      latestReassessmentAnswers: asAnswerObject(completed.answers),
      previousReassessments: previousReassessments.map((item) => ({
        completedAt: item.completedAt?.toISOString() ?? null,
        answers: asAnswerObject(item.answers),
      })),
      fitnessTests: fitnessTests.map((test) => ({
        createdAt: test.createdAt.toISOString(),
        paceSecondsPerKm: test.paceSecondsPerKm,
        totalSeconds: test.totalSeconds,
      })),
      executionHistory: plans.map((plan) => ({
        weekStart: plan.startDate.toISOString().slice(0, 10),
        prescribedSessions: plan.sessions.length,
        completedSessions: plan.sessions.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted').length,
        actualKm: Number(plan.sessions.reduce((total, session) => total + (session.completion?.distanceKm ?? 0), 0).toFixed(2)),
      })),
    });

    if (!report) return completed;

    return this.prisma.reassessment.update({
      where: { id: draft.id },
      data: {
        evolutionSummary: report.summary,
        evolutionWins: report.wins,
        evolutionConcerns: report.concerns,
      },
    });
  }

  async history(userId: string) {
    return this.prisma.reassessment.findMany({
      where: { userId, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
    });
  }

  // Reabre uma reavaliacao ja concluida para correcao, transformando-a de volta na "rascunho
  // atual" — os mesmos endpoints saveAnswer/state/complete ja operam sobre a linha com
  // completedAt nulo mais recente, entao isso reaproveita toda a mecanica existente em vez de
  // duplicar logica de edicao.
  async reopen(userId: string, id: string) {
    const target = await this.prisma.reassessment.findFirst({ where: { id, userId } });
    if (!target) throw new NotFoundException('Reavaliacao nao encontrada.');

    const otherDraft = await this.prisma.reassessment.findFirst({ where: { userId, completedAt: null, NOT: { id } } });
    if (otherDraft) {
      throw new BadRequestException('Ja existe uma reavaliacao em andamento. Conclua ou finalize-a antes de corrigir uma reavaliacao anterior.');
    }

    return this.prisma.reassessment.update({ where: { id }, data: { completedAt: null } });
  }
}

function asAnswerObject(value: unknown): Record<string, Prisma.InputJsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, Prisma.InputJsonValue>;
}
