import { ActivityNotificationService } from '../src/activity-execution/activity-notification.service';
import { NotificationsService } from '../src/notifications/notifications.service';

// Notificacao pos-sincronizacao (03/10/2026). Copy e deep link por classificacao; idempotencia pelo
// externalRef atividade+classificacao, exercitada com o NotificationsService REAL (so' o Prisma e o
// push sao simulados), entao o teste prova a deduplicacao de verdade, nao uma fake.

function buildPrisma(opts: { link?: { trainingSessionId: string } | null; existingNotificationRef?: boolean; startedAt?: Date; completion?: Record<string, unknown> | null } = {}) {
  return {
    // 3C.3: a notificacao resolve a identidade fisica da atividade; por padrao uma atividade unique (formato de chave original).
    activityLog: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, startedAt: opts.startedAt ?? new Date(), physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null })) },
    workoutCompletion: { findUnique: jest.fn().mockResolvedValue(opts.completion ?? null) },
    sessionExecutionLink: {
      findFirst: jest.fn().mockResolvedValue(opts.link === undefined ? { trainingSessionId: 'sess-30km' } : opts.link),
    },
    userNotification: {
      findFirst: jest.fn().mockResolvedValue(opts.existingNotificationRef ? { id: 'n-1' } : null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'n-new', ...data })),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ expoPushToken: 'ExponentPushToken[x]' }) },
  };
}

function build(opts: Parameters<typeof buildPrisma>[0] = {}) {
  const prisma = buildPrisma(opts);
  const push = { send: jest.fn().mockResolvedValue(undefined) };
  const notifications = new NotificationsService(prisma as never, push as never);
  const service = new ActivityNotificationService(prisma as never, notifications);
  return { service, prisma, push };
}

describe('ActivityNotificationService.notifyReconciliation', () => {
  it('corresponding: copy de treino sincronizado com deep link pro feedback da sessao correspondente', async () => {
    const { service, prisma } = build();
    await service.notifyReconciliation('aluno-1', 'log-1', 'corresponding');
    const created = prisma.userNotification.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      title: 'Seu treino foi sincronizado!',
      type: 'activity_sync',
      action: 'training_feedback:sess-30km',
      externalRef: 'activity-reconciled:log-1:corresponding',
    });
    expect(created.message).toContain('Complete o feedback');
  });

  it('alternative: copy de nova atividade com deep link pro feedback da alternativa', async () => {
    const { service, prisma } = build();
    await service.notifyReconciliation('aluno-1', 'log-2', 'alternative');
    expect(prisma.userNotification.create.mock.calls[0][0].data).toMatchObject({
      title: 'Nova atividade sincronizada!',
      action: 'alternative_feedback:log-2',
    });
  });

  it('ambiguous: copy de identificar atividade com deep link pra resolucao', async () => {
    const { service, prisma } = build();
    await service.notifyReconciliation('aluno-1', 'log-3', 'ambiguous');
    expect(prisma.userNotification.create.mock.calls[0][0].data).toMatchObject({
      title: 'Precisamos identificar uma atividade',
      action: 'activity_resolve:log-3',
    });
  });

  it('classificacao ausente nao notifica nada', async () => {
    const { service, prisma, push } = build();
    await expect(service.notifyReconciliation('aluno-1', 'log-4', null)).resolves.toBe(false);
    expect(prisma.userNotification.create).not.toHaveBeenCalled();
    expect(push.send).not.toHaveBeenCalled();
  });

  it('idempotente: mesma atividade+classificacao (webhook, polling, retry ou resync) nao notifica duas vezes', async () => {
    const { service, prisma, push } = build();
    await service.notifyReconciliation('aluno-1', 'log-1', 'corresponding');
    // segunda chamada: a notificacao com o mesmo externalRef ja existe
    prisma.userNotification.findFirst.mockResolvedValue({ id: 'n-1' });
    const second = await service.notifyReconciliation('aluno-1', 'log-1', 'corresponding');
    expect(second).toBe(false);
    expect(prisma.userNotification.create).toHaveBeenCalledTimes(1);
    expect(push.send).toHaveBeenCalledTimes(1);
  });

  // 05/11/2026 — Apple Saude e Health Connect passaram a avisar; como trazem historico de ate 3 anos, so' avisam de treino recente e que a aluna ainda nao comentou.
  describe('opcoes dos canais com historico (Apple Saude / Health Connect)', () => {
    const opts = { maxAgeDays: 3, skipIfFeedbackGiven: true };
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

    it('treino de ontem sem feedback: avisa com o atalho para o feedback da sessao', async () => {
      const { service, prisma, push } = build({ startedAt: daysAgo(1) });
      await expect(service.notifyReconciliation('aluno-1', 'log-1', 'corresponding', opts)).resolves.toBe(true);
      expect(prisma.userNotification.create.mock.calls[0][0].data).toMatchObject({ action: 'training_feedback:sess-30km' });
      expect(push.send).toHaveBeenCalledTimes(1);
    });

    it('historico antigo (4 dias ou mais) nao avisa: a primeira sincronizacao nao vira enxurrada', async () => {
      const { service, prisma, push } = build({ startedAt: daysAgo(40) });
      await expect(service.notifyReconciliation('aluno-1', 'log-1', 'corresponding', opts)).resolves.toBe(false);
      expect(prisma.userNotification.create).not.toHaveBeenCalled();
      expect(push.send).not.toHaveBeenCalled();
    });

    it('feedback que a aluna ja escreveu: nao cobra de novo', async () => {
      const { service, prisma } = build({ startedAt: daysAgo(0), completion: { id: 'c1', sessionId: 'sess-30km', status: 'done', perceivedEffort: 7, notes: 'cansada' } });
      await expect(service.notifyReconciliation('aluno-1', 'log-1', 'corresponding', opts)).resolves.toBe(false);
      expect(prisma.userNotification.create).not.toHaveBeenCalled();
    });

    it('registro so com campos automaticos (sem conteudo da aluna) continua sendo cobrado', async () => {
      const { service } = build({ startedAt: daysAgo(0), completion: { id: 'c1', sessionId: 'sess-30km', status: 'done', completedAt: new Date(), distanceKm: 6.6, durationMin: 40, source: 'device' } });
      await expect(service.notifyReconciliation('aluno-1', 'log-1', 'corresponding', opts)).resolves.toBe(true);
    });

    it('sem opcoes o comportamento dos outros provedores nao muda (avisa mesmo com atividade antiga)', async () => {
      const { service } = build({ startedAt: daysAgo(400) });
      await expect(service.notifyReconciliation('aluno-1', 'log-1', 'corresponding')).resolves.toBe(true);
    });
  });

  it('mudanca real de estado (ambiguous -> corresponding) gera nova notificacao: e outro evento', async () => {
    const { service, prisma } = build();
    await service.notifyReconciliation('aluno-1', 'log-5', 'ambiguous');
    await service.notifyReconciliation('aluno-1', 'log-5', 'corresponding');
    const refs = prisma.userNotification.create.mock.calls.map((c) => c[0].data.externalRef);
    expect(refs).toEqual(['activity-reconciled:log-5:ambiguous', 'activity-reconciled:log-5:corresponding']);
  });
});
