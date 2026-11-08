import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DataDeletionCapability } from '../provider-hub/provider-connector';
import { GARMIN_PROVIDER_ID } from './garmin.connector';
import { GARMIN_WORKOUT_PROVIDER } from './garmin-workout-publisher.service';

// Limpeza ADICIONAL da Garmin na exclusao de dados (alem da exclusao padrao de atividades/series/vinculos por provedor, feita pelo ProviderDataDeletionService): o registro local dos treinos enviados e
// TODA a saude importada da Garmin (sono, dia, HRV e as metricas: estresse/Body Battery, VO2 maximo, composicao corporal). Os treinos que ja' estao no Garmin Connect nao sao tocados aqui (a aluna os apaga la).
@Injectable()
export class GarminDataDeletionService implements DataDeletionCapability {
  constructor(private readonly prisma: PrismaService) {}

  async deleteUserData(input: { userId: string }): Promise<void> {
    await this.prisma.workoutDelivery.deleteMany({ where: { provider: GARMIN_WORKOUT_PROVIDER, trainingSession: { userId: input.userId } } });
    await this.prisma.wearableSleepSummary.deleteMany({ where: { provider: GARMIN_PROVIDER_ID, userId: input.userId } });
    await this.prisma.wearableHrvSummary.deleteMany({ where: { provider: GARMIN_PROVIDER_ID, userId: input.userId } });
    await this.prisma.wearableDailySummary.deleteMany({ where: { provider: GARMIN_PROVIDER_ID, userId: input.userId } });
    await this.prisma.wearableMetricRecord.deleteMany({ where: { provider: GARMIN_PROVIDER_ID, userId: input.userId } });
  }
}
