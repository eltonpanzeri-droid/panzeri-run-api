import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { ShoesService } from '../src/shoes/shoes.service';

// Mock de Prisma em memoria real (Map), mesmo padrao de session-execution-link.spec.ts.
function fixture() {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const shoes = new Map<string, any>();
  const shoeUsages = new Map<string, any>();
  const workoutCompletions = new Map<string, any>();
  const trainingSessions = new Map<string, any>();
  const sessionExecutionLinks = new Map<string, any>();
  const activityLogs = new Map<string, any>();

  const prisma = {
    shoe: {
      findMany: jest.fn(async ({ where }: any) => [...shoes.values()].filter((s) => s.userId === where.userId && (!where.status || s.status === where.status))),
      findFirst: jest.fn(async ({ where }: any) => [...shoes.values()].find((s) => s.id === where.id && s.userId === where.userId) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId('shoe'), status: 'active', retiredAt: null, nickname: null, photoUrl: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        shoes.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...shoes.get(where.id), ...data };
        shoes.set(where.id, row);
        return row;
      }),
    },
    shoeUsage: {
      findFirst: jest.fn(async ({ where }: any) => [...shoeUsages.values()].find((u) => u.workoutCompletionId === where.workoutCompletionId && u.userId === where.userId) ?? null),
      findMany: jest.fn(async ({ where, include }: any) => {
        const rows = [...shoeUsages.values()].filter((u) => u.shoeId === where.shoeId);
        if (!include?.workoutCompletion) return rows;
        return rows.map((u) => ({ ...u, workoutCompletion: workoutCompletions.get(u.workoutCompletionId) }));
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = [...shoeUsages.values()].find((u) => u.workoutCompletionId === where.workoutCompletionId);
        if (existing) {
          const row = { ...existing, ...update };
          shoeUsages.set(row.id, row);
          return row;
        }
        const row = { id: nextId('usage'), createdAt: new Date(), updatedAt: new Date(), ...create };
        shoeUsages.set(row.id, row);
        return row;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const toDelete = [...shoeUsages.values()].filter((u) => u.workoutCompletionId === where.workoutCompletionId);
        for (const row of toDelete) shoeUsages.delete(row.id);
        return { count: toDelete.length };
      }),
    },
    workoutCompletion: {
      findFirst: jest.fn(async ({ where }: any) => [...workoutCompletions.values()].find((c) => c.id === where.id && c.userId === where.userId) ?? null),
    },
    sessionExecutionLink: {
      findFirst: jest.fn(async ({ where }: any) => {
        const row = [...sessionExecutionLinks.values()].find((l) => l.trainingSessionId === where.trainingSessionId && l.status === where.status);
        if (!row) return null;
        return { ...row, activityLog: activityLogs.get(row.activityLogId) };
      }),
    },
  };

  const service = new ShoesService(prisma as unknown as PrismaService);

  function addShoe(overrides: Partial<any> = {}) {
    const row = { id: nextId('shoe'), userId: 'user-a', brand: 'ASICS', model: 'Novablast 5', nickname: null, photoUrl: null, status: 'active', retiredAt: null, startedUsingAt: new Date('2026-09-01T00:00:00Z'), createdAt: new Date(), updatedAt: new Date(), ...overrides };
    shoes.set(row.id, row);
    return row;
  }

  function addCompletion(overrides: Partial<any> = {}) {
    const row = { id: nextId('completion'), userId: 'user-a', sessionId: null, status: 'done', distanceKm: null, completedAt: new Date('2026-10-01T10:00:00Z'), ...overrides };
    workoutCompletions.set(row.id, row);
    return row;
  }

  function addSession(overrides: Partial<any> = {}) {
    const row = { id: nextId('session'), userId: 'user-a', ...overrides };
    trainingSessions.set(row.id, row);
    return row;
  }

  function addActivityLog(overrides: Partial<any> = {}) {
    const row = { id: nextId('activity'), distanceMeters: null, ...overrides };
    activityLogs.set(row.id, row);
    return row;
  }

  function addActiveLink(trainingSessionId: string, activityLogId: string) {
    const row = { id: nextId('link'), trainingSessionId, activityLogId, status: 'active', createdAt: new Date() };
    sessionExecutionLinks.set(row.id, row);
    return row;
  }

  return { service, shoes, shoeUsages, workoutCompletions, addShoe, addCompletion, addSession, addActivityLog, addActiveLink };
}

describe('ShoesService', () => {
  it('Caso A: cadastra um tenis novo e ele aparece entre os ativos', async () => {
    const { service } = fixture();
    await service.create('user-a', { brand: 'ASICS', model: 'Novablast 5', startedUsingAt: '2026-09-01' });
    const { active, retired } = await service.list('user-a');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ brand: 'ASICS', model: 'Novablast 5', workoutsCount: 0, totalDistanceKm: 0, averageKmPerWorkout: null });
    expect(retired).toHaveLength(0);
  });

  it('Caso B/C: feedback de corrida objetiva vinculado ao tenis -> +1 treino e +10km', async () => {
    const { service, addShoe, addCompletion, addSession, addActivityLog, addActiveLink } = fixture();
    const shoe = addShoe();
    const session = addSession({ modality: 'corrida' });
    const activity = addActivityLog({ distanceMeters: 10000 });
    addActiveLink(session.id, activity.id);
    const completion = addCompletion({ sessionId: session.id });

    await service.setUsage('user-a', completion.id, shoe.id);
    const detail = await service.detail('user-a', shoe.id);

    expect(detail.workoutsCount).toBe(1);
    expect(detail.totalDistanceKm).toBe(10);
  });

  it('Caso D: segunda corrida de 8km -> total passa para 18km e 2 treinos', async () => {
    const { service, addShoe, addCompletion, addSession, addActivityLog, addActiveLink } = fixture();
    const shoe = addShoe();

    const session1 = addSession({ modality: 'corrida' });
    const activity1 = addActivityLog({ distanceMeters: 10000 });
    addActiveLink(session1.id, activity1.id);
    const completion1 = addCompletion({ sessionId: session1.id });
    await service.setUsage('user-a', completion1.id, shoe.id);

    const session2 = addSession({ modality: 'corrida' });
    const activity2 = addActivityLog({ distanceMeters: 8000 });
    addActiveLink(session2.id, activity2.id);
    const completion2 = addCompletion({ sessionId: session2.id });
    await service.setUsage('user-a', completion2.id, shoe.id);

    const detail = await service.detail('user-a', shoe.id);
    expect(detail.workoutsCount).toBe(2);
    expect(detail.totalDistanceKm).toBe(18);
    expect(detail.averageKmPerWorkout).toBe(9);
  });

  it('Caso E: corrigir a segunda atividade para outro tenis — primeiro volta a 10km/1 treino, segundo passa a 8km/1 treino', async () => {
    const { service, addShoe, addCompletion, addSession, addActivityLog, addActiveLink } = fixture();
    const shoeA = addShoe({ brand: 'ASICS' });
    const shoeB = addShoe({ brand: 'Nike' });

    const session1 = addSession({ modality: 'corrida' });
    const activity1 = addActivityLog({ distanceMeters: 10000 });
    addActiveLink(session1.id, activity1.id);
    const completion1 = addCompletion({ sessionId: session1.id });
    await service.setUsage('user-a', completion1.id, shoeA.id);

    const session2 = addSession({ modality: 'corrida' });
    const activity2 = addActivityLog({ distanceMeters: 8000 });
    addActiveLink(session2.id, activity2.id);
    const completion2 = addCompletion({ sessionId: session2.id });
    await service.setUsage('user-a', completion2.id, shoeA.id);

    // Correcao: segunda atividade na verdade foi com o outro tenis
    await service.setUsage('user-a', completion2.id, shoeB.id);

    const detailA = await service.detail('user-a', shoeA.id);
    const detailB = await service.detail('user-a', shoeB.id);
    expect(detailA.workoutsCount).toBe(1);
    expect(detailA.totalDistanceKm).toBe(10);
    expect(detailB.workoutsCount).toBe(1);
    expect(detailB.totalDistanceKm).toBe(8);
  });

  it('Caso F: tenis aposentado mantem historico mas sai da lista de ativos/picker', async () => {
    const { service, addShoe, addCompletion, addSession, addActivityLog, addActiveLink } = fixture();
    const shoe = addShoe();
    const session = addSession({ modality: 'corrida' });
    const activity = addActivityLog({ distanceMeters: 5000 });
    addActiveLink(session.id, activity.id);
    const completion = addCompletion({ sessionId: session.id });
    await service.setUsage('user-a', completion.id, shoe.id);

    await service.retire('user-a', shoe.id);

    const { active, retired } = await service.list('user-a');
    expect(active).toHaveLength(0);
    expect(retired).toHaveLength(1);
    expect(retired[0].workoutsCount).toBe(1); // historico preservado
    expect(retired[0].totalDistanceKm).toBe(5);

    const picker = await service.listActiveForPicker('user-a');
    expect(picker).toHaveLength(0);
  });

  it('Caso G: corrida alternativa (sessao sintetica device_extra) tambem conta pro tenis', async () => {
    const { service, addShoe, addCompletion, addSession, addActivityLog, addActiveLink } = fixture();
    const shoe = addShoe();
    // Sessao sintetica materializada a partir de ActivityLog 'alternative' — mesma estrutura,
    // so' origin diferente; nao deve impedir a contagem.
    const session = addSession({ modality: 'corrida', origin: 'device_extra' });
    const activity = addActivityLog({ distanceMeters: 6000 });
    addActiveLink(session.id, activity.id);
    const completion = addCompletion({ sessionId: session.id, status: 'done' });
    await service.setUsage('user-a', completion.id, shoe.id);

    const detail = await service.detail('user-a', shoe.id);
    expect(detail.workoutsCount).toBe(1);
    expect(detail.totalDistanceKm).toBe(6);
  });

  it('Caso H: atividade sem distancia conhecida conta como treino mas nao inventa km', async () => {
    const { service, addShoe, addCompletion, addSession } = fixture();
    const shoe = addShoe();
    const session = addSession({ modality: 'corrida' });
    const completion = addCompletion({ sessionId: session.id, distanceKm: null }); // sem link, sem distanceKm manual
    await service.setUsage('user-a', completion.id, shoe.id);

    const detail = await service.detail('user-a', shoe.id);
    expect(detail.workoutsCount).toBe(1);
    expect(detail.totalDistanceKm).toBe(0); // nada somado, nunca inventado
    expect(detail.averageKmPerWorkout).toBeNull(); // null, nunca 0 fabricado
  });

  it('Caso I: reabrir feedback ja salvo — tenis escolhido anteriormente e recuperavel', async () => {
    const { service, addShoe, addCompletion, addSession } = fixture();
    const shoe = addShoe();
    const session = addSession({ modality: 'corrida' });
    const completion = addCompletion({ sessionId: session.id });
    await service.setUsage('user-a', completion.id, shoe.id);

    const usage = await service.getUsageForCompletion('user-a', completion.id);
    expect(usage?.shoeId).toBe(shoe.id);
  });

  it('fonte de distancia: ActivityLog canonico tem prioridade sobre WorkoutCompletion.distanceKm digitado manualmente', async () => {
    const { service, addShoe, addCompletion, addSession, addActivityLog, addActiveLink } = fixture();
    const shoe = addShoe();
    const session = addSession({ modality: 'corrida' });
    const activity = addActivityLog({ distanceMeters: 10000 }); // 10km reais do relogio
    addActiveLink(session.id, activity.id);
    const completion = addCompletion({ sessionId: session.id, distanceKm: 7.5 }); // aluno digitou errado/diferente
    await service.setUsage('user-a', completion.id, shoe.id);

    const detail = await service.detail('user-a', shoe.id);
    expect(detail.totalDistanceKm).toBe(10); // prevalece o canonico, nao o digitado
  });

  it('atividade manual sem ActivityLog usa WorkoutCompletion.distanceKm como unica fonte disponivel', async () => {
    const { service, addShoe, addCompletion, addSession } = fixture();
    const shoe = addShoe();
    const session = addSession({ modality: 'corrida' });
    const completion = addCompletion({ sessionId: session.id, distanceKm: 12.3 }); // sem link/ActivityLog
    await service.setUsage('user-a', completion.id, shoe.id);

    const detail = await service.detail('user-a', shoe.id);
    expect(detail.totalDistanceKm).toBe(12.3);
  });

  it('nao conta "missed" como treino (sessao nao realizada)', async () => {
    const { service, addShoe, addCompletion, addSession } = fixture();
    const shoe = addShoe();
    const session = addSession({ modality: 'corrida' });
    const completion = addCompletion({ sessionId: session.id, status: 'missed', distanceKm: 5 });
    await service.setUsage('user-a', completion.id, shoe.id);

    const detail = await service.detail('user-a', shoe.id);
    expect(detail.workoutsCount).toBe(0);
  });

  it('setUsage(null) remove a associacao sem apagar a execucao', async () => {
    const { service, addShoe, addCompletion, addSession, addActivityLog, addActiveLink } = fixture();
    const shoe = addShoe();
    const session = addSession({ modality: 'corrida' });
    const activity = addActivityLog({ distanceMeters: 5000 });
    addActiveLink(session.id, activity.id);
    const completion = addCompletion({ sessionId: session.id });
    await service.setUsage('user-a', completion.id, shoe.id);
    await service.setUsage('user-a', completion.id, null);

    const detail = await service.detail('user-a', shoe.id);
    expect(detail.workoutsCount).toBe(0);
    const usage = await service.getUsageForCompletion('user-a', completion.id);
    expect(usage).toBeNull();
  });

  it('rejeita vincular tenis de outro aluno (checagem de posse)', async () => {
    const { service, addCompletion, addSession } = fixture();
    const session = addSession({ modality: 'corrida' });
    const completion = addCompletion({ sessionId: session.id });
    await expect(service.setUsage('user-a', completion.id, 'shoe-inexistente')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('retire() e idempotente (chamar duas vezes nao quebra nem reseta retiredAt)', async () => {
    const { service, addShoe } = fixture();
    const shoe = addShoe();
    const first = await service.retire('user-a', shoe.id);
    const second = await service.retire('user-a', shoe.id);
    expect(first.status).toBe('retired');
    expect(second.status).toBe('retired');
  });
});
