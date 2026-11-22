import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkoutCompletionsService } from '../src/workout-completions/workout-completions.service';

// 22/11/2026 — "Cancelar feedback": o treino volta a ficar sem registro; o que a aluna escreveu fica guardado como versao; o vinculo com a atividade nao muda.
const completion = { id: 'c1', userId: 'u1', sessionId: 's1', status: 'done', perceivedEffort: 6, notes: 'foi bem', details: {} };
const session = (over: Record<string, unknown> = {}) => ({ id: 's1', userId: 'u1', origin: 'agent', scheduledDate: new Date('2026-11-21T00:00:00.000Z'), completion, ...over });

function build(found: Record<string, unknown> | null) {
  const calls: string[] = [];
  const tx = {
    workoutFeedbackVersion: { create: jest.fn(async () => { calls.push('version'); }) },
    shoeUsage: { deleteMany: jest.fn(async () => { calls.push('shoe'); }) },
    workoutCompletion: { delete: jest.fn(async () => { calls.push('delete'); }) },
  };
  const prisma = { trainingSession: { findFirst: jest.fn(async () => found) }, $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)) };
  const link = { recomputeAfterCorrection: jest.fn(async () => { calls.push('recompute'); }) };
  const service = new WorkoutCompletionsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, link as never);
  return { service, prisma, tx, link, calls };
}

describe('cancelar feedback do treino', () => {
  it('guarda o texto como versao, tira o uso do tenis, apaga o registro e refaz as analises (nessa ordem)', async () => {
    const h = build(session());
    const result = await h.service.cancel('u1', 's1');
    expect(result).toEqual({ cancelled: true, sessionId: 's1', preservedAsVersion: true });
    expect(h.calls).toEqual(['version', 'shoe', 'delete', 'recompute']);
    expect(h.tx.workoutFeedbackVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u1', sessionId: 's1', reason: 'cancelled_by_student' }) });
    expect(h.link.recomputeAfterCorrection).toHaveBeenCalledWith('u1', expect.any(Date), expect.objectContaining({ sessionIds: ['s1'], completionsChanged: true, affectedDates: ['2026-11-21'] }));
  });
  it('procura o treino pelo dono: treino de outra conta nao existe (404) e nada e apagado', async () => {
    const h = build(null);
    await expect(h.service.cancel('intruso', 's1')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.prisma.trainingSession.findFirst).toHaveBeenCalledWith({ where: { id: 's1', userId: 'intruso' }, include: { completion: true } });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('treino sem feedback: 404 (nada a cancelar), sem transacao', async () => {
    const h = build(session({ completion: null }));
    await expect(h.service.cancel('u1', 's1')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('treino extra (nasce da atividade): recusa e orienta; nada e apagado', async () => {
    for (const origin of ['device_extra', 'student_extra']) {
      const h = build(session({ origin }));
      await expect(h.service.cancel('u1', 's1')).rejects.toBeInstanceOf(BadRequestException);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    }
  });
});
