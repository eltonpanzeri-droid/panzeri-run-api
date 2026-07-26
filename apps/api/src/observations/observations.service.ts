import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../billing/telegram.service';
import { CreateObservationDto } from './dto/create-observation.dto';

@Injectable()
export class ObservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  async listMine(userId: string) {
    return this.prisma.studentObservation.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async create(userId: string, dto: CreateObservationDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
    const observation = await this.prisma.studentObservation.create({
      data: { userId, content: dto.content.trim() },
    });

    await this.telegram.notifyCoach(
      `Nova observacao registrada no Panzeri Run\n\nAluno: ${user.name}\nE-mail: ${user.email}\nObservacao: ${observation.content}`,
    );

    return observation;
  }
}
