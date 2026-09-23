import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RecordEventDto } from '../src/funnel/funnel.controller';
import { FunnelService } from '../src/funnel/funnel.service';

const validationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

const bodyMetadata = { type: 'body' as const, metatype: RecordEventDto };

describe('internal funnel analytics', () => {
  it('accepts the complete valid payload currently sent by trackFunnel', async () => {
    await expect(validationPipe.transform({
      sessionId: '3f85c381-9d30-4f55-b172-7cb0dc7f9477',
      event: 'question_error',
      userId: '1abfb8f1-d5dd-493f-8317-a5fd7c8fd47d',
      questionId: 'personal_weight',
      metadata: { step: 3, errorMessage: 'network_error' },
    }, bodyMetadata)).resolves.toMatchObject({
      event: 'question_error',
      questionId: 'personal_weight',
    });
  });

  it('rejects invalid and unexpected properties with the global API rules', async () => {
    await expect(validationPipe.transform({
      sessionId: '',
      event: 'invalid-event',
      unexpected: true,
    }, bodyMetadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes a valid event to FunnelEvent', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'event-1' });
    const prisma = { funnelEvent: { create } };
    const service = new FunnelService(prisma as never, {} as never);

    await service.record({
      sessionId: '3f85c381-9d30-4f55-b172-7cb0dc7f9477',
      event: 'signup_completed',
      userId: '1abfb8f1-d5dd-493f-8317-a5fd7c8fd47d',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        sessionId: '3f85c381-9d30-4f55-b172-7cb0dc7f9477',
        journeyId: null,
        event: 'signup_completed',
        userId: '1abfb8f1-d5dd-493f-8317-a5fd7c8fd47d',
        questionId: null,
        metadata: undefined,
        dedupeKey: null,
      },
    });
  });
});

// 23/09: regressao do caso real "Mariana" — aluna que ja tinha terminado a entrevista e pago, mas
// continuava aparecendo em "pessoas paradas na entrevista" porque o evento interview_completed nunca
// foi gravado no FunnelEvent (so' o historico de eventos era consultado). getReport() agora reconcilia
// contra o estado real (OnboardingInterview.completedAt / subscriptionStatus) antes de decidir quem
// esta' realmente parada.
describe('FunnelService.getReport — reconciliacao de sessoes paradas contra o estado real', () => {
  function buildPrismaMock(overrides: {
    signedUpSessions: Array<{ sessionId: string; userId: string | null; createdAt: Date }>;
    completedInterviewSessionIds: string[];
    usersRealState: Array<{ id: string; subscriptionStatus: string; subscriptionManualOverride: boolean; onboardingInterview: { completedAt: Date | null } | null }>;
  }) {
    const funnelEventFindMany = jest.fn().mockImplementation(({ where }: any) => {
      if (where.event === 'signup_completed') return Promise.resolve(overrides.signedUpSessions);
      if (where.event === 'interview_completed') {
        return Promise.resolve(
          overrides.completedInterviewSessionIds
            .filter((id) => where.sessionId.in.includes(id))
            .map((sessionId) => ({ sessionId })),
        );
      }
      return Promise.resolve([]);
    });
    const prisma = {
      funnelEvent: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: funnelEventFindMany,
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: {
        findMany: jest.fn().mockResolvedValue(overrides.usersRealState),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    return prisma;
  }

  it('nao lista uma aluna que ja terminou a entrevista de verdade, mesmo sem o evento interview_completed', async () => {
    const marianaId = 'user-mariana';
    const prisma = buildPrismaMock({
      signedUpSessions: [{ sessionId: 'session-mariana', userId: marianaId, createdAt: new Date() }],
      completedInterviewSessionIds: [], // o evento nunca foi gravado — exatamente o bug relatado
      usersRealState: [
        { id: marianaId, subscriptionStatus: 'active', subscriptionManualOverride: false, onboardingInterview: { completedAt: new Date('2026-09-01') } },
      ],
    });
    const service = new FunnelService(prisma as never, {} as never);

    const report = await service.getReport(30);

    expect(report.stalledSessions.map((s) => s.sessionId)).not.toContain('session-mariana');
  });

  it('nao lista quem ja tem acesso pago mesmo sem completedAt registrado na entrevista', async () => {
    const userId = 'user-pagante-sem-completedat';
    const prisma = buildPrismaMock({
      signedUpSessions: [{ sessionId: 'session-x', userId, createdAt: new Date() }],
      completedInterviewSessionIds: [],
      usersRealState: [
        { id: userId, subscriptionStatus: 'active', subscriptionManualOverride: false, onboardingInterview: null },
      ],
    });
    const service = new FunnelService(prisma as never, {} as never);

    const report = await service.getReport(30);

    expect(report.stalledSessions.map((s) => s.sessionId)).not.toContain('session-x');
  });

  it('continua listando quem realmente nao terminou a entrevista nem pagou', async () => {
    const userId = 'user-realmente-parado';
    const prisma = buildPrismaMock({
      signedUpSessions: [{ sessionId: 'session-real', userId, createdAt: new Date() }],
      completedInterviewSessionIds: [],
      usersRealState: [
        { id: userId, subscriptionStatus: 'pending', subscriptionManualOverride: false, onboardingInterview: null },
      ],
    });
    const service = new FunnelService(prisma as never, {} as never);

    const report = await service.getReport(30);

    expect(report.stalledSessions.map((s) => s.sessionId)).toContain('session-real');
  });

  it('mantem sessao anonima (sem userId vinculado) na lista, sem tentar reconciliar', async () => {
    const prisma = buildPrismaMock({
      signedUpSessions: [{ sessionId: 'session-anon', userId: null, createdAt: new Date() }],
      completedInterviewSessionIds: [],
      usersRealState: [],
    });
    const service = new FunnelService(prisma as never, {} as never);

    const report = await service.getReport(30);

    expect(report.stalledSessions.map((s) => s.sessionId)).toContain('session-anon');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
