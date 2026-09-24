import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionAgentService } from './evolution-agent.service';
import { sanitizeInterviewAnswers } from '../training-plans/training-methodology';
import { StudentProfileService, ProfileEventCode } from '../training-plans/student-profile.service';
import { AthleteStateSnapshotService } from '../training-intelligence/athlete-state-snapshot.service';
import {
  buildReassessmentTrajectories,
  buildFitnessTestTrajectory,
  REASSESSMENT_INSTRUMENT_VERSION,
} from './reassessment-trajectory';

// 25/09/2026 (Passo 3): ciclo oficial passou de 90 para 105 dias (15 semanas), a pedido explicito
// de Elton. A ancora (ultima reavaliacao concluida OU conclusao da entrevista inicial) nao mudou.
export const REASSESSMENT_DUE_AFTER_DAYS = 105;
export const REASSESSMENT_WARNING_AFTER_DAYS = 98; // semana 14 do ciclo de 15 semanas (14 * 7).

@Injectable()
export class ReassessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evolutionAgent: EvolutionAgentService,
    private readonly studentProfile: StudentProfileService,
    private readonly athleteStateSnapshot: AthleteStateSnapshotService,
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
      warning: daysSinceLast !== null && daysSinceLast >= REASSESSMENT_WARNING_AFTER_DAYS && daysSinceLast < REASSESSMENT_DUE_AFTER_DAYS,
      daysSinceLast,
      daysUntilDue: referenceDate ? REASSESSMENT_DUE_AFTER_DAYS - (daysSinceLast ?? 0) : null,
      answers: asAnswerObject(draft?.answers),
      currentStep: draft?.currentStep ?? 0,
      lastCompletedAt: lastCompleted?.completedAt ?? null,
    };
  }

  /**
   * Gate leve reutilizado pelo fluxo de geracao de treinos (TrainingPlansService.generateWeek) —
   * NAO recalcula nada que state() ja calcula, so' devolve o booleano que interessa pra decidir se
   * a geracao pode prosseguir. Nunca apaga, bloqueia visualizacao ou altera sessoes ja existentes;
   * atua so' no ponto de decidir se uma nova semana pode ser gerada.
   */
  async isReassessmentDue(userId: string): Promise<boolean> {
    const { due } = await this.state(userId);
    return due;
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
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { answers: true, completedAt: true, interviewVersion: true } }),
      this.prisma.reassessment.findMany({
        where: { userId, completedAt: { not: null }, NOT: { id: draft.id } },
        orderBy: { completedAt: 'asc' },
      }),
      this.prisma.fitnessTest.findMany({ where: { userId, testType: '3km' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.trainingPlan.findMany({
        where: { userId },
        orderBy: { startDate: 'desc' },
        take: 8,
        include: { sessions: { include: { completion: true } } },
      }),
    ]);

    const completed = await this.prisma.reassessment.update({
      where: { id: draft.id },
      data: { completedAt: new Date(), reassessmentVersion: REASSESSMENT_INSTRUMENT_VERSION },
    });

    // Trajetoria completa INITIAL -> R1 -> R2 -> ... -> esta reavaliacao (nao apenas "ultima vs
    // atual", nao limitada a um numero arbitrario de reavaliacoes anteriores — secao 21/Passo 3).
    const allCompleted = [...previousReassessments, completed].sort(
      (a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0),
    );
    const trajectories = buildReassessmentTrajectories(
      onboarding ? { answers: asAnswerObject(onboarding.answers), completedAt: onboarding.completedAt, interviewVersion: onboarding.interviewVersion } : null,
      allCompleted.map((r) => ({ id: r.id, answers: asAnswerObject(r.answers), completedAt: r.completedAt, reassessmentVersion: r.reassessmentVersion })),
    );
    const fitnessTrajectory = buildFitnessTestTrajectory(fitnessTests);

    const snapshot = await this.athleteStateSnapshot.getSnapshot(userId).catch(() => null);

    const report = await this.evolutionAgent.analyze({
      studentName: user.name,
      goal: user.preferences?.mainGoal ?? '',
      variableTrajectories: trajectories,
      fitnessTests: fitnessTrajectory,
      latestReassessmentExclusiveAnswers: extractExclusiveAnswers(asAnswerObject(completed.answers)),
      athleteStateSnapshot: snapshot?.compact ?? null,
      executionHistory: plans.map((plan) => ({
        weekStart: plan.startDate.toISOString().slice(0, 10),
        prescribedSessions: plan.sessions.length,
        completedSessions: plan.sessions.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted').length,
        actualKm: Number(plan.sessions.reduce((total, session) => total + (session.completion?.distanceKm ?? 0), 0).toFixed(2)),
      })),
    });

    if (!report) return completed;

    void this.studentProfile.recordEvent(
      userId,
      ProfileEventCode.REASSESSMENT_COMPLETED,
      `Reavaliacao periodica concluida. Resumo de evolucao: ${report.summary}`,
    ).catch(() => undefined);

    // Persistencia: gerado uma vez por reavaliacao concluida. O agente de prescricao consulta este
    // registro depois (ver TrainingPlansService.generateWeek) sem nunca chamar o Evolution Agent de
    // novo. upsert cobre o caso de reopen()+complete() no mesmo Reassessment.id (regenera o
    // relatorio associado em vez de duplicar).
    await this.prisma.evolutionReport.upsert({
      where: { reassessmentId: completed.id },
      create: {
        userId,
        reassessmentId: completed.id,
        trajectorySnapshot: trajectories as unknown as Prisma.InputJsonValue,
        summary: report.summary,
        wins: report.wins,
        concerns: report.concerns,
        domainObservations: (report.domainObservations ?? null) as Prisma.InputJsonValue,
      },
      update: {
        trajectorySnapshot: trajectories as unknown as Prisma.InputJsonValue,
        summary: report.summary,
        wins: report.wins,
        concerns: report.concerns,
        domainObservations: (report.domainObservations ?? null) as Prisma.InputJsonValue,
        invalidatedAt: null,
      },
    });

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

    // 25/09/2026 (Passo 3, secao 28): se esta reavaliacao ja gerou um Evolution Report, ele passa a
    // ser tratado como invalido a partir daqui — as respostas que o embasaram estao prestes a mudar.
    // complete() (chamado de novo depois da correcao) faz upsert e limpa invalidatedAt sozinho.
    await this.prisma.evolutionReport.updateMany({
      where: { reassessmentId: id, invalidatedAt: null },
      data: { invalidatedAt: new Date() },
    });

    return this.prisma.reassessment.update({ where: { id }, data: { completedAt: null } });
  }

  /**
   * Ultimo Evolution Report VALIDO do aluno (nao invalidado por um reopen ainda nao reconcluido).
   * Consumido pelo agente de prescricao (TrainingPlansService) — nunca recalcula, so' le o que ja
   * foi persistido em complete().
   */
  async getLatestValidEvolutionReport(userId: string) {
    return this.prisma.evolutionReport.findFirst({
      where: { userId, invalidatedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }
}

function asAnswerObject(value: unknown): Record<string, Prisma.InputJsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, Prisma.InputJsonValue>;
}

// Perguntas exclusivas da reavaliacao (percepcao de trajetoria, nao estado atual comparavel) —
// passadas ao Evolution Agent so' da reavaliacao mais recente, como contexto qualitativo do
// momento, nunca como serie longitudinal (ver reassessment-trajectory.ts para as series de fato).
const EXCLUSIVE_ANSWER_KEYS = [
  'reassessment_perceived_evolution', 'reassessment_satisfaction', 'reassessment_routine_change',
  'reassessment_notes', 'reassessment_new_pain', 'reassessment_new_pain_detail',
  'reassessment_goal_change', 'reassessment_goal_new',
];

function extractExclusiveAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of EXCLUSIVE_ANSWER_KEYS) {
    if (answers[key] !== undefined) result[key] = answers[key];
  }
  return result;
}
