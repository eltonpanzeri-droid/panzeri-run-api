import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { UpsertWorkoutCompletionDto } from './dto/upsert-workout-completion.dto';
import { StudentProfileService, ProfileEventCode } from '../training-plans/student-profile.service';
import { TelegramService, formatStudentCode } from '../billing/telegram.service';

@Injectable()
export class WorkoutCompletionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly studentProfile: StudentProfileService,
    private readonly telegram: TelegramService,
  ) {}

  async upsert(userId: string, dto: UpsertWorkoutCompletionDto) {
    const details = (dto.details ?? {}) as Prisma.InputJsonObject;
    const session = await this.prisma.trainingSession.findFirst({
      where: {
        id: dto.sessionId,
        userId,
      },
    });

    if (!session) {
      throw new NotFoundException('Treino nao encontrado.');
    }

    if (dto.status === 'done' && !dto.perceivedEffort) {
      throw new BadRequestException('Informe o esforco percebido de 1 a 10.');
    }

    const previous = await this.prisma.workoutCompletion.findUnique({ where: { sessionId: dto.sessionId } });
    const completedAt = dto.completedAt ? new Date(dto.completedAt) : undefined;
    const completion = await this.prisma.workoutCompletion.upsert({
      where: { sessionId: dto.sessionId },
      create: {
        userId,
        sessionId: dto.sessionId,
        status: dto.status,
        completedAt,
        durationMin: dto.durationMin,
        distanceKm: dto.distanceKm,
        avgPaceSecondsKm: dto.avgPaceSecondsKm,
        avgHeartRate: dto.avgHeartRate,
        maxHeartRate: dto.maxHeartRate,
        perceivedEffort: dto.perceivedEffort,
        satisfaction: dto.satisfaction,
        satisfactionElaboracao: dto.satisfactionElaboracao,
        satisfactionCapacidade: dto.satisfactionCapacidade,
        satisfactionCarga: dto.satisfactionCarga,
        painFlag: dto.painFlag,
        notes: dto.notes,
        details,
        source: 'manual',
      },
      update: {
        status: dto.status,
        completedAt,
        durationMin: dto.durationMin,
        distanceKm: dto.distanceKm,
        avgPaceSecondsKm: dto.avgPaceSecondsKm,
        avgHeartRate: dto.avgHeartRate,
        maxHeartRate: dto.maxHeartRate,
        perceivedEffort: dto.perceivedEffort,
        satisfaction: dto.satisfaction,
        satisfactionElaboracao: dto.satisfactionElaboracao,
        satisfactionCapacidade: dto.satisfactionCapacidade,
        satisfactionCarga: dto.satisfactionCarga,
        painFlag: dto.painFlag,
        notes: dto.notes,
        details,
        source: 'manual',
      },
    });

    // Sessao foi marcada em generateWeek() como fora da rotina/tempo combinado (sem diretriz que
    // explique) — pedido explicito do treinador 03/08: quando o aluno registra o feedback desse
    // treino especifico, encaminha pro Telegram do treinador junto com o motivo do desvio, alem
    // do aviso ja recebido na hora da geracao (routineMismatch agregado da semana).
    if (session.routineMismatchNote) {
      const student = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, studentCode: true } });
      const statusLabel = dto.status === 'done' ? 'concluiu' : dto.status === 'adjusted' ? 'fez com ajustes' : 'marcou como nao feito';
      await this.telegram.notifyCoach(
        `📋 Feedback de treino fora da rotina combinada.\nAluno: ${student?.name ?? 'desconhecido'} (Cod. ${student ? formatStudentCode(student.studentCode) : '?'})\nMotivo do desvio: ${session.routineMismatchNote}\nAluno ${statusLabel} este treino.${dto.notes?.trim() ? `\nFeedback do aluno: ${dto.notes.trim()}` : '\nSem comentario escrito pelo aluno.'}`,
      ).catch(() => undefined);
    }

    const missedReasons = Array.isArray((details as Record<string, unknown>).missedReasons)
      ? ((details as Record<string, unknown>).missedReasons as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    const missedComment = typeof (details as Record<string, unknown>).missedComment === 'string'
      ? ((details as Record<string, unknown>).missedComment as string)
      : '';

    const statusLabelForProfile = dto.status === 'done' ? 'concluiu' : dto.status === 'adjusted' ? 'fez com ajustes' : 'nao fez';
    const profileParts = [
      `Aluno ${statusLabelForProfile} o treino "${session.title}".`,
      dto.distanceKm ? `Distancia: ${dto.distanceKm}km.` : '',
      dto.avgPaceSecondsKm ? `Pace medio: ${Math.floor(dto.avgPaceSecondsKm / 60)}:${String(dto.avgPaceSecondsKm % 60).padStart(2, '0')}/km.` : '',
      dto.perceivedEffort ? `Esforco percebido: ${dto.perceivedEffort}/10.` : '',
      dto.satisfactionElaboracao ? `Satisfacao com a elaboracao do treino: ${satisfactionLabel(dto.satisfactionElaboracao)}.` : '',
      dto.satisfaction ? `Satisfacao em fazer o treino: ${satisfactionLabel(dto.satisfaction)}.` : '',
      dto.satisfactionCapacidade ? `Satisfacao com como conseguiu fazer: ${satisfactionLabel(dto.satisfactionCapacidade)}.` : '',
      dto.satisfactionCarga ? `Carga do treino: ${cargaLabel(dto.satisfactionCarga)}.` : '',
      dto.painFlag && dto.painFlag !== 'none' ? `Dor sinalizada: ${dto.painFlag}.` : '',
      missedReasons.length ? `Motivo(s) de nao ter treinado: ${missedReasons.map(missedReasonLabel).join(', ')}.` : '',
      missedComment.trim() ? `Comentario do aluno sobre a falta: ${missedComment.trim()}` : '',
      dto.notes?.trim() ? `Feedback do aluno: ${dto.notes.trim()}` : '',
    ].filter(Boolean).join(' ');
    void this.studentProfile.recordEvent(userId, ProfileEventCode.WORKOUT_COMPLETED, profileParts).catch(() => undefined);

    const student = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const coachEmails = (this.config.get<string>('COACH_EMAILS') ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (coachEmails.length) {
      const coaches = await this.prisma.user.findMany({ where: { email: { in: coachEmails } }, select: { id: true } });
      const statusLabel = dto.status === 'done' ? 'concluiu' : dto.status === 'adjusted' ? 'registrou com ajustes' : 'marcou como nao feito';
      const details = [
        dto.perceivedEffort ? `Esforco: ${dto.perceivedEffort}/10.` : '',
        dto.satisfaction ? `Satisfacao em fazer o treino: ${satisfactionLabel(dto.satisfaction)}.` : '',
        dto.satisfactionElaboracao ? `Satisfacao com a elaboracao: ${satisfactionLabel(dto.satisfactionElaboracao)}.` : '',
        dto.satisfactionCapacidade ? `Satisfacao com como conseguiu fazer: ${satisfactionLabel(dto.satisfactionCapacidade)}.` : '',
        dto.satisfactionCarga ? `Carga: ${cargaLabel(dto.satisfactionCarga)}.` : '',
        missedReasons.length ? `Motivo(s) da falta: ${missedReasons.map(missedReasonLabel).join(', ')}.` : '',
        missedComment.trim() ? `Comentario do aluno: ${missedComment.trim()}` : '',
        dto.notes?.trim() ? `Feedback: ${dto.notes.trim()}` : 'Sem comentario.',
      ].filter(Boolean).join(' ');
      await this.prisma.userNotification.createMany({
        data: coaches.map((coach) => ({
          userId: coach.id,
          title: previous ? 'Registro de treino atualizado' : 'Aluno registrou um treino',
          message: `${student?.name ?? 'Aluno'} ${statusLabel} ${session.title}. ${details}`,
          type: dto.status === 'missed' ? 'warning' : 'info',
        })),
      });
    }

    return completion;
  }
}

export function satisfactionLabel(value: string) {
  const labels: Record<string, string> = {
    amei: 'Amei',
    gostei: 'Gostei',
    neutro: 'Neutro',
    nao_gostei: 'Nao gostei',
    detestei: 'Detestei',
  };
  return labels[value] ?? value;
}

export function cargaLabel(value: string) {
  const labels: Record<string, string> = {
    muito_leve: 'Muito leve',
    leve: 'Leve',
    na_medida: 'Na medida',
    pesada: 'Pesada',
    muito_pesada: 'Muito pesada',
  };
  return labels[value] ?? value;
}

// Conversao numerica pra quantificar as respostas (pedido do treinador 19/08) — usada so pra
// exibicao/media no painel do treinador, nunca pra decidir ou validar o proprio treino (isso
// continua 100% a cargo da IA, ver panzeri_methodology). amei..detestei e uma escala normal
// "quanto maior, melhor" (1 a 5). satisfactionCarga NAO e assim: "na medida" e o alvo, entao a
// escala fica em torno de zero — desviar pra qualquer lado (leve OU pesada) e igualmente um sinal
// de ajuste, nunca "pesada e melhor que leve" so por ter numero maior.
export const SATISFACTION_SCORE: Record<string, number> = {
  detestei: 1,
  nao_gostei: 2,
  neutro: 3,
  gostei: 4,
  amei: 5,
};

export const CARGA_SCORE: Record<string, number> = {
  muito_leve: -2,
  leve: -1,
  na_medida: 0,
  pesada: 1,
  muito_pesada: 2,
};

// Mesmas opcoes/valores do seletor de motivo de falta no app (ver MISSED_REASON_OPTIONS em
// App.tsx) — mantido em texto legivel aqui pro prontuario e pro treinador, nao pro aluno.
function missedReasonLabel(value: string) {
  const labels: Record<string, string> = {
    falta_tempo: 'falta de tempo/correria do dia',
    cansaco: 'cansaco/sem energia',
    dor: 'dor ou desconforto fisico',
    doente: 'doente',
    viagem: 'viagem',
    imprevisto_pessoal: 'imprevisto pessoal ou familiar',
    trabalho: 'compromisso de trabalho',
    clima: 'clima',
    falta_motivacao: 'falta de motivacao',
    esqueci: 'esqueceu/perdeu o horario',
  };
  return labels[value] ?? value;
}
