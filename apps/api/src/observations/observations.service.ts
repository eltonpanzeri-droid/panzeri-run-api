import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService, formatStudentCode } from '../billing/telegram.service';
import { CreateObservationDto } from './dto/create-observation.dto';
import { StudentProfileService, ProfileEventCode } from '../training-plans/student-profile.service';

@Injectable()
export class ObservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly studentProfile: StudentProfileService,
  ) {}

  async listMine(userId: string) {
    return this.prisma.studentObservation.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async create(userId: string, dto: CreateObservationDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, studentCode: true } });
    const observation = await this.prisma.studentObservation.create({
      data: { userId, content: dto.content.trim() },
    });

    await this.telegram.notifyCoach(
      `Nova observacao registrada no Panzeri Run\n\nAluno: ${user.name} (Cod. ${formatStudentCode(user.studentCode)})\nE-mail: ${user.email}\nObservacao: ${observation.content}`,
    );

    void this.studentProfile
      .recordEvent(userId, ProfileEventCode.STUDENT_OBSERVATION, `Observacao do aluno: ${observation.content}`)
      .catch(() => undefined);

    return observation;
  }
}
