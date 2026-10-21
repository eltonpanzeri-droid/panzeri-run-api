import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DataDeletionCapability } from '../provider-hub/provider-connector';
import { ZEPP_PROVIDER_ID } from './zepp.connector';
import { ZEPP_WORKOUT_PROVIDER } from './zepp-workout-publisher.service';

// Limpeza ADICIONAL da Zepp na exclusao de dados (alem da exclusao padrao de atividades/series/vinculos por provedor): os resumos de SAUDE (sono, diario, HRV) e o registro local dos treinos que foram enviados ao relogio
// (WorkoutDelivery do provedor zepp_workout_v2) e eventos pendentes/antigos da fila. Os treinos que ainda estavam na conta Zepp saem pela revogacao feita ao desconectar
// (a exclusao de dados exige estar desconectado). O que o aluno informou ao Panzeri Run (esforco, dor, observacoes) nao e' tocado aqui.
@Injectable()
export class ZeppDataDeletionService implements DataDeletionCapability {
  constructor(private readonly prisma: PrismaService) {}

  async deleteUserData(input: { userId: string }): Promise<void> {
    await this.prisma.wearableSleepSummary.deleteMany({ where: { provider: ZEPP_PROVIDER_ID, userId: input.userId } });
    await this.prisma.wearableDailySummary.deleteMany({ where: { provider: ZEPP_PROVIDER_ID, userId: input.userId } });
    await this.prisma.wearableHrvSummary.deleteMany({ where: { provider: ZEPP_PROVIDER_ID, userId: input.userId } });
    await this.prisma.workoutDelivery.deleteMany({ where: { provider: ZEPP_WORKOUT_PROVIDER, trainingSession: { userId: input.userId } } });
    await this.prisma.providerInboundEvent.deleteMany({ where: { provider: ZEPP_PROVIDER_ID, userId: input.userId } });
  }
}
