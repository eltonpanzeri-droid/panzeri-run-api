import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { EvidenceItem, SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';

// Motor de Reconciliacao V1 (02/10/2026) — casos minimos pedidos. Mesmo padrao de mock de Prisma
// em memoria real (Map) de test/session-execution-link.spec.ts; fixture duplicada aqui de proposito
// pra manter este arquivo legivel como suite dedicada a reconciliacao (nao a CRUD de vinculo).
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
          if (where.trainingSessionId !== undefined && l.trainingSessionId !== where.trainingSessionId) return false;
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
      findUnique: jest.fn(async ({ where }: any) => [...workoutCompletions.values()].find((c) => c.sessionId === where.sessionId) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId('completion'), ...data };
        workoutCompletions.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = [...workoutCompletions.values()].find((c) => c.id === where.id);
        const updated = { ...row, ...data };
        workoutCompletions.set(updated.id, updated);
        return updated;
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

  function addCompletion(overrides: Partial<any> = {}) {
    const row = {
      id: nextId('completion'),
      userId: 'user-a',
      status: 'done',
      ...overrides,
    };
    workoutCompletions.set(row.id, row);
    return row;
  }

  function candidatesFor(activityId: string) {
    return [...sessionExecutionLinks.values()].filter((l) => l.activityLogId === activityId && l.status === 'candidate');
  }

  return { service, prisma, activityLogs, trainingSessions, sessionExecutionLinks, workoutCompletions, addActivity, addSession, addCompletion, candidatesFor };
}

function evidenceItem(evidence: EvidenceItem[] | null | undefined, criterion: EvidenceItem['criterion']) {
  return evidence?.find((e) => e.criterion === criterion);
}

describe('Motor de Reconciliacao Prescricao x Execucao V1', () => {
  it('1. corrida prescrita + corrida claramente correspondente -> corresponding com evidencia explicita', async () => {
    const { service, addActivity, addSession, sessionExecutionLinks } = fixture();
    const session = addSession({ modality: 'corrida', distanceKm: 8, durationMin: 45 });
    const activity = addActivity({ sport: 'corrida', distanceMeters: 8000, durationSec: 2700 });

    const result = await service.classify(activity.id);

    expect(result).toBe('corresponding');
    const link = [...sessionExecutionLinks.values()].find((l) => l.status === 'active');
    expect(link.matchMethod).toBe('automatic_single_candidate');
    expect(evidenceItem(link.evidence, 'compatible_modality')?.matched).toBe(true);
    expect(evidenceItem(link.evidence, 'distance_compatible')?.matched).toBe(true);
  });

  it('5/7. corrida prescrita + ciclismo: ciclismo vira alternative, corrida permanece sem execucao correspondente identificada', async () => {
    const { service, addActivity, addSession } = fixture();
    const corridaSession = addSession({ modality: 'corrida' });
    const ciclismo = addActivity({ sport: 'bike' });

    const result = await service.classify(ciclismo.id);

    expect(result).toBe('alternative');
    expect(await service.hasActiveLink(corridaSession.id)).toBe(false);
  });

  it('corrida prescrita + musculacao: incompativel, vira alternative, corrida continua sem execucao', async () => {
    const { service, addActivity, addSession } = fixture();
    const corridaSession = addSession({ modality: 'corrida' });
    const musculacao = addActivity({ sport: 'forca' });

    const result = await service.classify(musculacao.id);

    expect(result).toBe('alternative');
    expect(await service.hasActiveLink(corridaSession.id)).toBe(false);
  });

  it('6/8. corrida prescrita + corrida correspondente + ciclismo: corrida corresponding, ciclismo alternative, nenhuma suposicao de substituicao', async () => {
    const { service, addActivity, addSession } = fixture();
    const corridaSession = addSession({ modality: 'corrida' });
    const corrida = addActivity({ sport: 'corrida' });
    const ciclismo = addActivity({ sport: 'bike' });

    expect(await service.classify(corrida.id)).toBe('corresponding');
    expect(await service.classify(ciclismo.id)).toBe('alternative');
    expect(await service.hasActiveLink(corridaSession.id)).toBe(true);
  });

  it('4. corrida prescrita + duas corridas plausiveis no mesmo dia: nenhuma vinculada sozinha, candidata registrada pro par em disputa', async () => {
    const { service, addActivity, addSession, candidatesFor } = fixture();
    const session = addSession({ modality: 'corrida' });
    const activityA = addActivity({ sport: 'corrida', startedAt: new Date('2026-10-01T07:00:00Z') });
    const activityB = addActivity({ sport: 'corrida', startedAt: new Date('2026-10-01T18:00:00Z') });

    expect(await service.classify(activityA.id)).toBe('ambiguous');
    expect(await service.classify(activityB.id)).toBe('ambiguous');
    expect(await service.hasActiveLink(session.id)).toBe(false);

    const candidatesA = candidatesFor(activityA.id);
    expect(candidatesA).toHaveLength(1);
    expect(candidatesA[0].matchMethod).toBe('automatic_rival_activity');
    expect(candidatesA[0].trainingSessionId).toBe(session.id);
  });

  it('7. duas corridas prescritas + uma corrida sem evidencia suficiente pra distinguir: ambiguous, candidata por sessao plausivel', async () => {
    const { service, addActivity, addSession, candidatesFor } = fixture();
    const sessionA = addSession({ modality: 'corrida' });
    const sessionB = addSession({ modality: 'corrida' });
    const activity = addActivity({ sport: 'corrida' });

    const result = await service.classify(activity.id);

    expect(result).toBe('ambiguous');
    const candidates = candidatesFor(activity.id);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.trainingSessionId).sort()).toEqual([sessionA.id, sessionB.id].sort());
    expect(candidates.every((c) => c.matchMethod === 'automatic_multi_candidate')).toBe(true);
    expect(await service.hasActiveLink(sessionA.id)).toBe(false);
    expect(await service.hasActiveLink(sessionB.id)).toBe(false);
  });

  it('8. duas prescricoes plausiveis + evidencia de execucao distingue uma delas: associa direto, sem pedir confirmacao', async () => {
    const { service, addActivity, addSession, sessionExecutionLinks, candidatesFor } = fixture();
    const sessionCompatible = addSession({ modality: 'corrida', distanceKm: 8, durationMin: 45 });
    const sessionIncompatible = addSession({ modality: 'corrida', distanceKm: 3, durationMin: 15 });
    // Distancia/duracao batem com sessionCompatible e destoam claramente de sessionIncompatible.
    const activity = addActivity({ sport: 'corrida', distanceMeters: 8000, durationSec: 2700 });

    const result = await service.classify(activity.id);

    expect(result).toBe('corresponding');
    expect(await service.hasActiveLink(sessionCompatible.id)).toBe(true);
    expect(await service.hasActiveLink(sessionIncompatible.id)).toBe(false);
    const link = [...sessionExecutionLinks.values()].find((l) => l.status === 'active');
    expect(link.matchMethod).toBe('automatic_multi_candidate_disambiguated');
    expect(candidatesFor(activity.id)).toHaveLength(0);
  });

  it('atividade em dia sem nenhuma prescricao: alternative, nenhuma candidata criada', async () => {
    const { service, addActivity, candidatesFor } = fixture();
    const activity = addActivity({ sport: 'corrida' });

    expect(await service.classify(activity.id)).toBe('alternative');
    expect(candidatesFor(activity.id)).toHaveLength(0);
  });

  it('atividade em horario diferente do previsto, mesmo dia: ainda corresponde (motor compara DIA, nunca horario especifico)', async () => {
    const { service, addActivity, addSession } = fixture();
    const session = addSession({ modality: 'corrida', scheduledDate: new Date('2026-10-01T00:00:00.000Z') });
    // Atividade registrada a noite (20h local, offset -180) no MESMO dia local da sessao.
    const activity = addActivity({ sport: 'corrida', startedAt: new Date('2026-10-01T23:00:00Z'), utcOffsetMinutes: -180 });

    expect(await service.classify(activity.id)).toBe('corresponding');
    expect(await service.hasActiveLink(session.id)).toBe(true);
  });

  it('atividade realizada em outro dia proximo (dia seguinte): nao corresponde a sessao do dia anterior', async () => {
    const { service, addActivity, addSession } = fixture();
    const session = addSession({ modality: 'corrida', scheduledDate: new Date('2026-10-01T00:00:00.000Z') });
    const activity = addActivity({ sport: 'corrida', startedAt: new Date('2026-10-02T10:00:00Z'), utcOffsetMinutes: -180 });

    expect(await service.classify(activity.id)).toBe('alternative');
    expect(await service.hasActiveLink(session.id)).toBe(false);
  });

  it('9/11. execucao parcial (duracao bem menor que a prescrita): unico candidato -> corresponding; diferenca fica registrada so como evidencia, nunca veta', async () => {
    const { service, addActivity, addSession, sessionExecutionLinks } = fixture();
    const session = addSession({ modality: 'corrida', distanceKm: 10, durationMin: 60 });
    // 12 minutos reais vs 60 prescritos (treino interrompido) — unico candidato do dia.
    const activity = addActivity({ sport: 'corrida', distanceMeters: 2000, durationSec: 720 });

    const result = await service.classify(activity.id);

    expect(result).toBe('corresponding');
    expect(await service.hasActiveLink(session.id)).toBe(true);
    const link = [...sessionExecutionLinks.values()].find((l) => l.status === 'active');
    // A divergencia fica registrada como EVIDENCIA (explicacao), nao como motivo de recusa.
    expect(evidenceItem(link.evidence, 'duration_compatible')?.matched).toBe(false);
    expect(evidenceItem(link.evidence, 'distance_compatible')?.matched).toBe(false);
  });

  it('10. distancia/duracao diferentes da prescricao, unico candidato plausivel: diferenca isolada nao veta correspondencia', async () => {
    const { service, addActivity, addSession, sessionExecutionLinks } = fixture();
    const session = addSession({ modality: 'corrida', distanceKm: 5, durationMin: 30 });
    // Distancia quase o dobro da prescrita.
    const activity = addActivity({ sport: 'corrida', distanceMeters: 9500, durationSec: 1800 });

    const result = await service.classify(activity.id);

    expect(result).toBe('corresponding');
    expect(await service.hasActiveLink(session.id)).toBe(true);
    const link = [...sessionExecutionLinks.values()].find((l) => l.status === 'active');
    expect(evidenceItem(link.evidence, 'distance_compatible')?.matched).toBe(false);
  });

  it('atividade ja vinculada: classify() e idempotente, nao recria nem duplica vinculos', async () => {
    const { service, addActivity, addSession, sessionExecutionLinks } = fixture();
    addSession({ modality: 'corrida' });
    const activity = addActivity({ sport: 'corrida' });

    expect(await service.classify(activity.id)).toBe('corresponding');
    const countAfterFirst = sessionExecutionLinks.size;
    expect(await service.classify(activity.id)).toBe('corresponding');
    expect(sessionExecutionLinks.size).toBe(countAfterFirst);
  });

  it('18. sessao ja vinculada a OUTRA atividade: nova atividade compativel fica ambigua (possivel duplicata/continuacao/fragmentacao), nunca decide sozinho', async () => {
    const { service, addActivity, addSession } = fixture();
    const session = addSession({ modality: 'corrida' });
    const first = addActivity({ sport: 'corrida', startedAt: new Date('2026-10-01T07:00:00Z') });
    await service.linkManually({ trainingSessionId: session.id, activityLogId: first.id, origin: 'automatic' });

    // Segunda atividade do mesmo dia, mesma modalidade, sem nenhum OUTRO candidato disponivel —
    // pode ser continuacao/reinicio da mesma execucao (requisito 4), entao fica ambigua.
    const second = addActivity({ sport: 'corrida', startedAt: new Date('2026-10-01T09:00:00Z') });
    expect(await service.classify(second.id)).toBe('ambiguous');
  });

  it('16. vinculo anteriormente corrigido/revogado pelo aluno: classify() nunca reexecuta nem ressuscita decisao, historico preservado', async () => {
    const { service, addActivity, addSession } = fixture();
    const session = addSession({ modality: 'corrida' });
    const activity = addActivity({ sport: 'corrida' });
    const link = await service.linkManually({ trainingSessionId: session.id, activityLogId: activity.id, origin: 'automatic' });

    await service.revokeLink(link.id);
    expect(await service.hasActiveLink(session.id)).toBe(false);

    // classify() le executionClassification='ambiguous' (setado por revokeLink) e para ali —
    // nunca recalcula nem recria um vinculo automatico por conta propria.
    const result = await service.classify(activity.id);
    expect(result).toBe('ambiguous');
    expect(await service.hasActiveLink(session.id)).toBe(false);
  });

  it('12. ausencia de ActivityLog nunca e inferida como nao-aderencia: classify() so avalia quando ha atividade; sessao sem nenhuma atividade fica simplesmente sem decisao', async () => {
    const { service, addSession } = fixture();
    const session = addSession({ modality: 'corrida' });

    // O motor nao tem nenhum metodo que "declara nao aderencia" por ausencia de ActivityLog — a
    // unica forma de uma sessao ficar sem vinculo e' nunca ter sido chamada classify() pra ela
    // (nao ha' job/trigger que marque proativamente "nao aderiu"). Confirma apenas a ausencia.
    expect(await service.hasActiveLink(session.id)).toBe(false);
  });

  it('13. WorkoutCompletion existente sem ActivityLog: motor nunca le nem escreve WorkoutCompletion nesse fluxo', async () => {
    const { service, addActivity, addSession, addCompletion, prisma } = fixture();
    const session = addSession({ modality: 'corrida' });
    addCompletion({ sessionId: session.id, status: 'done', perceivedEffort: 8 });

    const activity = addActivity({ sport: 'corrida' });
    const result = await service.classify(activity.id);

    expect(result).toBe('corresponding');
    // Nenhuma chamada tocou workoutCompletion.update/create neste fluxo de classify()/linkManually.
    expect((prisma.workoutCompletion.update as jest.Mock).mock.calls.length).toBe(0);
    expect((prisma.workoutCompletion.create as jest.Mock).mock.calls.length).toBe(0);
  });

  it('14. WorkoutCompletion + ActivityLog para a mesma prescricao: ambos coexistem, um nao sobrescreve o outro', async () => {
    const { service, addActivity, addSession, addCompletion, workoutCompletions } = fixture();
    const session = addSession({ modality: 'corrida' });
    const completion = addCompletion({ sessionId: session.id, status: 'done', perceivedEffort: 9, satisfactionElaboracao: 'otima' });

    const activity = addActivity({ sport: 'corrida', distanceMeters: 8000 });
    expect(await service.classify(activity.id)).toBe('corresponding');

    // Feedback subjetivo original intocado — nenhum campo veio da evidencia objetiva.
    const stillThere = workoutCompletions.get(completion.id);
    expect(stillThere).toMatchObject({ perceivedEffort: 9, satisfactionElaboracao: 'otima' });
  });

  it('17. dados insuficientes (distancia/duracao prescritas null): ausencia nunca vira incompatibilidade, ainda corresponde', async () => {
    const { service, addActivity, addSession, sessionExecutionLinks } = fixture();
    addSession({ modality: 'corrida', distanceKm: null, durationMin: null });
    const activity = addActivity({ sport: 'corrida', distanceMeters: 8000, durationSec: 2700 });

    const result = await service.classify(activity.id);

    expect(result).toBe('corresponding');
    const link = [...sessionExecutionLinks.values()].find((l) => l.status === 'active');
    expect(evidenceItem(link.evidence, 'distance_compatible')?.matched).toBeNull();
    expect(evidenceItem(link.evidence, 'duration_compatible')?.matched).toBeNull();
  });

  it('15. confirmCandidate promove uma candidata a vinculo ativo, preservando proveniencia, e descarta as candidatas irmas da mesma atividade', async () => {
    const { service, addActivity, addSession, candidatesFor } = fixture();
    const sessionA = addSession({ modality: 'corrida' });
    const sessionB = addSession({ modality: 'corrida' });
    const activity = addActivity({ sport: 'corrida' });

    expect(await service.classify(activity.id)).toBe('ambiguous');
    const candidates = candidatesFor(activity.id);
    const chosen = candidates.find((c) => c.trainingSessionId === sessionA.id)!;

    const confirmed = await service.confirmCandidate(chosen.id, 'student', 'confirmado pelo aluno');

    expect(confirmed.status).toBe('active');
    expect(confirmed.trainingSessionId).toBe(sessionA.id);
    expect(await service.hasActiveLink(sessionA.id)).toBe(true);
    expect(await service.hasActiveLink(sessionB.id)).toBe(false);
    // A candidata irma (sessionB) foi revogada, nao apagada.
    const siblingAfter = candidatesFor(activity.id);
    expect(siblingAfter).toHaveLength(0);
  });

  it('confirmCandidate rejeita id que nao e mais um candidato pendente', async () => {
    const { service, addActivity, addSession } = fixture();
    const session = addSession({ modality: 'corrida' });
    const activity = addActivity({ sport: 'corrida' });
    const link = await service.linkManually({ trainingSessionId: session.id, activityLogId: activity.id, origin: 'automatic' });

    await expect(service.confirmCandidate(link.id, 'student')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirmCandidate lanca NotFoundException para id inexistente', async () => {
    const { service } = fixture();
    await expect(service.confirmCandidate('nope', 'student')).rejects.toBeInstanceOf(NotFoundException);
  });
});
