import { PrismaService } from '../src/prisma/prisma.service';
import { SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';

// Visualizacao Prescrito x Realizado (02/10/2026) — getWeekReconciliation() e' pura agregacao de
// estado ja' decidido por classify()/linkManually()/confirmCandidate(); estes testes cobrem so' a
// agregacao (nunca redecide classificacao), incluindo o deduplicador de TrainingSession sintetica
// 'device_extra' (ver instrucao 12 do pedido original: nao pode gerar duplicidade).
describe('SessionExecutionLinkService.getWeekReconciliation', () => {
  function fixture() {
    const activityLogs = new Map<string, any>();
    const links = new Map<string, any>();
    const sessions = new Map<string, any>();

    const prisma = {
      activityLog: {
        findMany: jest.fn(async ({ where }: any) => {
          return [...activityLogs.values()].filter(
            (a) => a.userId === where.userId && a.startedAt >= where.startedAt.gte && a.startedAt < where.startedAt.lt,
          );
        }),
      },
      sessionExecutionLink: {
        findMany: jest.fn(async ({ where }: any) => {
          return [...links.values()]
            .filter((l) => where.activityLogId.in.includes(l.activityLogId) && where.status.in.includes(l.status))
            .map((l) => ({ ...l, trainingSession: sessions.get(l.trainingSessionId) }));
        }),
      },
      trainingSession: {
        findMany: jest.fn(async ({ where }: any) => {
          return [...sessions.values()].filter(
            (s) =>
              s.userId === where.userId &&
              s.origin === where.origin &&
              s.scheduledDate >= where.scheduledDate.gte &&
              s.scheduledDate < where.scheduledDate.lt,
          );
        }),
      },
    };

    const service = new SessionExecutionLinkService(prisma as unknown as PrismaService);

    function addActivity(overrides: Partial<any> = {}) {
      const row = {
        id: `act-${activityLogs.size + 1}`,
        userId: 'user-a',
        provider: 'polar',
        startedAt: new Date('2026-10-01T10:00:00Z'),
        distanceMeters: 8000,
        durationSec: 2700,
        avgHeartRateBpm: 150,
        maxHeartRateBpm: 172,
        executionClassification: null,
        ...overrides,
      };
      activityLogs.set(row.id, row);
      return row;
    }

    function addSession(overrides: Partial<any> = {}) {
      const row = {
        id: `sess-${sessions.size + 1}`,
        userId: 'user-a',
        title: 'Corrida',
        modality: 'corrida',
        scheduledDate: new Date('2026-10-01T00:00:00.000Z'),
        origin: 'agent',
        structure: {},
        ...overrides,
      };
      sessions.set(row.id, row);
      return row;
    }

    function addLink(overrides: Partial<any> = {}) {
      const row = {
        id: `link-${links.size + 1}`,
        activityLogId: '',
        trainingSessionId: '',
        status: 'active',
        matchMethod: 'automatic_single_candidate',
        ...overrides,
      };
      links.set(row.id, row);
      return row;
    }

    return { service, addActivity, addSession, addLink };
  }

  const rangeStart = new Date('2026-10-01T00:00:00.000Z');
  const rangeEnd = new Date('2026-10-08T00:00:00.000Z');

  it('atividade com vinculo ativo aparece em activeLinkBySessionId, nao em alternativeActivities', async () => {
    const { service, addActivity, addSession, addLink } = fixture();
    const session = addSession();
    const activity = addActivity({ executionClassification: 'corresponding' });
    addLink({ activityLogId: activity.id, trainingSessionId: session.id, status: 'active' });

    const result = await service.getWeekReconciliation('user-a', rangeStart, rangeEnd);

    expect(result.activeLinkBySessionId.get(session.id)?.activityLog.id).toBe(activity.id);
    expect(result.alternativeActivities).toHaveLength(0);
  });

  it('atividade alternative sem vinculo nenhum aparece em alternativeActivities', async () => {
    const { service, addActivity } = fixture();
    const activity = addActivity({ executionClassification: 'alternative', provider: 'polar' });

    const result = await service.getWeekReconciliation('user-a', rangeStart, rangeEnd);

    expect(result.alternativeActivities).toHaveLength(1);
    expect(result.alternativeActivities[0].id).toBe(activity.id);
  });

  it('atividade alternative JA materializada como TrainingSession device_extra NAO duplica em alternativeActivities', async () => {
    const { service, addActivity, addSession } = fixture();
    const activity = addActivity({ executionClassification: 'alternative' });
    addSession({ origin: 'device_extra', structure: { provider: 'polar', activityLogId: activity.id } });

    const result = await service.getWeekReconciliation('user-a', rangeStart, rangeEnd);

    expect(result.alternativeActivities).toHaveLength(0);
  });

  it('atividade ambigua com candidatos aparece em pendingActivities com as opcoes de sessao', async () => {
    const { service, addActivity, addSession, addLink } = fixture();
    const sessionA = addSession({ title: 'Corrida A' });
    const sessionB = addSession({ title: 'Corrida B' });
    const activity = addActivity({ executionClassification: 'ambiguous' });
    addLink({ activityLogId: activity.id, trainingSessionId: sessionA.id, status: 'candidate' });
    addLink({ activityLogId: activity.id, trainingSessionId: sessionB.id, status: 'candidate' });

    const result = await service.getWeekReconciliation('user-a', rangeStart, rangeEnd);

    expect(result.pendingActivities).toHaveLength(1);
    expect(result.pendingActivities[0].candidates).toHaveLength(2);
    expect(result.pendingActivities[0].candidates.map((c) => c.sessionTitle).sort()).toEqual(['Corrida A', 'Corrida B']);
  });

  it('janela vazia (sem nenhuma atividade) retorna estruturas vazias, sem erro', async () => {
    const { service } = fixture();
    const result = await service.getWeekReconciliation('user-a', rangeStart, rangeEnd);

    expect(result.activeLinkBySessionId.size).toBe(0);
    expect(result.alternativeActivities).toHaveLength(0);
    expect(result.pendingActivities).toHaveLength(0);
  });

  it('calcula avgPaceSecondsKm a partir de distancia/duracao, nunca persistido', async () => {
    const { service, addActivity } = fixture();
    addActivity({ executionClassification: 'alternative', distanceMeters: 10000, durationSec: 3000 });

    const result = await service.getWeekReconciliation('user-a', rangeStart, rangeEnd);

    expect(result.alternativeActivities[0].avgPaceSecondsKm).toBe(300); // 5:00/km
  });

  it('distancia/duracao ausentes (null) nunca viram pace zero/fabricado', async () => {
    const { service, addActivity } = fixture();
    addActivity({ executionClassification: 'alternative', distanceMeters: null, durationSec: null });

    const result = await service.getWeekReconciliation('user-a', rangeStart, rangeEnd);

    expect(result.alternativeActivities[0].avgPaceSecondsKm).toBeNull();
  });
});
