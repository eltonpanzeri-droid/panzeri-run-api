import { Prisma } from '@prisma/client';
import { buildCacheReviewMessage, CACHE_REVIEW_MILESTONE_KEY, CacheMilestoneNotifierService } from '../src/ai-cost/cache-milestone-notifier.service';

// 02/11/2026 — aviso unico quando chegar a 50 pagantes confirmadas. So' avisa; nao altera a politica de cache.
describe('CacheMilestoneNotifierService', () => {
  function build(options: { count: number; existing?: boolean; createError?: unknown }) {
    const notifyCoach = jest.fn(async () => undefined);
    const create = jest.fn(async () => { if (options.createError) throw options.createError; return {}; });
    const count = jest.fn(async () => options.count);
    const prisma = { coachMilestone: { findUnique: jest.fn(async () => (options.existing ? { key: CACHE_REVIEW_MILESTONE_KEY } : null)), create }, user: { count } };
    const service = new CacheMilestoneNotifierService(prisma as never, { notifyCoach } as never);
    return { service, notifyCoach, create, count };
  }

  it('abaixo de 50 pagantes: nao grava marco nem avisa', async () => {
    const { service, notifyCoach, create } = build({ count: 49 });
    expect(await service.run()).toEqual({ payingCount: 49, notified: false });
    expect(create).not.toHaveBeenCalled();
    expect(notifyCoach).not.toHaveBeenCalled();
  });

  it('com 50 pagantes: grava o marco e avisa uma vez', async () => {
    const { service, notifyCoach, create } = build({ count: 50 });
    expect(await service.run()).toEqual({ payingCount: 50, notified: true });
    expect(create).toHaveBeenCalledWith({ data: { key: CACHE_REVIEW_MILESTONE_KEY, detail: { payingCount: 50, threshold: 50 } } });
    expect(notifyCoach).toHaveBeenCalledTimes(1);
  });

  it('marco ja gravado: nem conta alunas nem avisa de novo', async () => {
    const { service, notifyCoach, count } = build({ count: 80, existing: true });
    expect(await service.run()).toEqual({ payingCount: 0, notified: false });
    expect(count).not.toHaveBeenCalled();
    expect(notifyCoach).not.toHaveBeenCalled();
  });

  it('corrida entre dois servidores (chave ja existe): nao avisa duas vezes', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' });
    const { service, notifyCoach } = build({ count: 60, createError: duplicate });
    expect(await service.run()).toEqual({ payingCount: 60, notified: false });
    expect(notifyCoach).not.toHaveBeenCalled();
  });

  it('outro erro de banco ao gravar o marco: propaga e nao avisa', async () => {
    const { service, notifyCoach } = build({ count: 60, createError: new Error('banco fora') });
    await expect(service.run()).rejects.toThrow('banco fora');
    expect(notifyCoach).not.toHaveBeenCalled();
  });

  it('conta so quem e do grupo confirmado (active/grace), sem arquivadas', async () => {
    const { service, count } = build({ count: 10 });
    await service.run();
    expect(count).toHaveBeenCalledWith({ where: { role: 'student', isTestAccount: false, accountStatus: { not: 'archived' }, subscriptionStatus: { in: ['active', 'grace'] } } });
  });

  it('o cron nunca lanca excecao (falha de banco vira aviso no log)', async () => {
    const { service } = build({ count: 60, createError: new Error('banco fora') });
    await expect(service.checkCacheReviewMilestone()).resolves.toBeUndefined();
  });

  it('a mensagem explica o contexto, mostra a politica atual e usa o vocabulario combinado', () => {
    const text = buildCacheReviewMessage(52, '5m');
    expect(text).toContain('52 alunas com pagamento confirmado');
    expect(text).toContain('cache');
    expect(text).toContain('ligado (cache de 5 minutos)');
    expect(text).toContain('Nada foi alterado automaticamente');
    expect(text).toContain('Financeiro > Custo por prescrição');
    expect(text).toContain('Este aviso não se repete');
    expect(text).not.toMatch(/motor|plano de treino/i);
    expect(buildCacheReviewMessage(50, 'off')).toContain('desligado');
    expect(buildCacheReviewMessage(50, '1h')).toContain('1 hora');
  });
});
