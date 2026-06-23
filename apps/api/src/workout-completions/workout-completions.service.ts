import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertWorkoutCompletionDto } from './dto/upsert-workout-completion.dto';

@Injectable()
export class WorkoutCompletionsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.workoutCompletion.upsert({
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
  }
}
