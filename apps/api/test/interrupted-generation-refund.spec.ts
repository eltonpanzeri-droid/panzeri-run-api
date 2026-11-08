import { INTERRUPTED_ATTEMPT_WINDOW_MS, TrainingPlansService } from '../src/training-plans/training-plans.service';

// 08/11/2026 (caso Brenda): deploy no meio da geracao gastava a tentativa e a aluna ficava com "tentativas esgotadas" sem ter tentado de verdade.
const NOW = new Date('2026-11-08T17:59:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function build(users: Array<{ id: string; generationAttemptsUsed: number; lastGenerationAttemptAt: Date | null }>, plans: Array<{ userId: string; createdAt: Date }> = []) {
  const state = users.map((u) => ({ ...u }));
  const prisma: any = {
    user: {
      findMany: jest.fn(async ({ where }: any) => state.filter((u) => u.generationAttemptsUsed >= where.generationAttemptsUsed.gte && u.lastGenerationAttemptAt && u.lastGenerationAttemptAt >= where.lastGenerationAttemptAt.gte).map((u) => ({ ...u }))), // copias, como o banco
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = state.find((u) => u.id === where.id && u.generationAttemptsUsed === where.generationAttemptsUsed && u.lastGenerationAttemptAt?.getTime() === where.lastGenerationAttemptAt.getTime());
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    trainingPlan: { findFirst: jest.fn(async ({ where }: any) => plans.find((p) => p.userId === where.userId && p.createdAt >= where.createdAt.gte) ?? null) },
  };
  const service = new (TrainingPlansService as any)(prisma) as TrainingPlansService;
  return { service, state, prisma };
}

describe('devolucao da tentativa de geracao interrompida por reinicio', () => {
  it('quem comecou a gerar ha poucos minutos e nao tem programa novo recebe a tentativa de volta (e o intervalo de espera zera)', async () => {
    const t = build([{ id: 'brenda', generationAttemptsUsed: 2, lastGenerationAttemptAt: minutesAgo(3) }]);
    expect(await t.service.refundInterruptedGenerationAttempts(NOW)).toBe(1);
    expect(t.state[0]).toMatchObject({ generationAttemptsUsed: 1, lastGenerationAttemptAt: null });
  });
  it('se o programa foi criado depois do inicio da tentativa, a geracao terminou: nada e devolvido', async () => {
    const t = build([{ id: 'u', generationAttemptsUsed: 1, lastGenerationAttemptAt: minutesAgo(4) }], [{ userId: 'u', createdAt: minutesAgo(2) }]);
    expect(await t.service.refundInterruptedGenerationAttempts(NOW)).toBe(0);
    expect(t.state[0].generationAttemptsUsed).toBe(1);
  });
  it('tentativa antiga (fora da janela de 8 minutos) nao e mexida: falha de verdade continua contando', async () => {
    const t = build([{ id: 'u', generationAttemptsUsed: 2, lastGenerationAttemptAt: minutesAgo(INTERRUPTED_ATTEMPT_WINDOW_MS / 60_000 + 5) }]);
    expect(await t.service.refundInterruptedGenerationAttempts(NOW)).toBe(0);
    expect(t.state[0].generationAttemptsUsed).toBe(2);
  });
  it('quem nunca tentou (contador zero ou sem hora) nao e tocado; devolve no maximo UMA tentativa por reinicio', async () => {
    const t = build([{ id: 'a', generationAttemptsUsed: 0, lastGenerationAttemptAt: minutesAgo(1) }, { id: 'b', generationAttemptsUsed: 1, lastGenerationAttemptAt: null }, { id: 'c', generationAttemptsUsed: 1, lastGenerationAttemptAt: minutesAgo(2) }]);
    expect(await t.service.refundInterruptedGenerationAttempts(NOW)).toBe(1);
    expect(t.state.map((u) => u.generationAttemptsUsed)).toEqual([0, 1, 0]);
    expect(await t.service.refundInterruptedGenerationAttempts(NOW)).toBe(0); // segunda chamada: lastGenerationAttemptAt ja' foi zerado
  });
  it('corrida entre dois reinicios: so devolve se o contador e a hora ainda forem os lidos (nao devolve duas vezes)', async () => {
    const t = build([{ id: 'u', generationAttemptsUsed: 2, lastGenerationAttemptAt: minutesAgo(3) }]);
    const original = t.prisma.user.findMany;
    t.prisma.user.findMany = jest.fn(async (args: any) => { const rows = await original(args); t.state[0].generationAttemptsUsed = 1; return rows; }); // outro processo ja' mexeu
    expect(await t.service.refundInterruptedGenerationAttempts(NOW)).toBe(0);
    expect(t.state[0].generationAttemptsUsed).toBe(1);
  });
  it('a conferencia na subida nunca derruba o servidor, mesmo se o banco falhar', async () => {
    const t = build([]);
    t.prisma.user.findMany = jest.fn(async () => { throw new Error('banco fora'); });
    await expect(t.service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
