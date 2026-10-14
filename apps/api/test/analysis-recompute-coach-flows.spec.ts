import { Logger } from '@nestjs/common';
import * as recompute from '../src/activity-execution/analysis-recompute';
import { recomputeSessionAnalyses, scheduleStaleHeal, waitForBackgroundRecompute } from '../src/activity-execution/analysis-recompute';
import { SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { CoachService } from '../src/coach/coach.service';
import { pendingModel } from './helpers/pending-fake';

// Ponto central pos-correcao + fluxos do treinador. Garante que (1) corrigir atividade antiga atualiza os indicadores, (2) em massa nada fica permanentemente sem
// atualizacao (a pendencia e' DURAVEL) e a leitura nunca usa linha antiga, (3) os fluxos do treinador atualizam so' quando houve mudanca real e (4) nada disso
// gera treino nem aciona agente de prescricao.

const analyzeSession = jest.fn();
jest.mock('../src/activity-execution/execution-analysis.service', () => ({
  // classe simples (nao jest.fn): jest.restoreAllMocks() nao apaga a implementacao entre os testes
  ExecutionAnalysisService: class { analyzeSession = (...args: unknown[]) => analyzeSession(...args); },
}));

type Row = Record<string, any>;
const USER = 'u1';

function fakePrisma(sessions: Row[], links: Row[] = [], extra: Row = {}) {
  const trainingAnalyses: Row[] = (extra.trainingAnalyses ?? []).map((t: Row) => ({ ...t }));
  const pending = pendingModel(extra.pending ?? []);
  const prisma: any = {
    correctionReevaluation: pending.model,
    trainingSession: {
      findMany: jest.fn(async ({ where }: any) =>
        sessions
          .map((s): Row => ({ scheduledDate: new Date('2026-10-01T00:00:00Z'), userId: USER, completion: null, ...s, executionLinks: links.filter((l) => l.trainingSessionId === s.id && l.status === 'active') }))
          .filter((s) => (!where.id?.in || where.id.in.includes(s.id)) && (where.userId === undefined || s.userId === where.userId))),
    },
    trainingAnalysis: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const t of trainingAnalyses) if (where.refKey.in.includes(t.refKey) && t.deliveredWithPlanId === where.deliveredWithPlanId && t.status === where.status) { Object.assign(t, data); count += 1; }
        return { count };
      }),
    },
    sessionExecutionLink: {
      findMany: jest.fn(async ({ where }: any) => links.filter((l) => (where.userId === undefined || l.userId === where.userId)
        && (!where.activityLogId?.in || where.activityLogId.in.includes(l.activityLogId))
        && (!where.OR || where.OR.some((c: any) => (c.createdAt && l.createdAt >= c.createdAt.gte) || (c.revokedAt && l.revokedAt && l.revokedAt >= c.revokedAt.gte))))),
    },
    activityLog: {
      findMany: jest.fn(async ({ where }: any) => (extra.activities ?? []).filter((a: Row) => (!where.id?.in || where.id.in.includes(a.id)) && (!where.physicalEventId?.in || where.physicalEventId.in.includes(a.physicalEventId)))),
    },
  };
  return { prisma, trainingAnalyses, pending };
}

const withFeedback = (id: string, extra: Row = {}) => ({ id, completion: { id: `c-${id}` }, ...extra });
const ids = (n: number, prefix = 's') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

beforeEach(() => { analyzeSession.mockReset(); analyzeSession.mockResolvedValue({ analysis: {} }); });
afterEach(async () => { await waitForBackgroundRecompute(); jest.restoreAllMocks(); });

describe('recomputeSessionAnalyses: massa sem sessao permanentemente desatualizada (pendencia duravel)', () => {
  it('as mais recentes sao refeitas antes de devolver; o restante FICA REGISTRADO no banco e termina em segundo plano, cada sessao UMA vez', async () => {
    const sessions = ids(30).map((id, i) => withFeedback(id, { scheduledDate: new Date(Date.UTC(2026, 8, 1 + i)) })); // s30 = mais recente
    const { prisma, pending } = fakePrisma(sessions);
    const result = await recomputeSessionAnalyses(prisma, USER, ids(30), { syncLimit: 25 });

    expect(result.recomputedSessionIds).toHaveLength(25);
    expect(result.recomputedSessionIds[0]).toBe('s30'); // mais recentes primeiro
    expect(result.deferredSessionIds).toHaveLength(5);
    // durabilidade: os 5 restantes estao na linha do banco, nao numa fila em memoria
    expect(pending.rows.get(USER)?.analysisSessionIds).toHaveLength(5);

    await waitForBackgroundRecompute();
    const calls = analyzeSession.mock.calls.map((c) => c[1]);
    expect(calls).toHaveLength(30);
    expect(new Set(calls).size).toBe(30); // nenhuma ficou de fora, nenhuma repetida
    expect(pending.rows.has(USER)).toBe(false); // concluido: linha removida
  });

  it('o retrato vivo do Analista de TODAS as afetadas e marcado desatualizado de imediato, inclusive as que ainda estao pendentes', async () => {
    const sessions = ids(4).map((id) => withFeedback(id));
    const trainingAnalyses: Row[] = [...ids(4), 'fora'].map((refKey): Row => ({ refKey, userId: USER, scope: 'session', deliveredWithPlanId: null, status: 'active' }))
      .concat([{ refKey: 's1', userId: USER, scope: 'session', deliveredWithPlanId: 'planX', status: 'active' }]); // retrato ENTREGUE
    const { prisma, trainingAnalyses: rows, pending } = fakePrisma(sessions, [], { trainingAnalyses });
    const result = await recomputeSessionAnalyses(prisma, USER, ids(4), { syncLimit: 0 });
    expect(result.deferredSessionIds).toHaveLength(4);
    expect(pending.rows.get(USER)?.analysisSessionIds).toHaveLength(4);
    expect(rows.filter((r) => r.status === 'stale').map((r) => r.refKey).sort()).toEqual(['s1', 's2', 's3', 's4']);
    expect(rows.find((r) => r.refKey === 'fora')?.status).toBe('active');
    expect(rows.find((r) => r.deliveredWithPlanId === 'planX')?.status).toBe('active');
  });

  it('sessao sem feedback e sem vinculo ativo NAO e reanalisada nem fica pendente (nao vira "sem registro" so por ter sido desvinculada)', async () => {
    const { prisma, pending } = fakePrisma([withFeedback('s1'), { id: 's2' }]);
    const result = await recomputeSessionAnalyses(prisma, USER, ['s1', 's2']);
    expect(result.recomputedSessionIds).toEqual(['s1']);
    expect(analyzeSession.mock.calls.map((c) => c[1])).toEqual(['s1']);
    expect(result.sessionIds).toEqual(['s1', 's2']);
    expect(pending.rows.has(USER)).toBe(false);
  });

  it('falha de uma sessao nao interrompe as outras: continua PENDENTE na linha duravel e e retomada', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let attempts = 0;
    analyzeSession.mockImplementation(async (_u: string, id: string) => { if (id === 's1' && ++attempts === 1) throw new Error('banco'); return { analysis: {} }; });
    const { prisma, pending } = fakePrisma([withFeedback('s1'), withFeedback('s2')]);
    const result = await recomputeSessionAnalyses(prisma, USER, ['s1', 's2']);
    expect(result.failedSessionIds).toEqual(['s1']);
    expect(result.deferredSessionIds).toEqual(['s1']);
    expect(pending.rows.get(USER)?.analysisSessionIds).toEqual(['s1']);
    await waitForBackgroundRecompute();
    expect(analyzeSession.mock.calls.filter((c) => c[1] === 's1')).toHaveLength(2);
    expect(pending.rows.has(USER)).toBe(false);
  });

  it('forceSessionIds forca so as sessoes indicadas', async () => {
    const { prisma } = fakePrisma([withFeedback('s1'), withFeedback('s2')]);
    await recomputeSessionAnalyses(prisma, USER, ['s1', 's2'], { forceSessionIds: ['s2'] });
    expect(analyzeSession).toHaveBeenCalledWith(USER, 's1', { force: false });
    expect(analyzeSession).toHaveBeenCalledWith(USER, 's2', { force: true });
  });

  it('nao toca em nenhuma outra coisa: so le sessoes/vinculos e marca o retrato vivo (sem escrever vinculo, classificacao, feedback)', async () => {
    const { prisma } = fakePrisma([withFeedback('s1')]);
    prisma.workoutCompletion = { update: jest.fn(), create: jest.fn(), delete: jest.fn(), updateMany: jest.fn() };
    prisma.sessionExecutionLink.update = jest.fn();
    prisma.activityLog.update = jest.fn();
    await recomputeSessionAnalyses(prisma, USER, ['s1']);
    for (const fn of [...Object.values(prisma.workoutCompletion), prisma.sessionExecutionLink.update, prisma.activityLog.update] as jest.Mock[]) expect(fn).not.toHaveBeenCalled();
  });
});

describe('recomputeAfterCorrection: descobre as sessoes afetadas', () => {
  const t = new Date('2026-10-14T12:00:00Z');
  const link = (id: string, trainingSessionId: string, activityLogId: string, extra: Row = {}) => ({ id, userId: USER, trainingSessionId, activityLogId, status: 'active', createdAt: new Date('2026-10-01T00:00:00Z'), revokedAt: null, ...extra });

  it('a partir do historico de vinculos (since), de sessoes informadas e das atividades informadas (com as outras observacoes do mesmo evento)', async () => {
    const { prisma } = fakePrisma(
      ids(4).map((id) => withFeedback(id)),
      [link('l1', 's1', 'a1', { revokedAt: t, status: 'revoked' }), link('l2', 's2', 'a2'), link('l3', 's3', 'a3')],
      { activities: [{ id: 'a1', startedAt: t, utcOffsetMinutes: 0 }, { id: 'a2', physicalEventId: 'ev1', startedAt: t, utcOffsetMinutes: 0 }, { id: 'a3', physicalEventId: 'ev1', startedAt: t, utcOffsetMinutes: 0 }] },
    );
    const service = new SessionExecutionLinkService(prisma);
    const result = await service.recomputeAfterCorrection(USER, t, { sessionIds: ['s4'], activityLogIds: ['a2'] });
    expect(result.sessionIds.sort()).toEqual(['s1', 's2', 's3', 's4']); // s3 entra pela observacao do mesmo evento de a2
  });

  it('sem since e sem nada informado: nao faz nada', async () => {
    const { prisma, pending } = fakePrisma([withFeedback('s1')], [link('l1', 's1', 'a1')]);
    const result = await new SessionExecutionLinkService(prisma).recomputeAfterCorrection(USER, null);
    expect(result.sessionIds).toEqual([]);
    expect(analyzeSession).not.toHaveBeenCalled();
    expect(pending.rows.size).toBe(0);
  });
});

describe('leitura das variaveis execution.*: recuperacao duravel de linha obsoleta', () => {
  const row = { id: 'r1', userId: USER, trainingSessionId: 's1', activityLogId: 'a1', provider: 'polar', modality: 'corrida', scheduledDate: new Date('2026-10-10T00:00:00Z'), algorithmVersion: 1, status: 'analyzed', indicators: { kind: 'run', totals: { completionRatio: 0.5 } } };

  it('a leitura omite a linha obsoleta E agenda a recuperacao das sessoes que ainda tem fonte (com intervalo minimo por aluno)', async () => {
    const heal = jest.spyOn(recompute, 'scheduleStaleHeal').mockImplementation(() => undefined);
    const { prisma } = fakePrisma([withFeedback('s1')], []); // sem vinculo ativo: a linha com atividade e' obsoleta
    prisma.sessionExecutionAnalysis = { findMany: jest.fn(async () => [row]) };
    const reader = new ObservationReaderService(prisma as never, {} as never, {} as never);
    const observations = await reader.getObservations(USER, 'execution.distanceCompletionRatio');
    expect(observations).toEqual([]); // nunca apresentada como atual
    expect(heal).toHaveBeenCalledWith(prisma, USER, ['s1']);
  });

  it('scheduleStaleHeal: registra a pendencia so das sessoes com fonte, processa, respeita o intervalo minimo e nunca lanca', async () => {
    const { prisma, pending } = fakePrisma([withFeedback('s1'), { id: 's2' }]);
    scheduleStaleHeal(prisma, USER, ['s1', 's2']);
    await new Promise((r) => setTimeout(r, 30));
    await waitForBackgroundRecompute();
    expect(analyzeSession.mock.calls.map((c) => c[1])).toEqual(['s1']);
    expect(pending.rows.has(USER)).toBe(false);
    analyzeSession.mockClear();
    scheduleStaleHeal(prisma, USER, ['s1']); // dentro do intervalo: ignora
    await new Promise((r) => setTimeout(r, 30));
    expect(analyzeSession).not.toHaveBeenCalled();
    prisma.trainingSession.findMany = jest.fn(async () => { throw new Error('fora'); });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(() => scheduleStaleHeal(prisma, 'heal-user-2', ['s1'])).not.toThrow();
    await new Promise((r) => setTimeout(r, 30));
  });
});

describe('fluxos do treinador: atualizam so quando houve mudanca real e nunca geram treino', () => {
  function coach() {
    const service: any = Object.create(CoachService.prototype);
    const trainingPlans = { generateWeek: jest.fn(), regenerateSession: jest.fn(), regenerateStudentWeek: jest.fn() };
    service.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    service.trainingPlans = trainingPlans;
    service.prisma = {
      activityLog: { findFirst: jest.fn(async () => ({ id: 'a1', userId: USER })) },
      trainingSession: {
        findFirst: jest.fn(async () => ({ id: 's1', modality: 'corrida', durationMin: 40, distanceKm: 8, structure: {}, prescriptionHistory: [], completion: { id: 'c1' }, executionLinks: [] })),
        update: jest.fn(async ({ data }: any) => ({ id: 's1', ...data })),
      },
    };
    service.assertStudent = jest.fn(async () => ({ id: USER }));
    service.sessionExecutionLink = {
      classify: jest.fn(async () => 'corresponding'),
      getActiveLinkForActivity: jest.fn(async () => ({ trainingSessionId: 's1' })),
      reconcileUserHistory: jest.fn(async () => ({ changed: 1 })),
      reconcileAffectedByIdentity: jest.fn(async () => true),
      recomputeAfterCorrection: jest.fn(async () => ({ sessionIds: [], recomputedSessionIds: [], failedSessionIds: [], deferredSessionIds: [] })),
    };
    service.physicalIdentity = {
      evaluateUserHistory: jest.fn(async () => ({ evaluated: 3, matchedEvents: 1, ambiguous: 0, unique: 2, affectedActivityLogIds: [] })),
      setPrimarySource: jest.fn(async () => ({ id: 'p1', provider: 'apple_health', effectiveFrom: new Date(), recomputed: { events: 2, affectedActivityLogIds: ['a1', 'a2'] } })),
    };
    return { service, trainingPlans };
  }
  const noGeneration = (trainingPlans: Row) => { for (const fn of Object.values(trainingPlans) as jest.Mock[]) expect(fn).not.toHaveBeenCalled(); };

  it('reclassify: atualiza as analises depois da classificacao (origem: treinador)', async () => {
    const { service, trainingPlans } = coach();
    await service.reclassifyExternalActivity(USER, 'a1');
    expect(service.sessionExecutionLink.recomputeAfterCorrection).toHaveBeenCalledWith(USER, expect.any(Date), expect.objectContaining({ origin: 'coach', kind: 'link_correction' }));
    noGeneration(trainingPlans);
  });

  it('evaluate-identity SEM mudanca efetiva: nenhum efeito posterior; COM mudanca: atualiza so as sessoes das observacoes alteradas', async () => {
    const { service, trainingPlans } = coach();
    await service.evaluateExternalActivityIdentity(USER);
    expect(service.sessionExecutionLink.recomputeAfterCorrection).not.toHaveBeenCalled();

    service.physicalIdentity.evaluateUserHistory = jest.fn(async () => ({ evaluated: 3, matchedEvents: 1, ambiguous: 0, unique: 2, affectedActivityLogIds: ['a2', 'a3'] }));
    await service.evaluateExternalActivityIdentity(USER);
    expect(service.sessionExecutionLink.recomputeAfterCorrection).toHaveBeenCalledWith(USER, null, expect.objectContaining({ activityLogIds: ['a2', 'a3'], origin: 'coach', kind: 'identity_correction' }));
    noGeneration(trainingPlans);
  });

  it('reconcile-history: dry-run nao atualiza nada; aplicado atualiza (em massa, com as observacoes alteradas)', async () => {
    const { service, trainingPlans } = coach();
    await service.reconcileExternalActivityHistory(USER, true);
    expect(service.sessionExecutionLink.recomputeAfterCorrection).not.toHaveBeenCalled();
    await service.reconcileExternalActivityHistory(USER, false);
    expect(service.sessionExecutionLink.recomputeAfterCorrection).toHaveBeenCalledWith(USER, expect.any(Date), expect.objectContaining({ kind: 'bulk_reconcile', activityLogIds: [], origin: 'coach' }));
    noGeneration(trainingPlans);
  });

  it('primary-source: atualiza depois de mover os vinculos, com as observacoes cuja canonica mudou', async () => {
    const { service, trainingPlans } = coach();
    await service.setStudentPrimarySource(USER, { provider: 'apple_health' });
    const order = [service.sessionExecutionLink.reconcileAffectedByIdentity, service.sessionExecutionLink.recomputeAfterCorrection].map((fn: jest.Mock) => fn.mock.invocationCallOrder[0]);
    expect(order[0]).toBeLessThan(order[1]);
    expect(service.sessionExecutionLink.recomputeAfterCorrection).toHaveBeenCalledWith(USER, expect.any(Date), expect.objectContaining({ activityLogIds: ['a1', 'a2'], kind: 'bulk_reconcile' }));
    noGeneration(trainingPlans);
  });

  it('edicao de treino com mudanca MATERIAL: refaz a analise (force) e informa antes/depois exatos; edicao de titulo nao faz nada', async () => {
    const { service, trainingPlans } = coach();
    await service.updateTrainingSession(USER, 's1', { modality: 'forca', durationMin: 50 });
    expect(service.sessionExecutionLink.recomputeAfterCorrection).toHaveBeenCalledWith(USER, null, expect.objectContaining({
      sessionIds: ['s1'], forceSessionIds: ['s1'], kind: 'session_edit', origin: 'coach',
      sessionEdit: { sessionId: 's1', fields: { modality: { before: 'corrida', after: 'forca' }, durationMin: { before: 40, after: 50 } }, hasFeedback: true, hasActiveLink: false },
    }));
    service.sessionExecutionLink.recomputeAfterCorrection.mockClear();
    await service.updateTrainingSession(USER, 's1', { title: 'Novo titulo' });
    expect(service.sessionExecutionLink.recomputeAfterCorrection).not.toHaveBeenCalled();
    noGeneration(trainingPlans);
  });

  it('falha ao atualizar as analises NUNCA derruba a acao do treinador (ja gravada) e fica registrada', async () => {
    const { service } = coach();
    service.sessionExecutionLink.recomputeAfterCorrection = jest.fn(async () => { throw new Error('fora do ar'); });
    await expect(service.reclassifyExternalActivity(USER, 'a1')).resolves.toMatchObject({ classification: 'corresponding' });
    await expect(service.updateTrainingSession(USER, 's1', { modality: 'forca' })).resolves.toBeDefined();
    expect(service.logger.warn).toHaveBeenCalled();
  });
});
