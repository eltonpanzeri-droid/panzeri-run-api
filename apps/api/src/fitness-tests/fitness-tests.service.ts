import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateThreeKmTestDto } from './dto/create-three-km-test.dto';
import { calculateThreeKmMetrics, formatPace } from './performance-calculations';

const THREE_KM_TEST_SELECT = {
  id: true,
  testType: true,
  totalSeconds: true,
  paceSecondsPerKm: true,
  vo2maxEstimated: true,
  vvo2Kmh: true,
  environment: true,
  createdAt: true,
};

@Injectable()
export class FitnessTestsService {
  constructor(private readonly prisma: PrismaService) {}

  createThreeKm(userId: string, dto: CreateThreeKmTestDto) {
    const metrics = calculateThreeKmMetrics(dto.totalSeconds);

    return this.prisma.fitnessTest.create({
      data: {
        userId,
        testType: '3km',
        totalSeconds: dto.totalSeconds,
        avgHeartRate: dto.avgHeartRate,
        maxHeartRate: dto.maxHeartRate,
        environment: dto.environment,
        notes: dto.notes,
        ...metrics,
      },
      select: THREE_KM_TEST_SELECT,
    });
  }

  async updateThreeKm(userId: string, testId: string, dto: CreateThreeKmTestDto) {
    const existing = await this.prisma.fitnessTest.findFirst({ where: { id: testId, userId, testType: '3km' } });
    if (!existing) throw new NotFoundException('Teste nao encontrado.');

    const metrics = calculateThreeKmMetrics(dto.totalSeconds);
    return this.prisma.fitnessTest.update({
      where: { id: testId },
      data: {
        totalSeconds: dto.totalSeconds,
        avgHeartRate: dto.avgHeartRate,
        maxHeartRate: dto.maxHeartRate,
        environment: dto.environment,
        notes: dto.notes,
        ...metrics,
      },
      select: THREE_KM_TEST_SELECT,
    });
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
