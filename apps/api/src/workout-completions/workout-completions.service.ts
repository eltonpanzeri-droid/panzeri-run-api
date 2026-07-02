import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { UpsertWorkoutCompletionDto } from './dto/upsert-workout-completion.dto';

@Injectable()
export class WorkoutCompletionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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
    const completion = await this.prisma.workoutCompletion.upsert({
      where: { sessionId: dto.sessionId },
      create: {
        userId,
        sessionId: dto.sessionId,
        status: dto.status,
        durationMin: dto.durationMin,
        distanceKm: dto.distanceKm,
        avgPaceSecondsKm: dto.avgPaceSecondsKm,
        avgHeartRate: dto.avgHeartRate,
        maxHeartRate: dto.maxHeartRate,
        perceivedEffort: dto.perceivedEffort,
        notes: dto.notes,
        details,
        source: 'manual',
      },
      update: {
        status: dto.status,
        durationMin: dto.durationMin,
        distanceKm: dto.distanceKm,
        avgPaceSecondsKm: dto.avgPaceSecondsKm,
        avgHeartRate: dto.avgHeartRate,
        maxHeartRate: dto.maxHeartRate,
        perceivedEffort: dto.perceivedEffort,
        notes: dto.notes,
        details,
        source: 'manual',
      },
    });

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
