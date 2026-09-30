import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionAgentService } from './evolution-agent.service';
import { sanitizeInterviewAnswers } from '../training-plans/training-methodology';
import { StudentProfileService, ProfileEventCode } from '../training-plans/student-profile.service';
import { AthleteStateSnapshotService } from '../training-intelligence/athlete-state-snapshot.service';
import { ReportTimelineService } from '../reporter/report-timeline.service';
import { STUDENT_REPORT_SOURCE_TYPES } from '../reporter/report-timeline.constants';
import { MedalEvaluationService } from '../medals/medal-evaluation.service';
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
    private readonly reportTimeline: ReportTimelineService,
    private readonly medalEvaluation: MedalEvaluationService,
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

    // Sistema de Medalhas (30/09/2026) — fire-and-forget, aqui e não depois do relatório de
    // evolução: a reavaliação em si já está concluída neste ponto (a medalha é sobre a
    // reavaliação ter sido feita, nunca sobre o relatório de IA que vem depois ter tido sucesso).
    void this.medalEvaluation?.evaluateForUser(userId, 'reassessment_completed').catch(() => undefined);

    // Linha do Tempo de Relatos (28/09/2026) — mesmas chaves canonicas de texto livre da entrevista
    // inicial (a reavaliacao reaplica as mesmas perguntas de saude, ver comentario em schema.prisma).
    const reassessmentAnswers = asAnswerObject(completed.answers);
    const healthFreeTextFields: Array<{ key: string; promptQuestion: string }> = [
      { key: 'injury_description', promptQuestion: 'Descreva a lesao/cirurgia/limitacao' },
      { key: 'health_conditions_other', promptQuestion: 'Outra condicao de saude (descreva)' },
      { key: 'medical_recommendation', promptQuestion: 'Alguma recomendacao medica a considerar?' },
      { key: 'continuous_medications', promptQuestion: 'Usa alguma medicacao continua?' },
      // Auditoria Astra (29/09/2026), item 14 — CAUSA RAIZ: estes 2 campos de texto livre da
      // reavaliacao (ver apps/mobile/App.tsx, questionario de reavaliacao) existiam desde a v2 do
      // instrumento mas ficaram de fora quando a Linha do Tempo de Relatos foi montada (28/09/2026)
      // — miss real, nao decisao deliberada. Sem isso, o que o aluno escreve aqui nunca chega no
      // Agente Relator nem no Prontuario, so fica intacto em StudentReassessment.answers (JSON).
      { key: 'reassessment_notes', promptQuestion: 'Quer contar mais alguma coisa para o seu treinador?' },
      { key: 'pain_other_location', promptQuestion: 'Sente dor em algum outro local que nao esta na lista acima?' },
    ];
    for (const field of healthFreeTextFields) {
      const raw = reassessmentAnswers[field.key];
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) continue;
      void this.reportTimeline.record({
        userId,
        sourceType: STUDENT_REPORT_SOURCE_TYPES.REASSESSMENT_HEALTH,
        sourceId: completed.id,
        promptQuestion: field.promptQuestion,
        relatedLabel: 'Reavaliacao periodica - saude',
        originalText: text,
        occurredAt: completed.completedAt ?? new Date(),
      });
    }

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

  /**
   * Passo 5 (25/09/2026) — dados pro Admin exibir a trajetoria INITIAL->R1->R2->R3, o historico de
   * reavaliacoes com versao/data, e todos os Evolution Reports (incluindo os invalidados por
   * reopen, marcados como tal — o Admin decide como exibir, nunca escondido silenciosamente).
   * Quando ja existe um Evolution Report valido, reaproveita o "trajectorySnapshot" persistido
   * (nunca recalcula). So' quando NENHUM report existe ainda (ex: reavaliacao concluida mas a
   * chamada de IA falhou) chama buildReassessmentTrajectories() diretamente — a MESMA funcao pura
   * ja usada em complete(), nao uma segunda logica.
   */
  async getTrajectoryForAdmin(userId: string) {
    const [onboarding, completedReassessments, evolutionReports, latestValid] = await Promise.all([
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { answers: true, completedAt: true, interviewVersion: true } }),
      this.prisma.reassessment.findMany({
        where: { userId, completedAt: { not: null } },
        orderBy: { completedAt: 'asc' },
        select: { id: true, completedAt: true, reassessmentVersion: true, evolutionSummary: true, answers: true },
      }),
      this.prisma.evolutionReport.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.getLatestValidEvolutionReport(userId),
    ]);

    const trajectories = latestValid
      ? (latestValid.trajectorySnapshot as unknown as ReturnType<typeof buildReassessmentTrajectories>)
      : buildReassessmentTrajectories(
          onboarding ? { answers: asAnswerObject(onboarding.answers), completedAt: onboarding.completedAt, interviewVersion: onboarding.interviewVersion } : null,
          completedReassessments.map((r) => ({ id: r.id, answers: asAnswerObject(r.answers), completedAt: r.completedAt, reassessmentVersion: r.reassessmentVersion })),
        );

    return {
      onboarding: onboarding ? { completedAt: onboarding.completedAt, interviewVersion: onboarding.interviewVersion } : null,
      reassessments: completedReassessments.map((r) => ({ id: r.id, completedAt: r.completedAt, reassessmentVersion: r.reassessmentVersion, evolutionSummary: r.evolutionSummary })),
      evolutionReports,
      trajectories,
    };
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
