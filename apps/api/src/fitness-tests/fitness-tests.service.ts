import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateThreeKmTestDto } from './dto/create-three-km-test.dto';
import { PhysiologyService } from '../physiology/physiology.service';
import { formatPace } from './performance-calculations';

@Injectable()
export class FitnessTestsService {
  constructor(private readonly prisma: PrismaService, private readonly physiology: PhysiologyService) {}

  // 30/10/2026: o teste de 3 km passou a ser gravado pelo PhysiologyService (modelo de Daniels e Gilbert, avaliacao, indicadores e
  // referencia operacional na mesma transacao). O resultado original (tempo, FC, ambiente, notas) continua em FitnessTest.
  createThreeKm(userId: string, dto: CreateThreeKmTestDto) {
    return this.physiology.saveThreeKm(userId, dto);
  }

  updateThreeKm(userId: string, testId: string, dto: CreateThreeKmTestDto) {
    return this.physiology.saveThreeKm(userId, dto, testId);
  }

  async list(userId: string) {
    const tests = await this.prisma.fitnessTest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return tests.map((test) => ({
      ...test,
      averagePace: formatPace(test.paceSecondsPerKm),
    }));
  }
}
