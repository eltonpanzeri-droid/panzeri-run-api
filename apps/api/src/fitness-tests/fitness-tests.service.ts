import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateThreeKmTestDto } from './dto/create-three-km-test.dto';
import { calculateThreeKmMetrics, formatPace } from './performance-calculations';

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
      select: {
        id: true,
        testType: true,
        totalSeconds: true,
        paceSecondsPerKm: true,
        vo2maxEstimated: true,
        vvo2Kmh: true,
        environment: true,
        createdAt: true,
      },
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
