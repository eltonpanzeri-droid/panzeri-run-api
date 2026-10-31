import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DataDeletionCapability } from '../provider-hub/provider-connector';
import { COROS_WORKOUT_PROVIDER } from './coros-workout-publisher.service';
import { COROS_WEARABLE_PROVIDER } from './coros-health-sync.service';

// Limpeza ADICIONAL da COROS na exclusao de dados (alem da exclusao padrao de atividades/series/vinculos por provedor): o registro local dos treinos que foram enviados ao calendario
// (WorkoutDelivery do canal coros_mcp). Os treinos que ja' estao no calendario da COROS NAO podem ser removidos pelo Panzeri Run (a COROS nao oferece exclusao); a aluna os apaga no app da COROS.
@Injectable()
export class CorosDataDeletionService implements DataDeletionCapability {
  constructor(private readonly prisma: PrismaService) {}

  async deleteUserData(input: { userId: string }): Promise<void> {
    await this.prisma.workoutDelivery.deleteMany({ where: { provider: COROS_WORKOUT_PROVIDER, trainingSession: { userId: input.userId } } });
    // Saude importada da COROS (sono, HRV, diario/FC de repouso): apagada junto, como na Zepp.
    await this.prisma.wearableSleepSummary.deleteMany({ where: { provider: COROS_WEARABLE_PROVIDER, userId: input.userId } });
    await this.prisma.wearableHrvSummary.deleteMany({ where: { provider: COROS_WEARABLE_PROVIDER, userId: input.userId } });
    await this.prisma.wearableDailySummary.deleteMany({ where: { provider: COROS_WEARABLE_PROVIDER, userId: input.userId } });
  }
}
