import { PrismaService } from '../src/prisma/prisma.service';
import { ShoesService } from '../src/shoes/shoes.service';
import { ActivityNotificationService } from '../src/activity-execution/activity-notification.service';
import { NotificationsService } from '../src/notifications/notifications.service';

// 3C.3 — Shoes e notificacoes de atividade: a unidade e' o PhysicalEvent (observacao canonica da 3A), nao cada observacao/provider.
const ev = (eventId: string, canonicalId: string) => ({ physicalIdentityStatus: 'matched', physicalEventId: eventId, physicalCanonicalActivityLogId: canonicalId });
const log = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, userId: 'u1', distanceMeters: 10000, physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null, ...overrides,
}) as Record<string, any>;

describe('3C.3 — Shoes: distancia da observacao canonica', () => {
  function build(options: { activities: Array<Record<string, any>>; links: Array<Record<string, any>>; completionDistanceKm?: number | null; sessionId?: string | null }) {
    const shoe = { id: 'shoe-1', userId: 'u1', brand: 'B', model: 'M', nickname: null, photoUrl: null, status: 'active', startedUsingAt: new Date('2026-01-01'), retiredAt: null };
    const completion = { id: 'c1', sessionId: options.sessionId === undefined ? 's1' : options.sessionId, completedAt: new Date('2026-09-30T10:00:00Z'), distanceKm: options.completionDistanceKm ?? null, status: 'done' };
    const prisma = {
      shoe: { findMany: jest.fn(async () => [shoe]), findFirst: jest.fn(async () => shoe) },
      shoeUsage: { findMany: jest.fn(async () => [{ id: 'u', shoeId: 'shoe-1', workoutCompletionId: 'c1', workoutCompletion: completion }]) },
      sessionExecutionLink: {
        findFirst: jest.fn(async ({ where }: any) => {
          const row = options.links.find((l) => l.trainingSessionId === where.trainingSessionId && l.status === where.status);
          return row ? { ...row, activityLog: options.activities.find((a) => a.id === row.activityLogId) } : null;
        }),
      },
      activityLog: { findMany: jest.fn(async ({ where }: any) => options.activities.filter((a) => a.userId === where.userId && where.id.in.includes(a.id))) },
    };
    return { service: new ShoesService(prisma as unknown as PrismaService), prisma };
  }
  const link = (activityLogId: string, extra: Record<string, unknown> = {}) => ({ trainingSessionId: 's1', activityLogId, status: 'active', userId: 'u1', origin: 'automatic', ...extra });
  const km = async (service: ShoesService) => (await service.list('u1')).active[0].totalDistanceKm;

  it('Polar + Apple do mesmo evento: UMA distancia (a da canonica), vinculo na canonica', async () => {
    const polar = log('polar-1', { ...ev('e1', 'polar-1'), distanceMeters: 10020 });
    const apple = log('apple-1', { ...ev('e1', 'polar-1'), distanceMeters: 10300 });
    const { service } = build({ activities: [polar, apple], links: [link('polar-1')] });
    expect(await km(service)).toBe(10.02);
  });

  it('vinculo legado/humano na observacao NAO canonica: a distancia vem da canonica e o vinculo nao e alterado', async () => {
    const polar = log('polar-1', { ...ev('e1', 'polar-1'), distanceMeters: 10020 });
    const apple = log('apple-1', { ...ev('e1', 'polar-1'), distanceMeters: 10300 });
    const humanLink = link('apple-1', { origin: 'coach' });
    const { service } = build({ activities: [polar, apple], links: [humanLink] });
    expect(await km(service)).toBe(10.02);
    expect(humanLink).toMatchObject({ activityLogId: 'apple-1', origin: 'coach', status: 'active' });
  });

  it('atividade unique continua funcionando', async () => {
    const { service } = build({ activities: [log('u-1', { distanceMeters: 8000 })], links: [link('u-1')] });
    expect(await km(service)).toBe(8);
  });

  it('sem distancia objetiva: cai no que o aluno digitou (fallback manual); sem vinculo tambem', async () => {
    const polar = log('polar-1', { ...ev('e1', 'polar-1'), distanceMeters: null });
    expect(await km(build({ activities: [polar], links: [link('polar-1')], completionDistanceKm: 7.5 }).service)).toBe(7.5);
    expect(await km(build({ activities: [], links: [], completionDistanceKm: 6 }).service)).toBe(6);
  });

  it('sessao sintetica device_extra (sem vinculo ativo) segue usando a distancia registrada na propria completion', async () => {
    const { service } = build({ activities: [log('polar-1', { ...ev('e1', 'polar-1'), distanceMeters: 10020 })], links: [], completionDistanceKm: 10 });
    expect(await km(service)).toBe(10);
  });

  it('nao atribui quilometros a tenis nao selecionado: sem ShoeUsage nada e somado', async () => {
    const { service, prisma } = build({ activities: [log('u-1')], links: [link('u-1')] });
    prisma.shoeUsage.findMany.mockResolvedValueOnce([]);
    expect(await km(service)).toBe(0);
  });
});

describe('3C.3 — Notificacoes de atividade: uma por PhysicalEvent', () => {
  function build(activities: Array<Record<string, any>>, linkSessionId: string | null = 's1') {
    const created: Array<Record<string, any>> = [];
    const prisma = {
      activityLog: { findUnique: jest.fn(async ({ where }: any) => activities.find((a) => a.id === where.id) ?? null) },
      sessionExecutionLink: { findFirst: jest.fn(async () => (linkSessionId ? { trainingSessionId: linkSessionId } : null)) },
      userNotification: {
        findFirst: jest.fn(async ({ where }: any) => created.find((n) => n.userId === where.userId && n.type === where.type && n.externalRef === where.externalRef) ?? null),
        create: jest.fn(async ({ data }: any) => { const row = { id: `n-${created.length + 1}`, ...data }; created.push(row); return row; }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ expoPushToken: 'ExponentPushToken[x]' }) },
    };
    const notifications = new NotificationsService(prisma as never, { send: jest.fn().mockResolvedValue(undefined) } as never);
    return { service: new ActivityNotificationService(prisma as never, notifications), created, prisma, setSession: (id: string | null) => { linkSessionId = id; } };
  }
  const polar = () => log('polar-1', ev('e1', 'polar-1'));
  const apple = () => log('apple-1', ev('e1', 'polar-1'));

  it('Polar + Apple do mesmo evento: UMA notificacao; so a canonica origina, a copia nao notifica', async () => {
    const { service, created } = build([polar(), apple()]);
    expect(await service.notifyReconciliation('u1', 'apple-1', 'corresponding')).toBe(false);
    expect(await service.notifyReconciliation('u1', 'polar-1', 'corresponding')).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].externalRef).toBe('activity-reconciled:event:e1:corresponding:s1');
  });

  it('chegada posterior da copia: nenhuma segunda notificacao (a canonica ja foi notificada como atividade unique, formato original)', async () => {
    const { service, created } = build([log('polar-1'), log('apple-1')]);
    expect(await service.notifyReconciliation('u1', 'polar-1', 'corresponding')).toBe(true); // Polar chegou sozinha
    expect(created[0].externalRef).toBe('activity-reconciled:polar-1:corresponding'); // formato original preservado para unique
    // a copia chega e o evento passa a existir
    const rows = [polar(), apple()];
    const next = build(rows);
    next.created.push(created[0]);
    expect(await next.service.notifyReconciliation('u1', 'apple-1', 'corresponding')).toBe(false);
    expect(await next.service.notifyReconciliation('u1', 'polar-1', 'corresponding')).toBe(false); // resync/webhook da Polar: ja notificado
    expect(next.created).toHaveLength(1);
  });

  it('atividade unique continua notificando; nova chamada identica nao repete', async () => {
    const { service, created } = build([log('u-1')]);
    expect(await service.notifyReconciliation('u1', 'u-1', 'corresponding')).toBe(true);
    expect(await service.notifyReconciliation('u1', 'u-1', 'corresponding')).toBe(false);
    expect(created).toHaveLength(1);
  });

  it('atividade adicional (alternative) continua gerando sua notificacao, uma por evento', async () => {
    const { service, created } = build([polar(), apple()], null);
    expect(await service.notifyReconciliation('u1', 'polar-1', 'alternative')).toBe(true);
    expect(await service.notifyReconciliation('u1', 'apple-1', 'alternative')).toBe(false);
    expect(await service.notifyReconciliation('u1', 'polar-1', 'alternative')).toBe(false);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ title: 'Nova atividade sincronizada!', action: 'alternative_feedback:polar-1', externalRef: 'activity-reconciled:event:e1:alternative' });
  });

  it('transicao legitima gera nova notificacao: ambiguous -> corresponding, e corresponding a OUTRA sessao; a mesma transicao nao repete', async () => {
    const f = build([polar(), apple()], null);
    expect(await f.service.notifyReconciliation('u1', 'polar-1', 'ambiguous')).toBe(true);
    f.setSession('s1');
    expect(await f.service.notifyReconciliation('u1', 'polar-1', 'corresponding')).toBe(true);
    expect(await f.service.notifyReconciliation('u1', 'polar-1', 'corresponding')).toBe(false);
    f.setSession('s2'); // vinculo movido para outra sessao: outra transicao semantica
    expect(await f.service.notifyReconciliation('u1', 'polar-1', 'corresponding')).toBe(true);
    expect(f.created.map((n) => n.externalRef)).toEqual([
      'activity-reconciled:event:e1:ambiguous',
      'activity-reconciled:event:e1:corresponding:s1',
      'activity-reconciled:event:e1:corresponding:s2',
    ]);
  });

  it('a canonica do evento muda depois (Apple vira canonica): o mesmo evento e a mesma transicao nao notificam de novo', async () => {
    const f = build([polar(), apple()]);
    expect(await f.service.notifyReconciliation('u1', 'polar-1', 'corresponding')).toBe(true);
    const switched = [log('polar-1', ev('e1', 'apple-1')), log('apple-1', ev('e1', 'apple-1'))];
    const next = build(switched);
    next.created.push(...f.created);
    expect(await next.service.notifyReconciliation('u1', 'apple-1', 'corresponding')).toBe(false);
    expect(next.created).toHaveLength(1);
  });
});
