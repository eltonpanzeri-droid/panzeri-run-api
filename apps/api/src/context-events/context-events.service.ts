import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TRAINING_INTELLIGENCE_DATA_CUTOFF } from '../common/training-history-policy';
import { SubmitReturnQuestionnaireDto } from './dto/submit-return-questionnaire.dto';
import { CreateContextEventDto } from './dto/create-context-event.dto';
import { GAP_RETURN_THRESHOLD_DAYS, REASON_TO_CONTEXT_TYPE } from './context-event-types';

export interface GapStatus {
  lastObservedExecutionAt: Date | null;
  daysSinceLastObserved: number | null;
  inGap: boolean;
  thresholdDays: number;
}

const RECENT_EVENTS_WINDOW_DAYS = 60;
const RECENT_EVENTS_LIMIT = 5;

@Injectable()
export class ContextEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ultima EXECUCAO VALIDA observada — definida como um WorkoutCompletion com status done/adjusted
   * (missed NAO conta como execucao) cuja sessao esteja dentro da politica historica valida (nunca
   * conta um "ultimo treino" fantasma do periodo contaminado pre-01/08). Cobre tanto sessoes
   * prescritas quanto extras (ambas tem TrainingSession + WorkoutCompletion reais) sem precisar da
   * logica de sessao-fantasma do EvolutionMetricService — aqui so' importa "aconteceu um registro
   * real de execucao", nao "essa sessao prescrita conta como observacao de uma variavel".
   */
  async getLastObservedExecutionAt(userId: string): Promise<Date | null> {
    const completion = await this.prisma.workoutCompletion.findFirst({
      where: {
        userId,
        status: { in: ['done', 'adjusted'] },
        session: { scheduledDate: { gte: TRAINING_INTELLIGENCE_DATA_CUTOFF } },
      },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    });
    return completion?.completedAt ?? null;
  }

  async getGapStatus(userId: string): Promise<GapStatus> {
    const lastObservedExecutionAt = await this.getLastObservedExecutionAt(userId);
    if (!lastObservedExecutionAt) {
      // Aluno sem nenhuma execucao valida ainda (nunca treinou pelo app) — conceito de "lacuna"
      // nao se aplica a quem ainda nao tem um ponto de partida observado.
      return { lastObservedExecutionAt: null, daysSinceLastObserved: null, inGap: false, thresholdDays: GAP_RETURN_THRESHOLD_DAYS };
    }
    const daysSinceLastObserved = Math.floor((Date.now() - lastObservedExecutionAt.getTime()) / 86400000);
    return {
      lastObservedExecutionAt,
      daysSinceLastObserved,
      inGap: daysSinceLastObserved >= GAP_RETURN_THRESHOLD_DAYS,
      thresholdDays: GAP_RETURN_THRESHOLD_DAYS,
    };
  }

  /**
   * Estado do questionario de retorno pro app decidir se mostra a tela. "pending" so' fica true
   * quando ha uma lacuna real E ainda nao existe ContextEvent respondido ancorado nesta MESMA
   * lacuna (gapAnchorDate = lastObservedExecutionAt) — evita perguntar de novo pela mesma lacuna
   * a cada abertura do app.
   */
  async getReturnQuestionnaireState(userId: string) {
    const gap = await this.getGapStatus(userId);
    if (!gap.inGap || !gap.lastObservedExecutionAt) {
      return { pending: false, gap };
    }
    const alreadyAnswered = await this.prisma.contextEvent.findFirst({
      where: { userId, gapAnchorDate: gap.lastObservedExecutionAt },
      select: { id: true },
    });
    return { pending: !alreadyAnswered, gap };
  }

  async submitReturnQuestionnaire(userId: string, dto: SubmitReturnQuestionnaireDto) {
    const gap = await this.getGapStatus(userId);
    if (!gap.inGap || !gap.lastObservedExecutionAt) {
      throw new BadRequestException('Nao ha lacuna pendente de retorno pra este aluno no momento.');
    }
    const alreadyAnswered = await this.prisma.contextEvent.findFirst({
      where: { userId, gapAnchorDate: gap.lastObservedExecutionAt },
      select: { id: true },
    });
    if (alreadyAnswered) {
      throw new BadRequestException('Esta lacuna ja foi respondida.');
    }

    const originalTextParts = [
      dto.reason === 'other' && dto.reasonOtherDescription?.trim() ? dto.reasonOtherDescription.trim() : null,
      dto.note?.trim() || null,
    ].filter((part): part is string => Boolean(part));

    return this.prisma.contextEvent.create({
      data: {
        userId,
        type: REASON_TO_CONTEXT_TYPE[dto.reason],
        subtype: dto.reason,
        startedAt: gap.lastObservedExecutionAt,
        endedAt: new Date(),
        status: 'ended',
        source: 'student_reported',
        originalText: originalTextParts.length ? originalTextParts.join(' — ') : null,
        gapAnchorDate: gap.lastObservedExecutionAt,
        trainingDuringGapReported: dto.trainingDuringGap,
        physicalStateComparedToBefore: dto.physicalStateComparedToBefore,
        mentalReadinessComparedToBefore: dto.mentalReadinessComparedToBefore,
      },
    });
  }

  /** Caminho manual do treinador (secao 26) — sem interface grande no admin ainda (Passo 5). */
  async createManual(studentId: string, dto: CreateContextEventDto) {
    return this.prisma.contextEvent.create({
      data: {
        userId: studentId,
        type: dto.type,
        subtype: dto.subtype,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : null,
        endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
        status: dto.endedAt ? 'ended' : 'ongoing',
        source: 'coach_reported',
        originalText: dto.originalText,
      },
    });
  }

  /**
   * Chamado por WorkoutCompletionsService ao criar uma completion nova (nunca em update) — vincula
   * como "primeira observacao apos a lacuna" a completion mais antiga que aconteceu DEPOIS do
   * evento de retorno mais recente ainda nao vinculado. Metadado puro: nunca altera nenhum campo
   * semantico do WorkoutCompletion.
   */
  async linkFirstObservationIfPending(userId: string, completionId: string, completedAt: Date): Promise<void> {
    const pendingEvent = await this.prisma.contextEvent.findFirst({
      where: { userId, gapAnchorDate: { not: null }, firstObservationLinkedAt: null, endedAt: { lte: completedAt } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!pendingEvent) return;

    await this.prisma.$transaction([
      this.prisma.workoutCompletion.update({ where: { id: completionId }, data: { firstObservationAfterGapEventId: pendingEvent.id } }),
      this.prisma.contextEvent.update({ where: { id: pendingEvent.id }, data: { firstObservationLinkedAt: new Date() } }),
    ]);
  }

  /**
   * Contexto compacto pro Athlete State Snapshot (secao 18) — nunca despeja o historico inteiro.
   * activeEvents: eventos sem endedAt (ainda em curso). recentEvents: encerrados nos ultimos ~60
   * dias, no maximo 5. latestReturnContext: ultimo questionario de retorno respondido, se houver.
   */
  async getLifeContextData(userId: string) {
    const recentWindowStart = new Date(Date.now() - RECENT_EVENTS_WINDOW_DAYS * 86400000);
    const [activeEvents, recentEndedEvents, latestReturnEvent, gap] = await Promise.all([
      this.prisma.contextEvent.findMany({
        where: { userId, status: 'ongoing' },
        orderBy: { startedAt: 'desc' },
        select: { id: true, type: true, subtype: true, startedAt: true, source: true },
      }),
      this.prisma.contextEvent.findMany({
        where: { userId, status: 'ended', endedAt: { gte: recentWindowStart } },
        orderBy: { endedAt: 'desc' },
        take: RECENT_EVENTS_LIMIT,
        select: { id: true, type: true, subtype: true, startedAt: true, endedAt: true, source: true },
      }),
      this.prisma.contextEvent.findFirst({
        where: { userId, gapAnchorDate: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: {
          gapAnchorDate: true, startedAt: true, endedAt: true, type: true, subtype: true,
          trainingDuringGapReported: true, physicalStateComparedToBefore: true, mentalReadinessComparedToBefore: true,
        },
      }),
      this.getGapStatus(userId),
    ]);

    return {
      activeEvents: activeEvents.map((e) => ({ type: e.type, subtype: e.subtype, startedAt: e.startedAt?.toISOString() ?? null, source: e.source })),
      recentEvents: recentEndedEvents.map((e) => ({
        type: e.type, subtype: e.subtype,
        startedAt: e.startedAt?.toISOString() ?? null, endedAt: e.endedAt?.toISOString() ?? null, source: e.source,
      })),
      currentGapStatus: {
        inGap: gap.inGap,
        daysSinceLastObserved: gap.daysSinceLastObserved,
        thresholdDays: gap.thresholdDays,
      },
      latestReturnContext: latestReturnEvent ? {
        gapDurationDays: latestReturnEvent.gapAnchorDate && latestReturnEvent.endedAt
          ? Math.floor((latestReturnEvent.endedAt.getTime() - latestReturnEvent.gapAnchorDate.getTime()) / 86400000)
          : null,
        reasonType: latestReturnEvent.type,
        reasonSubtype: latestReturnEvent.subtype,
        trainingDuringGapReported: latestReturnEvent.trainingDuringGapReported,
        physicalStateComparedToBefore: latestReturnEvent.physicalStateComparedToBefore,
        mentalReadinessComparedToBefore: latestReturnEvent.mentalReadinessComparedToBefore,
      } : null,
    };
  }
}
