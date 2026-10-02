import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Fundacao canonica de entrega de treino (02/10/2026). NUNCA importa nada especifico de
// Polar/Garmin/COROS/Apple nem conhece SessionExecutionLink/ActivityLog — entrega e' um conceito
// totalmente separado de execucao (ver comentario do model WorkoutDelivery em schema.prisma).
// Nenhum metodo aqui envia nada a provider nenhum: isto so' registra o ESTADO de uma tentativa de
// entrega que um adapter de provider (ainda nao implementado) vai orquestrar.

export type WorkoutDeliveryStatus = 'pending' | 'sent' | 'failed';

@Injectable()
export class WorkoutDeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  // Cada chamada cria uma LINHA NOVA — nunca reaproveita/sobrescreve uma tentativa anterior, mesmo
  // para a mesma sessao e o mesmo provider. E' assim que o historico de tentativas (inclusive
  // falhas) nunca se perde (ver requisito 7 da fundacao).
  async recordAttempt(params: {
    trainingSessionId: string;
    provider: string;
    canonicalWorkout: Prisma.InputJsonValue;
    providerMetadata?: Prisma.InputJsonValue | null;
  }) {
    const session = await this.prisma.trainingSession.findUnique({ where: { id: params.trainingSessionId } });
    if (!session) throw new NotFoundException('Sessao de treino nao encontrada.');

    return this.prisma.workoutDelivery.create({
      data: {
        trainingSessionId: params.trainingSessionId,
        provider: params.provider,
        canonicalWorkout: params.canonicalWorkout,
        status: 'pending',
        providerMetadata: params.providerMetadata ?? undefined,
      },
    });
  }

  // Marca ESTA tentativa como enviada. externalWorkoutId e' opcional: alguns providers/cenarios
  // podem confirmar envio sem devolver um identificador reconsultavel (nunca assumir round-trip).
  async markSent(deliveryId: string, params: { externalWorkoutId?: string | null } = {}) {
    await this.getOrThrow(deliveryId);
    return this.prisma.workoutDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'sent',
        sentAt: new Date(),
        externalWorkoutId: params.externalWorkoutId ?? undefined,
      },
    });
  }

  // Marca ESTA tentativa como falha. Nao implica nada sobre execucao: o aluno pode ter feito o
  // treino de qualquer forma, sem o relogio ter recebido a estrutura.
  async markFailed(deliveryId: string, errorMessage: string) {
    await this.getOrThrow(deliveryId);
    return this.prisma.workoutDelivery.update({
      where: { id: deliveryId },
      data: { status: 'failed', failedAt: new Date(), errorMessage },
    });
  }

  // Historico completo (todas as tentativas, de todos os providers) de uma sessao — mais recente
  // primeiro. Nunca filtra por status: "o que ja tentamos enviar" inclui falhas.
  async listForSession(trainingSessionId: string) {
    return this.prisma.workoutDelivery.findMany({
      where: { trainingSessionId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  private async getOrThrow(deliveryId: string) {
    const delivery = await this.prisma.workoutDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) throw new NotFoundException('Tentativa de entrega nao encontrada.');
    return delivery;
  }
}
