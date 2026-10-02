import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkoutDeliveryService } from '../src/workout-delivery/workout-delivery.service';

// Mock de Prisma em memoria real (Map), mesmo padrao de test/session-execution-link.spec.ts.
function fixture() {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const trainingSessions = new Map<string, any>();
  const deliveries = new Map<string, any>();

  const prisma = {
    trainingSession: {
      findUnique: jest.fn(async ({ where }: any) => trainingSessions.get(where.id) ?? null),
    },
    workoutDelivery: {
      findUnique: jest.fn(async ({ where }: any) => deliveries.get(where.id) ?? null),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        let rows = [...deliveries.values()].filter((d) => d.trainingSessionId === where.trainingSessionId);
        if (orderBy?.requestedAt === 'desc') rows = rows.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
        return rows;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: nextId('delivery'),
          requestedAt: new Date(),
          sentAt: null,
          deliveredAt: null,
          failedAt: null,
          canceledAt: null,
          externalWorkoutId: null,
          errorMessage: null,
          providerMetadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        deliveries.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = deliveries.get(where.id);
        // Prisma real ignora chaves com valor "undefined" num update (mantem o valor atual) —
        // reproduzido aqui pra o mock nao se comportar diferente do banco real.
        const definedData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
        const updated = { ...row, ...definedData, updatedAt: new Date() };
        deliveries.set(where.id, updated);
        return updated;
      }),
    },
  } as unknown as PrismaService;

  function seedSession(id: string, overrides: Partial<any> = {}) {
    trainingSessions.set(id, { id, userId: 'user-1', ...overrides });
  }

  return { prisma, trainingSessions, deliveries, seedSession };
}

describe('WorkoutDeliveryService', () => {
  it('1. uma TrainingSession pode ter zero ou multiplos deliveries', async () => {
    const { prisma, seedSession } = fixture();
    seedSession('session-1');
    const service = new WorkoutDeliveryService(prisma);

    expect(await service.listForSession('session-1')).toHaveLength(0);

    await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });

    const deliveries = await service.listForSession('session-1');
    expect(deliveries).toHaveLength(2);
  });

  it('2. providers diferentes podem receber a mesma prescricao', async () => {
    const { prisma, seedSession } = fixture();
    seedSession('session-1');
    const service = new WorkoutDeliveryService(prisma);

    await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'garmin', canonicalWorkout: { parts: [] } });

    const deliveries = await service.listForSession('session-1');
    expect(deliveries.map((d) => d.provider).sort()).toEqual(['garmin', 'polar']);
  });

  it('3. delivery pode existir sem externalWorkoutId', async () => {
    const { prisma, seedSession } = fixture();
    seedSession('session-1');
    const service = new WorkoutDeliveryService(prisma);

    const delivery = await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    expect(delivery.externalWorkoutId).toBeNull();

    const sent = await service.markSent(delivery.id);
    expect(sent.status).toBe('sent');
    expect(sent.externalWorkoutId).toBeNull();
  });

  it('4. falha de envio nao altera nenhum dado de execucao (service nao conhece ActivityLog/SessionExecutionLink)', async () => {
    const { prisma, seedSession } = fixture();
    seedSession('session-1');
    const service = new WorkoutDeliveryService(prisma);

    const delivery = await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    const failed = await service.markFailed(delivery.id, 'timeout');

    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toBe('timeout');
    // O service nao expoe nem importa nenhum metodo de ActivityLog/SessionExecutionLink — a
    // ausencia de qualquer referencia a essas entidades e' a propria garantia estrutural.
    expect((service as any).prisma.activityLog).toBeUndefined();
    expect((service as any).prisma.sessionExecutionLink).toBeUndefined();
  });

  it('5. status de delivery nunca altera SessionExecutionLink (nenhum metodo do service toca essa tabela)', async () => {
    const { prisma, seedSession } = fixture();
    seedSession('session-1');
    const service = new WorkoutDeliveryService(prisma);

    const delivery = await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    await service.markSent(delivery.id, { externalWorkoutId: 'ext-1' });
    await service.markFailed(delivery.id, 'erro simulado');

    // Nenhuma chamada ao prisma mock tocou "sessionExecutionLink" (a tabela nem existe no mock) —
    // provando que o fluxo completo de uma tentativa nunca precisa dela.
    expect(Object.keys(prisma as any)).toEqual(['trainingSession', 'workoutDelivery']);
  });

  it('6. metadata especifica do provider permanece isolada em providerMetadata, nunca promovida a coluna canonica', async () => {
    const { prisma, seedSession } = fixture();
    seedSession('session-1');
    const service = new WorkoutDeliveryService(prisma);

    const delivery = await service.recordAttempt({
      trainingSessionId: 'session-1',
      provider: 'polar',
      canonicalWorkout: { parts: [{ kind: 'continua', distanceKm: 5 }] },
      providerMetadata: { polarTransactionId: 'txn-123' },
    });

    expect(delivery.providerMetadata).toEqual({ polarTransactionId: 'txn-123' });
    expect(delivery.canonicalWorkout).toEqual({ parts: [{ kind: 'continua', distanceKm: 5 }] });
    expect((delivery as any).polarTransactionId).toBeUndefined();
  });

  it('7. historico de tentativas de entrega nunca e perdido (falha anterior continua visivel apos nova tentativa)', async () => {
    const { prisma, seedSession } = fixture();
    seedSession('session-1');
    const service = new WorkoutDeliveryService(prisma);

    const first = await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    await service.markFailed(first.id, 'falha de rede');

    const second = await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    await service.markSent(second.id, { externalWorkoutId: 'ext-2' });

    const history = await service.listForSession('session-1');
    expect(history).toHaveLength(2);
    const failedOne = history.find((d) => d.id === first.id);
    expect(failedOne?.status).toBe('failed');
    expect(failedOne?.errorMessage).toBe('falha de rede');
  });

  it('lanca NotFoundException ao registrar tentativa para sessao inexistente', async () => {
    const { prisma } = fixture();
    const service = new WorkoutDeliveryService(prisma);

    await expect(
      service.recordAttempt({ trainingSessionId: 'nao-existe', provider: 'polar', canonicalWorkout: {} }),
    ).rejects.toThrow(NotFoundException);
  });

  it('lanca NotFoundException ao marcar como enviada/falha uma tentativa inexistente', async () => {
    const { prisma } = fixture();
    const service = new WorkoutDeliveryService(prisma);

    await expect(service.markSent('nao-existe')).rejects.toThrow(NotFoundException);
    await expect(service.markFailed('nao-existe', 'erro')).rejects.toThrow(NotFoundException);
  });

  it('delivered_to_device e um estado separado de sent, so setado explicitamente (nunca inferido)', async () => {
    const { prisma, seedSession } = fixture();
    seedSession('session-1');
    const service = new WorkoutDeliveryService(prisma);

    const delivery = await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    const sent = await service.markSent(delivery.id, { externalWorkoutId: 'ext-1' });
    expect(sent.status).toBe('sent');
    expect(sent.deliveredAt).toBeNull();

    const delivered = await service.markDeliveredToDevice(delivery.id);
    expect(delivered.status).toBe('delivered_to_device');
    expect(delivered.deliveredAt).not.toBeNull();
  });

  it('markCanceled registra cancelamento deliberado, distinto de falha', async () => {
    const { prisma, seedSession } = fixture();
    seedSession('session-1');
    const service = new WorkoutDeliveryService(prisma);

    const delivery = await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    const canceled = await service.markCanceled(delivery.id);

    expect(canceled.status).toBe('canceled');
    expect(canceled.canceledAt).not.toBeNull();
    expect(canceled.failedAt).toBeNull();
    expect(canceled.errorMessage).toBeNull();
  });

  it('nunca sobrescreve um status terminal anterior (delivered_to_device, failed ou canceled sao finais)', async () => {
    const { prisma, seedSession } = fixture();
    seedSession('session-1');
    const service = new WorkoutDeliveryService(prisma);

    const delivered = await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    await service.markSent(delivered.id);
    await service.markDeliveredToDevice(delivered.id);
    await expect(service.markFailed(delivered.id, 'tarde demais')).rejects.toThrow(BadRequestException);
    await expect(service.markCanceled(delivered.id)).rejects.toThrow(BadRequestException);

    const failed = await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    await service.markFailed(failed.id, 'erro');
    await expect(service.markSent(failed.id)).rejects.toThrow(BadRequestException);

    const canceled = await service.recordAttempt({ trainingSessionId: 'session-1', provider: 'polar', canonicalWorkout: { parts: [] } });
    await service.markCanceled(canceled.id);
    await expect(service.markDeliveredToDevice(canceled.id)).rejects.toThrow(BadRequestException);
  });
});
