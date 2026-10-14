import { SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';
import { findStaleAnalysisRowIds } from '../src/activity-execution/analysis-validity';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { waitForBackgroundRecompute } from '../src/activity-execution/analysis-recompute';
import { Logger } from '@nestjs/common';
import { pendingModel } from './helpers/pending-fake';

// 15/10/2026 — correcao de vinculo pelo aluno x analises derivadas. Garante: (1) leitura nunca usa analise calculada com um vinculo que ja' foi corrigido;
// (2) a correcao dispara o recalculo das sessoes afetadas (inclusive a que perdeu o ultimo vinculo), sem tocar historico, classificacao nem feedback;
// (3) falha de recalculo nao desfaz a decisao do aluno e nao deixa evidencia obsoleta valer.

const analyzeSession = jest.fn();
jest.mock('../src/activity-execution/execution-analysis.service', () => ({
  ExecutionAnalysisService: jest.fn().mockImplementation(() => ({ analyzeSession })),
}));

type Row = Record<string, any>;

function fakePrisma(seed: { activities?: Row[]; sessions?: Row[]; links?: Row[]; analyses?: Row[]; trainingAnalyses?: Row[] }) {
  const activities = new Map((seed.activities ?? []).map((a) => [a.id, { ...a }]));
  const sessions = new Map((seed.sessions ?? []).map((s) => [s.id, { ...s }]));
  const links = new Map<string, Row>((seed.links ?? []).map((l) => [l.id, { createdAt: new Date('2026-10-01T00:00:00Z'), revokedAt: null, ...l }] as [string, Row]));
  const trainingAnalyses = (seed.trainingAnalyses ?? []).map((t) => ({ ...t }));
  const pending = pendingModel();
  const inList = (value: any, filter: any) => (filter?.in ? filter.in.includes(value) : filter === undefined || filter === value);
  const linkMatches = (l: Row, where: any) => {
    if (where.userId !== undefined && l.userId !== where.userId) return false;
    if (where.trainingSessionId !== undefined && !inList(l.trainingSessionId, where.trainingSessionId)) return false;
    if (where.activityLogId !== undefined && !inList(l.activityLogId, where.activityLogId)) return false;
    if (where.status !== undefined && !inList(l.status, where.status)) return false;
    if (where.OR) {
      const hit = where.OR.some((c: any) => (c.createdAt ? l.createdAt >= c.createdAt.gte : false) || (c.revokedAt ? l.revokedAt != null && l.revokedAt >= c.revokedAt.gte : false));
      if (!hit) return false;
    }
    return true;
  };
  const prisma: any = {
    correctionReevaluation: pending.model,
    activityLog: {
      findUnique: jest.fn(async ({ where }: any) => activities.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => [...activities.values()].filter((a) => inList(a.id, where.id) && (where.userId === undefined || a.userId === where.userId))),
      update: jest.fn(async ({ where, data }: any) => { const next = { ...activities.get(where.id), ...data }; activities.set(where.id, next); return next; }),
    },
    sessionExecutionLink: {
      findMany: jest.fn(async ({ where }: any) => [...links.values()].filter((l) => linkMatches(l, where))),
      update: jest.fn(async ({ where, data }: any) => { const next = { ...links.get(where.id), ...data }; links.set(where.id, next); return next; }),
    },
    trainingSession: {
      findUnique: jest.fn(async ({ where }: any) => sessions.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        [...sessions.values()]
          .filter((s) => inList(s.id, where.id) && (where.userId === undefined || s.userId === where.userId))
          .map((s) => ({ scheduledDate: new Date('2026-10-10T00:00:00Z'), ...s, executionLinks: [...links.values()].filter((l) => l.trainingSessionId === s.id && l.status === 'active') }))),
    },
    trainingAnalysis: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const t of trainingAnalyses) {
          if (t.userId === where.userId && t.scope === where.scope && where.refKey.in.includes(t.refKey) && t.deliveredWithPlanId === where.deliveredWithPlanId && t.status === where.status) { Object.assign(t, data); count += 1; }
        }
        return { count };
      }),
    },
  };
  return { prisma, links, activities, trainingAnalyses, pending };
}

const USER = 'u1';
const act = (id: string, extra: Row = {}) => ({ id, userId: USER, startedAt: new Date('2026-10-05T10:00:00Z'), utcOffsetMinutes: -180, physicalEventId: null, executionClassification: 'corresponding', executionClassifiedBy: 'automatic', ...extra });
const link = (id: string, trainingSessionId: string, activityLogId: string, extra: Row = {}) => ({ id, userId: USER, trainingSessionId, activityLogId, status: 'active', origin: 'automatic', note: null, ...extra });

beforeEach(() => { analyzeSession.mockReset(); analyzeSession.mockResolvedValue({ analysis: {} }); });

describe('defesa de leitura: linha de analise obsoleta', () => {
  const row = (id: string, trainingSessionId: string, activityLogId: string | null) => ({ id, trainingSessionId, activityLogId });

  it('valida: mesma atividade vinculada, ou mesmo evento fisico (observacao canonica diferente da vinculada)', async () => {
    const { prisma } = fakePrisma({
      activities: [act('a1'), act('a2', { physicalEventId: 'ev1' }), act('a3', { physicalEventId: 'ev1' })],
      links: [link('l1', 's1', 'a1'), link('l2', 's2', 'a3')],
    });
    const stale = await findStaleAnalysisRowIds(prisma, [row('r1', 's1', 'a1'), row('r2', 's2', 'a2')]);
    expect([...stale]).toEqual([]);
  });

  it('valida: sessao de forca sem atividade e sem vinculo (linha sem atividade)', async () => {
    const { prisma } = fakePrisma({});
    expect([...(await findStaleAnalysisRowIds(prisma, [row('r1', 's9', null)]))]).toEqual([]);
  });

  it('obsoleta: a sessao perdeu o ultimo vinculo (desvinculo) — a linha com atividade nao vale mais', async () => {
    const { prisma } = fakePrisma({ activities: [act('a1')], links: [link('l1', 's1', 'a1', { status: 'revoked' })] });
    expect([...(await findStaleAnalysisRowIds(prisma, [row('r1', 's1', 'a1')]))]).toEqual(['r1']);
  });

  it('obsoleta: o vinculo foi trocado para OUTRA atividade/evento', async () => {
    const { prisma } = fakePrisma({
      activities: [act('a1', { physicalEventId: 'ev1' }), act('a2', { physicalEventId: 'ev2' })],
      links: [link('l1', 's1', 'a1', { status: 'revoked' }), link('l2', 's1', 'a2')],
    });
    expect([...(await findStaleAnalysisRowIds(prisma, [row('r1', 's1', 'a1')]))]).toEqual(['r1']);
  });

  it('obsoleta: a sessao GANHOU atividade depois de analisada sem atividade', async () => {
    const { prisma } = fakePrisma({ activities: [act('a1')], links: [link('l1', 's1', 'a1')] });
    expect([...(await findStaleAnalysisRowIds(prisma, [row('r1', 's1', null)]))]).toEqual(['r1']);
  });

  it('nao grava nem apaga nada: so le (historico preservado)', async () => {
    const { prisma, links } = fakePrisma({ activities: [act('a1')], links: [link('l1', 's1', 'a1', { status: 'revoked' })] });
    await findStaleAnalysisRowIds(prisma, [row('r1', 's1', 'a1')]);
    expect(prisma.sessionExecutionLink.update).not.toHaveBeenCalled();
    expect(links.get('l1')?.status).toBe('revoked');
  });
});

describe('leitor de observacoes execution.*: nao usa linha obsoleta', () => {
  const analysisRow = (id: string, trainingSessionId: string, activityLogId: string | null, ratio: number) => ({
    id, userId: USER, trainingSessionId, activityLogId, provider: 'polar', modality: 'corrida', scheduledDate: new Date('2026-10-10T00:00:00Z'), algorithmVersion: 1, status: 'analyzed',
    indicators: { kind: 'run', totals: { completionRatio: ratio } },
  });

  it('a linha cujo vinculo foi desfeito sai da serie; a linha ainda valida permanece', async () => {
    const { prisma } = fakePrisma({
      activities: [act('a1'), act('a2')],
      links: [link('l1', 's1', 'a1', { status: 'revoked' }), link('l2', 's2', 'a2')],
    });
    prisma.sessionExecutionAnalysis = { findMany: jest.fn(async () => [analysisRow('r1', 's1', 'a1', 0.5), analysisRow('r2', 's2', 'a2', 1.0)]) };
    const reader = new ObservationReaderService(prisma as never, {} as never, {} as never);
    const observations = await reader.getObservations(USER, 'execution.distanceCompletionRatio');
    expect(observations.map((o) => [o.context.sessionId, o.value])).toEqual([['s2', 1.0]]);
  });
});

describe('pos-correcao centralizado (recomputeAfterCorrection)', () => {
  const baseSeed = () => ({
    activities: [act('a1')],
    sessions: [
      { id: 's1', userId: USER, completion: { id: 'c1' } }, // tem feedback
      { id: 's2', userId: USER, completion: null }, // sem feedback
      { id: 's3', userId: USER, completion: null },
    ],
    trainingAnalyses: [
      { id: 't1', userId: USER, scope: 'session', refKey: 's1', deliveredWithPlanId: null, status: 'active' },
      { id: 't2', userId: USER, scope: 'session', refKey: 's1', deliveredWithPlanId: 'planX', status: 'active' }, // retrato ENTREGUE: nunca tocado
      { id: 't3', userId: USER, scope: 'session', refKey: 's9', deliveredWithPlanId: null, status: 'active' }, // sessao nao afetada
    ],
  });

  it('desvinculo: sessao que perdeu o ultimo vinculo MAS tem feedback e' + " recalculada; sem feedback e sem vinculo NAO ganha linha 'nao feita'", async () => {
    const { prisma } = fakePrisma({ ...baseSeed(), links: [link('l1', 's1', 'a1'), link('l2', 's2', 'a1')] });
    const service = new SessionExecutionLinkService(prisma);
    const since = new Date('2026-10-14T12:00:00Z');
    // simula a correcao do aluno: os dois vinculos sao revogados "agora"
    prisma.sessionExecutionLink.update({ where: { id: 'l1' }, data: { status: 'revoked', revokedAt: new Date('2026-10-14T12:00:01Z') } });
    prisma.sessionExecutionLink.update({ where: { id: 'l2' }, data: { status: 'revoked', revokedAt: new Date('2026-10-14T12:00:01Z') } });
    const result = await service.recomputeAfterCorrection(USER, since);
    expect(result.sessionIds.sort()).toEqual(['s1', 's2']);
    expect(analyzeSession).toHaveBeenCalledTimes(1);
    expect(analyzeSession).toHaveBeenCalledWith(USER, 's1', { force: false }); // a impressao digital ja muda com o vinculo: sem forcar
    expect(result.failedSessionIds).toEqual([]);
  });

  it('vinculo novo: a sessao que ganhou a atividade e a que perdeu sao recalculadas; vinculos e classificacao nao sao alterados', async () => {
    const { prisma, links, activities } = fakePrisma({
      ...baseSeed(),
      links: [link('l1', 's1', 'a1', { status: 'revoked', revokedAt: new Date('2026-10-14T12:00:01Z') }), link('l3', 's3', 'a1', { createdAt: new Date('2026-10-14T12:00:01Z'), origin: 'student' })],
    });
    const before = JSON.stringify([...links.values()]) + JSON.stringify([...activities.values()]);
    const service = new SessionExecutionLinkService(prisma);
    const result = await service.recomputeAfterCorrection(USER, new Date('2026-10-14T12:00:00Z'));
    expect(result.sessionIds.sort()).toEqual(['s1', 's3']);
    expect(analyzeSession.mock.calls.map((c) => c[1]).sort()).toEqual(['s1', 's3']); // s3 tem vinculo ativo agora
    expect(JSON.stringify([...links.values()]) + JSON.stringify([...activities.values()])).toBe(before);
    expect(prisma.activityLog.update).not.toHaveBeenCalled();
  });

  it('marca como desatualizado so o retrato VIVO das sessoes afetadas — nunca o entregue com o programa nem o de outras sessoes', async () => {
    const seed = baseSeed();
    const { prisma, trainingAnalyses } = fakePrisma({ ...seed, links: [link('l1', 's1', 'a1', { status: 'revoked', revokedAt: new Date('2026-10-14T12:00:01Z') })] });
    await new SessionExecutionLinkService(prisma).recomputeAfterCorrection(USER, new Date('2026-10-14T12:00:00Z'));
    expect(trainingAnalyses.find((t) => t.id === 't1')?.status).toBe('stale');
    expect(trainingAnalyses.find((t) => t.id === 't2')?.status).toBe('active');
    expect(trainingAnalyses.find((t) => t.id === 't3')?.status).toBe('active');
  });

  it('falha no recalculo de uma sessao: NAO lanca, as demais continuam e a falha e' + ' devolvida (nunca silenciosa)', async () => {
    const seed = baseSeed();
    const { prisma } = fakePrisma({
      ...seed,
      sessions: [{ id: 's1', userId: USER, completion: { id: 'c1' } }, { id: 's3', userId: USER, completion: { id: 'c3' } }],
      links: [link('l1', 's1', 'a1', { status: 'revoked', revokedAt: new Date('2026-10-14T12:00:01Z') }), link('l3', 's3', 'a1', { createdAt: new Date('2026-10-14T12:00:01Z') })],
    });
    let attemptsOfS1 = 0;
    analyzeSession.mockImplementation(async (_u: string, id: string) => { if (id === 's1' && ++attemptsOfS1 === 1) throw new Error('banco indisponivel'); return { analysis: {} }; });
    const service = new SessionExecutionLinkService(prisma);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const result = await service.recomputeAfterCorrection(USER, new Date('2026-10-14T12:00:00Z'));
    expect(result.failedSessionIds).toEqual(['s1']);
    expect(result.recomputedSessionIds).toEqual(['s3']);
    expect(result.deferredSessionIds).toEqual(['s1']); // a falha continua PENDENTE na linha duravel (nova tentativa)
    await waitForBackgroundRecompute(USER);
    expect(analyzeSession.mock.calls.filter((c) => c[1] === 's1')).toHaveLength(2); // tentativa original + nova tentativa
    expect(analyzeSession.mock.calls.filter((c) => c[1] === 's3')).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('s1'));
    errorSpy.mockRestore();
  });

  it('falha ao ler o historico de vinculos tambem nao lanca (a decisao do aluno ja foi gravada)', async () => {
    const { prisma } = fakePrisma({});
    prisma.sessionExecutionLink.findMany = jest.fn(async () => { throw new Error('fora do ar'); });
    const service = new SessionExecutionLinkService(prisma);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.recomputeAfterCorrection(USER, new Date())).resolves.toEqual({ sessionIds: [], recomputedSessionIds: [], failedSessionIds: [], deferredSessionIds: [] });
  });
});

describe('correcao manual do aluno dispara o pos-correcao e preserva historico/decisao', () => {
  it('unlinkActivityAsStudent: revoga (historico fica), marca extra por decisao do aluno e recalcula a sessao afetada', async () => {
    const { prisma, links, activities } = fakePrisma({
      activities: [act('a1')],
      sessions: [{ id: 's1', userId: USER, completion: { id: 'c1' } }],
      links: [link('l1', 's1', 'a1')],
    });
    const service = new SessionExecutionLinkService(prisma);
    const result = await service.unlinkActivityAsStudent(USER, 'a1', null);
    expect(result).toMatchObject({ classification: 'alternative', revokedLinkIds: ['l1'] });
    expect(links.get('l1')).toMatchObject({ status: 'revoked', note: 'student_unlinked' }); // linha preservada, nao apagada
    expect(activities.get('a1')).toMatchObject({ executionClassification: 'alternative', executionClassifiedBy: 'student' }); // decisao humana (protegida na reconciliacao)
    expect(analyzeSession).toHaveBeenCalledWith(USER, 's1', { force: false }); // a impressao digital ja muda com o vinculo: sem forcar
  });

  it('o feedback (RPE) da sessao nao e tocado pela correcao: nenhuma escrita em completion', async () => {
    const { prisma } = fakePrisma({
      activities: [act('a1')],
      sessions: [{ id: 's1', userId: USER, completion: { id: 'c1', perceivedEffort: 8 } }],
      links: [link('l1', 's1', 'a1')],
    });
    prisma.workoutCompletion = { update: jest.fn(), create: jest.fn(), delete: jest.fn(), updateMany: jest.fn() };
    await new SessionExecutionLinkService(prisma).unlinkActivityAsStudent(USER, 'a1', null);
    for (const fn of Object.values(prisma.workoutCompletion) as jest.Mock[]) expect(fn).not.toHaveBeenCalled();
  });
});

describe('Analista: nao usa linha obsoleta e refaz so as que ainda tem fonte', () => {
  const since = new Date('2026-09-01T00:00:00Z');
  const until = new Date('2026-10-14T00:00:00Z');
  const analysisRow = (id: string, trainingSessionId: string, activityLogId: string | null) => ({
    id, userId: USER, trainingSessionId, activityLogId, provider: 'polar', modality: 'corrida', scheduledDate: new Date('2026-10-05T00:00:00Z'), algorithmVersion: 1, status: 'analyzed', indicators: { kind: 'run', signature: {} },
  });

  function analyst(seed: Parameters<typeof fakePrisma>[0], rows: Row[], candidates: Row[]) {
    const { prisma } = fakePrisma(seed);
    prisma.sessionExecutionAnalysis = { findMany: jest.fn(async () => rows) };
    const findManySessions = prisma.trainingSession.findMany;
    prisma.trainingSession.findMany = jest.fn(async (args: any) => (args.where?.OR ? candidates : findManySessions(args)));
    const { TrainingAnalystService } = jest.requireActual('../src/training-plans/training-analyst.service');
    const executionAnalysis = { analyzeSession: jest.fn(async () => null) };
    const service = new TrainingAnalystService(prisma as never, executionAnalysis as never, {} as never) as any;
    return { service, executionAnalysis };
  }

  it('loadRows descarta a linha cujo vinculo foi desfeito (nao entra como evidencia da analise)', async () => {
    const { service } = analyst(
      { activities: [act('a1'), act('a2')], sessions: [{ id: 's1', userId: USER }, { id: 's2', userId: USER }], links: [link('l1', 's1', 'a1', { status: 'revoked' }), link('l2', 's2', 'a2')] },
      [analysisRow('r1', 's1', 'a1'), analysisRow('r2', 's2', 'a2')], [],
    );
    const rows = await service.loadRows(USER, since, until);
    expect(rows.map((r: Row) => r.sessionId)).toEqual(['s2']);
  });

  it('ensureRows refaz a sessao obsoleta que ainda tem fonte; a que perdeu tudo (sem feedback e sem vinculo) nao ganha linha "nao feita"', async () => {
    const { service, executionAnalysis } = analyst(
      {
        activities: [act('a1'), act('a2')],
        sessions: [{ id: 's1', userId: USER }, { id: 's2', userId: USER }],
        links: [link('l1', 's1', 'a1', { status: 'revoked' }), link('l2', 's2', 'a2', { status: 'revoked' })],
      },
      [analysisRow('r1', 's1', 'a1'), analysisRow('r2', 's2', 'a2')],
      [{ id: 's1' }], // s1 ainda tem feedback (candidata); s2 nao tem feedback nem vinculo
    );
    await service.ensureRows(USER, since, until, []);
    expect(executionAnalysis.analyzeSession.mock.calls.map((c: any[]) => c[1])).toEqual(['s1']);
  });
});
