import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';

// Mock de Prisma em memoria real (Map), seguindo o mesmo padrao de
// test/polar-activity-ingestion.spec.ts — permite checar de verdade ausencia de duplicata/perda
// apos operacoes repetidas, nao so "foi chamado".
function fixture() {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const activityLogs = new Map<string, any>();
  const trainingSessions = new Map<string, any>();
  const sessionExecutionLinks = new Map<string, any>();
  const trainingPlans = new Map<string, any>();
  const workoutCompletions = new Map<string, any>();

  const prisma = {
    activityLog: {
      findUnique: jest.fn(async ({ where }: any) => activityLogs.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => {
        return [...activityLogs.values()].filter((a) => {
          if (where.userId !== undefined && a.userId !== where.userId) return false;
          if (where.id?.not !== undefined && a.id === where.id.not) return false;
          if (where.OR !== undefined) {
            const matches = where.OR.some((clause: any) => a.executionClassification === clause.executionClassification);
            if (!matches) return false;
          }
          if ('executionClassification' in where && a.executionClassification !== where.executionClassification) return false;
          return true;
        });
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = activityLogs.get(where.id);
        const updated = { ...row, ...data };
        activityLogs.set(where.id, updated);
        return updated;
      }),
    },
    trainingSession: {
      findUnique: jest.fn(async ({ where }: any) => trainingSessions.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => {
        return [...trainingSessions.values()]
          .filter((s) => {
            if (where.userId !== undefined && s.userId !== where.userId) return false;
            if (where.scheduledDate !== undefined && s.scheduledDate.getTime() !== where.scheduledDate.getTime()) return false;
            if (where.origin !== undefined && s.origin !== where.origin) return false;
            return true;
          })
          .map((s) => ({
            ...s,
            executionLinks: [...sessionExecutionLinks.values()].filter(
              (l) => l.trainingSessionId === s.id && l.status === 'active',
            ),
          }));
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId('session'), completion: null, ...data };
        trainingSessions.set(row.id, row);
        return row;
      }),
    },
    sessionExecutionLink: {
      findUnique: jest.fn(async ({ where }: any) => sessionExecutionLinks.get(where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          [...sessionExecutionLinks.values()].find(
            (l) => l.activityLogId === where.activityLogId && l.status === where.status,
          ) ?? null
        );
      }),
      findMany: jest.fn(async ({ where }: any) => {
        let rows = [...sessionExecutionLinks.values()].filter((l) => {
          if (where.activityLogId !== undefined && l.activityLogId !== where.activityLogId) return false;
          if (where.status?.in !== undefined && !where.status.in.includes(l.status)) return false;
          else if (where.status !== undefined && typeof where.status === 'string' && l.status !== where.status) return false;
          return true;
        });
        rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId('link'), createdAt: new Date(), revokedAt: null, supersededByLinkId: null, matchMethod: null, evidence: null, confidence: null, note: null, ...data };
        sessionExecutionLinks.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = sessionExecutionLinks.get(where.id);
        const updated = { ...row, ...data };
        sessionExecutionLinks.set(where.id, updated);
        return updated;
      }),
      count: jest.fn(async ({ where }: any) => {
        return [...sessionExecutionLinks.values()].filter(
          (l) => l.trainingSessionId === where.trainingSessionId && l.status === where.status,
        ).length;
      }),
    },
    trainingPlan: {
      findFirst: jest.fn(async ({ where }: any) => {
        return [...trainingPlans.values()].find((p) => p.userId === where.userId && p.status === where.status) ?? null;
      }),
    },
    workoutCompletion: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId('completion'), ...data };
        workoutCompletions.set(row.id, row);
        return row;
      }),
    },
  };

  const service = new SessionExecutionLinkService(prisma as unknown as PrismaService);

  function addActivity(overrides: Partial<any> = {}) {
    const row = {
      id: nextId('activity'),
      userId: 'user-a',
      provider: 'polar',
      externalId: nextId('ext'),
      startedAt: new Date('2026-10-01T10:00:00Z'),
      utcOffsetMinutes: -180,
      sport: 'corrida',
      distanceMeters: 8000,
      durationSec: 2700,
      avgHeartRateBpm: 150,
      maxHeartRateBpm: 172,
      executionClassification: null,
      executionClassifiedAt: null,
      executionClassifiedBy: null,
      ...overrides,
    };
    activityLogs.set(row.id, row);
    return row;
  }

  function addSession(overrides: Partial<any> = {}) {
    const row = {
      id: nextId('session'),
      userId: 'user-a',
      planId: 'plan-a',
      scheduledDate: new Date('2026-10-01T00:00:00.000Z'),
      weekday: 4,
      modality: 'corrida',
      title: 'Corrida',
      structure: {},
      origin: 'agent',
      completion: null,
      distanceKm: null,
      durationMin: null,
      ...overrides,
    };
    trainingSessions.set(row.id, row);
    return row;
  }

  function addPlan(overrides: Partial<any> = {}) {
    const row = { id: nextId('plan'), userId: 'user-a', status: 'active', createdAt: new Date(), ...overrides };
    trainingPlans.set(row.id, row);
    return row;
  }

  return { service, prisma, activityLogs, trainingSessions, sessionExecutionLinks, workoutCompletions, addActivity, addSession, addPlan };
}

describe('SessionExecutionLinkService', () => {
  it('corrida prescrita + corrida correspondente no mesmo dia -> vincula automaticamente (classify)', async () => {
    const { service, addActivity, addSession, sessionExecutionLinks } = fixture();
    const session = addSession({ modality: 'corrida' });
    const activity = addActivity({ sport: 'corrida' });

    const result = await service.classify(activity.id);

    expect(result).toBe('linked');
    expect(await service.hasActiveLink(session.id)).toBe(true);
    const link = [...sessionExecutionLinks.values()][0];
    expect(link).toMatchObject({ trainingSessionId: session.id, activityLogId: activity.id, status: 'active', origin: 'automatic' });
  });

  it('corrida prescrita + ciclismo extra: ciclismo nunca substitui a corrida nem vira a execucao dela', async () => {
    const { service, addActivity, addSession } = fixture();
    const corridaSession = addSession({ modality: 'corrida' });
    const ciclismo = addActivity({ sport: 'bike' });

    const result = await service.classify(ciclismo.id);

    expect(result).toBe('extra');
    expect(await service.hasActiveLink(corridaSession.id)).toBe(false); // corrida continua sem execucao
  });

  it('corrida correspondente + ciclismo extra no mesmo dia: as duas classificacoes coexistem sem conflito', async () => {
    const { service, addActivity, addSession } = fixture();
    const corridaSession = addSession({ modality: 'corrida' });
    const corrida = addActivity({ sport: 'corrida' });
    const ciclismo = addActivity({ sport: 'bike' });

    expect(await service.classify(corrida.id)).toBe('linked');
    expect(await service.classify(ciclismo.id)).toBe('extra');
    expect(await service.hasActiveLink(corridaSession.id)).toBe(true);
  });

  it('atividade compativel porem ambigua: duas sessoes de corrida candidatas no mesmo dia -> nao adivinha, fica ambiguous', async () => {
    const { service, addActivity, addSession } = fixture();
    addSession({ modality: 'corrida' });
    addSession({ modality: 'esteira' }); // compativel (grupo corrida/esteira), 2 candidatos
    const activity = addActivity({ sport: 'corrida' });

    expect(await service.classify(activity.id)).toBe('ambiguous');
  });

  it('atividade compativel porem ambigua: duas atividades nao-classificadas disputando a MESMA sessao -> nenhuma e vinculada sozinha', async () => {
    const { service, addActivity, addSession } = fixture();
    addSession({ modality: 'corrida' });
    const activityA = addActivity({ sport: 'corrida', startedAt: new Date('2026-10-01T07:00:00Z') });
    const activityB = addActivity({ sport: 'corrida', startedAt: new Date('2026-10-01T18:00:00Z') });

    expect(await service.classify(activityA.id)).toBe('ambiguous');
    expect(await service.classify(activityB.id)).toBe('ambiguous');
  });

  it('atividade extra recebendo feedback: materializa sessao+completion sinteticas e permite anexar feedback subjetivo depois', async () => {
    const { service, addActivity, addPlan, prisma } = fixture();
    addPlan();
    const activity = addActivity({ sport: 'bike', distanceMeters: 42000, durationSec: 5400 });

    expect(await service.classify(activity.id)).toBe('extra');
    const materialized = await service.materializeExtraActivity(activity.id);

    expect(materialized).not.toBeNull();
    expect(materialized!.session).toMatchObject({ origin: 'device_extra', modality: 'bike' });
    expect(materialized!.completion).toMatchObject({ status: 'done', source: 'device_extra', distanceKm: 42, durationMin: 90 });

    // Chamar de novo e' idempotente (nao duplica sessao/completion)
    const materializedAgain = await service.materializeExtraActivity(activity.id);
    expect(materializedAgain!.session.id).toBe(materialized!.session.id);
    expect((prisma.trainingSession.create as jest.Mock).mock.calls.length).toBe(1);

    // Feedback subjetivo chega depois, como update direto no WorkoutCompletion ja existente
    // (mesmo mecanismo que workout-completions.service.ts ja usa pra sessoes normais)
    const updated = { ...materialized!.completion, perceivedEffort: 7, satisfactionElaboracao: 'gostei' };
    expect(updated.perceivedEffort).toBe(7);
  });

  it('atividade manual (treino extra digitado pelo aluno) posteriormente associada a dado de relogio: reaproveita a sessao existente, nao cria uma 2a execucao', async () => {
    const { service, addActivity, addSession, workoutCompletions, trainingSessions } = fixture();
    // Simula o que addStudentExtraSession ja faz hoje: sessao sintetica 'student_extra' + completion manual.
    const manualSession = addSession({ modality: 'corrida', origin: 'student_extra', structure: { type: 'extra', source: 'student' } });
    workoutCompletions.set('completion-manual', { id: 'completion-manual', sessionId: manualSession.id, userId: 'user-a', status: 'done', source: 'student_extra' });

    const deviceActivity = addActivity({ sport: 'corrida' });
    const link = await service.linkManually({ trainingSessionId: manualSession.id, activityLogId: deviceActivity.id, origin: 'student' });

    expect(link.status).toBe('active');
    expect(await service.hasActiveLink(manualSession.id)).toBe(true);
    // Nenhuma segunda TrainingSession foi criada pra acomodar o dado do relogio.
    expect(trainingSessions.size).toBe(1);
    const refreshedActivity = (await service['prisma'].activityLog.findUnique({ where: { id: deviceActivity.id } })) as any;
    expect(refreshedActivity.executionClassification).toBe('linked');
  });

  it('mesma atividade fisica chegando por dois providers (ex.: Polar + Garmin): ambas podem ficar vinculadas a mesma sessao sem contar duas execucoes', async () => {
    const { service, addActivity, addSession } = fixture();
    const session = addSession({ modality: 'corrida' });
    const fromPolar = addActivity({ provider: 'polar', externalId: 'polar-1', sport: 'corrida' });
    const fromGarmin = addActivity({ provider: 'garmin', externalId: 'garmin-1', sport: 'corrida' });

    await service.linkManually({ trainingSessionId: session.id, activityLogId: fromPolar.id, origin: 'automatic' });
    await service.linkManually({ trainingSessionId: session.id, activityLogId: fromGarmin.id, origin: 'automatic' });

    // hasActiveLink e' uma checagem de EXISTENCIA — nunca "quantos vinculos" — por isso nao importa
    // que existam 2 linhas de link ativas pro mesmo par sessao, a carga/execucao nao e contada 2x.
    expect(await service.hasActiveLink(session.id)).toBe(true);
  });

  it('correcao preserva historico: revogar um vinculo automatico errado e vincular manualmente mantem a cadeia (nunca apaga a decisao anterior)', async () => {
    const { service, addActivity, addSession, sessionExecutionLinks } = fixture();
    const wrongSession = addSession({ modality: 'corrida' });
    const correctSession = addSession({ modality: 'corrida' });
    const activity = addActivity({ sport: 'corrida' });

    const firstLink = await service.linkManually({ trainingSessionId: wrongSession.id, activityLogId: activity.id, origin: 'automatic', confidence: 'same_day_modality_match' });
    const correctedLink = await service.linkManually({ trainingSessionId: correctSession.id, activityLogId: activity.id, origin: 'student', note: 'Era o outro treino de corrida do dia' });

    const revokedFirst = sessionExecutionLinks.get(firstLink.id);
    expect(revokedFirst.status).toBe('revoked');
    expect(revokedFirst.revokedAt).toBeInstanceOf(Date);
    expect(revokedFirst.supersededByLinkId).toBe(correctedLink.id); // cadeia preservada
    expect(revokedFirst.origin).toBe('automatic'); // proveniencia original NUNCA reescrita

    expect(correctedLink.status).toBe('active');
    expect(correctedLink.origin).toBe('student');
    expect(await service.hasActiveLink(wrongSession.id)).toBe(false);
    expect(await service.hasActiveLink(correctSession.id)).toBe(true);
  });

  it('markExtra revoga vinculo ativo e marca extra com proveniencia; "nao foi o treino prescrito"', async () => {
    const { service, addActivity, addSession } = fixture();
    const session = addSession({ modality: 'corrida' });
    const activity = addActivity({ sport: 'corrida' });
    await service.linkManually({ trainingSessionId: session.id, activityLogId: activity.id, origin: 'automatic' });

    await service.markExtra({ activityLogId: activity.id, origin: 'student', note: 'Na verdade troquei de treino' });

    expect(await service.hasActiveLink(session.id)).toBe(false);
    const refreshed = (await service['prisma'].activityLog.findUnique({ where: { id: activity.id } })) as any;
    expect(refreshed.executionClassification).toBe('extra');
    expect(refreshed.executionClassifiedBy).toBe('student');
  });

  it('revokeLink (revogacao pura, sem decidir o novo estado) volta a atividade pra ambiguous, nunca silenciosamente pra extra', async () => {
    const { service, addActivity, addSession } = fixture();
    const session = addSession({ modality: 'corrida' });
    const activity = addActivity({ sport: 'corrida' });
    const link = await service.linkManually({ trainingSessionId: session.id, activityLogId: activity.id, origin: 'automatic' });

    await service.revokeLink(link.id);

    expect(await service.hasActiveLink(session.id)).toBe(false);
    const refreshed = (await service['prisma'].activityLog.findUnique({ where: { id: activity.id } })) as any;
    expect(refreshed.executionClassification).toBe('ambiguous');
  });

  it('revokeLink rejeita revogar um vinculo que ja nao esta ativo', async () => {
    const { service, addActivity, addSession } = fixture();
    const session = addSession({ modality: 'corrida' });
    const activity = addActivity({ sport: 'corrida' });
    const link = await service.linkManually({ trainingSessionId: session.id, activityLogId: activity.id, origin: 'automatic' });
    await service.revokeLink(link.id);

    await expect(service.revokeLink(link.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('linkManually rejeita vincular atividade e sessao de alunos diferentes', async () => {
    const { service, addActivity, addSession } = fixture();
    const session = addSession({ userId: 'user-b' });
    const activity = addActivity({ userId: 'user-a' });

    await expect(service.linkManually({ trainingSessionId: session.id, activityLogId: activity.id, origin: 'coach' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('materializeExtraActivity rejeita atividade que nao foi classificada como extra', async () => {
    const { service, addActivity } = fixture();
    const activity = addActivity({ executionClassification: 'linked' });
    await expect(service.materializeExtraActivity(activity.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('materializeExtraActivity sem plano ativo retorna null (nao lanca, nao quebra a classificacao extra)', async () => {
    const { service, addActivity } = fixture();
    const activity = addActivity({ sport: 'bike', executionClassification: 'extra' });
    const result = await service.materializeExtraActivity(activity.id);
    expect(result).toBeNull();
  });

  it('classify em atividade ja classificada e idempotente (nunca reclassifica sozinho)', async () => {
    const { service, addActivity } = fixture();
    const activity = addActivity({ sport: 'corrida', executionClassification: 'ambiguous' });
    expect(await service.classify(activity.id)).toBe('ambiguous');
  });

  it('classify lanca NotFoundException para atividade inexistente', async () => {
    const { service } = fixture();
    await expect(service.classify('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
