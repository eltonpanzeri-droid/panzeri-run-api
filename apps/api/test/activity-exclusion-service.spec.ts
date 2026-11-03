import { SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';

// 01/11/2026 — excluir/ignorar atividade: fluxo do servico com banco simulado (a prova com Postgres real, 35 verificacoes, foi feita a parte). Aqui ficam as regras que nao podem regredir:
// vinculos revogados, sessao sintetica retirada com o feedback da aluna guardado, marca minima na exclusao, desfazer, reavaliacao dentro da trava e quem pode desfazer o que.

type Row = Record<string, any>;

function makeActivity(overrides: Row = {}): Row {
  return {
    id: 'a1', userId: 'u1', provider: 'zepp', externalId: 'e1', rawActivityId: 'r1', startedAt: new Date('2026-11-01T12:00:00.000Z'), utcOffsetMinutes: -180, sport: 'corrida',
    distanceMeters: 12000, durationSec: 4860, avgHeartRateBpm: 167, hasRoute: true, physicalIdentityStatus: null, physicalEventId: null, executionClassification: 'corresponding',
    exclusionMode: null, excludedAt: null, excludedBy: null, excludedById: null, exclusionReason: null, ...overrides,
  };
}

function makeFake(activities: Row[], links: Row[] = [], sessions: Row[] = []) {
  const state = { activities: new Map(activities.map((a) => [a.id, a])), links, sessions, versions: [] as Row[], notes: [] as Row[], wiped: { series: [] as string[], samples: [] as string[], raw: [] as Row[], completions: [] as string[] } };
  const prisma: any = {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    $executeRaw: jest.fn(async () => 0),
    activityLog: {
      findUnique: jest.fn(async ({ where }: Row) => state.activities.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: Row) => [...state.activities.values()].filter((a) => (where.userId ? a.userId === where.userId : true) && (where.exclusionMode ? a.exclusionMode === where.exclusionMode : true) && (where.excludedBy ? a.excludedBy === where.excludedBy : true))),
      update: jest.fn(async ({ where, data }: Row) => Object.assign(state.activities.get(where.id)!, data)),
    },
    sessionExecutionLink: {
      findMany: jest.fn(async ({ where }: Row) => state.links.filter((l) => (where.activityLogId?.in ? where.activityLogId.in.includes(l.activityLogId) : l.activityLogId === where.activityLogId) && where.status.in.includes(l.status))),
      update: jest.fn(async ({ where, data }: Row) => Object.assign(state.links.find((l) => l.id === where.id)!, data)),
      count: jest.fn(async ({ where }: Row) => state.links.filter((l) => l.trainingSessionId === where.trainingSessionId && where.status.in.includes(l.status)).length),
    },
    trainingSession: { findMany: jest.fn(async () => state.sessions), delete: jest.fn(async ({ where }: Row) => { state.sessions = state.sessions.filter((s) => s.id !== where.id); }) },
    workoutCompletion: { delete: jest.fn(async ({ where }: Row) => { state.wiped.completions.push(where.id); }) },
    workoutFeedbackVersion: { create: jest.fn(async ({ data }: Row) => { state.versions.push(data); }) },
    sessionExecutionAnalysis: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    trainingAnalysis: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    activityTimeSeriesPoint: { deleteMany: jest.fn(async ({ where }: Row) => { state.wiped.series.push(where.activityLogId); }) },
    activityHrDecoupling: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    rawActivitySample: { deleteMany: jest.fn(async ({ where }: Row) => { state.wiped.samples.push(where.activityLogId); }) },
    rawExternalActivity: { update: jest.fn(async ({ where, data }: Row) => { state.wiped.raw.push({ id: where.id, data }); }) },
    studentProfileEvent: { create: jest.fn(async ({ data }: Row) => { state.notes.push(data); }) },
  };
  const service = new SessionExecutionLinkService(prisma);
  const recompute = jest.spyOn(service, 'recomputeAfterCorrection').mockResolvedValue({ sessionIds: [], recomputedSessionIds: [], failedSessionIds: [], deferredSessionIds: [] });
  return { state, prisma, service, recompute };
}

const student = { role: 'student' as const, id: 'u1' };
const coach = { role: 'coach' as const, id: 'coach-1' };
const call = (service: SessionExecutionLinkService, over: Row = {}) => service.excludeActivity({ userId: 'u1', activityLogId: 'a1', mode: 'ignored', reason: 'same_workout_registered', actor: student, ...over } as never);

describe('excludeActivity', () => {
  it('ignorar: revoga o vinculo, marca como extra por decisao humana, grava a marca e mantem os dados', async () => {
    const { state, service, recompute } = makeFake([makeActivity()], [{ id: 'l1', activityLogId: 'a1', trainingSessionId: 's1', status: 'active' }]);
    const out = await call(service);
    expect(out).toMatchObject({ alreadyApplied: false, mode: 'ignored', affectedActivityIds: ['a1'] });
    expect(state.links[0]).toMatchObject({ status: 'revoked', note: 'activity_excluded' });
    const a = state.activities.get('a1')!;
    expect(a).toMatchObject({ exclusionMode: 'ignored', excludedBy: 'student', excludedById: 'u1', exclusionReason: 'same_workout_registered', executionClassification: 'alternative', distanceMeters: 12000 });
    expect(a.excludedAt).toBeInstanceOf(Date);
    // a leitura filtrada nao enxerga mais a atividade: o recalculo recebe as datas e as sessoes afetadas de forma explicita
    expect(recompute).toHaveBeenCalledWith('u1', expect.any(Date), expect.objectContaining({ kind: 'activity_excluded', origin: 'student', sessionIds: ['s1'], affectedDates: ['2026-11-01'], absenceOfData: true, force: true }));
  });

  it('excluir: apaga serie, amostras e payload bruto e zera as metricas; sobra so a marca minima', async () => {
    const { state, service } = makeFake([makeActivity({ providerMetrics: { x: 1 } })]);
    await call(service, { mode: 'deleted', reason: 'not_mine_or_error', actor: coach });
    const a = state.activities.get('a1')!;
    expect(a).toMatchObject({ exclusionMode: 'deleted', excludedBy: 'coach', excludedById: 'coach-1', distanceMeters: null, durationSec: null, avgHeartRateBpm: null, hasRoute: false, provider: 'zepp', externalId: 'e1' });
    expect(state.wiped.series).toEqual(['a1']);
    expect(state.wiped.samples).toEqual(['a1']);
    expect(state.wiped.raw).toEqual([{ id: 'r1', data: expect.objectContaining({ payload: {} }) }]);
  });

  it('grava um aviso no Prontuario sem os numeros da atividade', async () => {
    const { state, service } = makeFake([makeActivity()]);
    await call(service);
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0].code).toBe('EXECUTION_LINK_CORRECTED');
    expect(state.notes[0].content).toContain('ignorada');
    expect(state.notes[0].content).not.toMatch(/12000|12 ?km|167|bpm/);
  });

  it('sessao sintetica da atividade extra sai do calendario e o feedback da aluna fica guardado como versao', async () => {
    const synthetic = { id: 'sx', userId: 'u1', origin: 'device_extra', structure: { activityLogId: 'a1' }, completion: { id: 'cx', status: 'done', distanceKm: 1.9, perceivedEffort: 7 } };
    const { state, service, recompute } = makeFake([makeActivity({ executionClassification: 'alternative' })], [], [synthetic]);
    await call(service);
    expect(state.versions).toEqual([expect.objectContaining({ userId: 'u1', sessionId: 'sx', reason: 'activity_excluded', payload: expect.objectContaining({ perceivedEffort: 7 }) })]);
    expect(state.wiped.completions).toEqual(['cx']);
    expect(state.sessions).toHaveLength(0);
    expect(recompute).toHaveBeenCalledWith('u1', expect.any(Date), expect.objectContaining({ completionsChanged: true }));
  });

  it('sessao sintetica so com dados automaticos (sem conteudo da aluna) nao gera versao', async () => {
    const synthetic = { id: 'sx', userId: 'u1', origin: 'device_extra', structure: { activityLogId: 'a1' }, completion: { id: 'cx', status: 'done', distanceKm: 1.9, durationMin: 13 } };
    const { state, service } = makeFake([makeActivity({ executionClassification: 'alternative' })], [], [synthetic]);
    await call(service);
    expect(state.versions).toHaveLength(0);
    expect(state.sessions).toHaveLength(0);
  });

  it('repetir o mesmo pedido e idempotente (sem novo aviso nem novo recalculo)', async () => {
    const { state, service, recompute } = makeFake([makeActivity({ exclusionMode: 'ignored', excludedBy: 'student' })]);
    const out = await call(service);
    expect(out.alreadyApplied).toBe(true);
    expect(state.notes).toHaveLength(0);
    expect(recompute).not.toHaveBeenCalled();
  });

  it('conta de outra aluna recebe 404 e modo/motivo invalidos sao recusados', async () => {
    const { service } = makeFake([makeActivity()]);
    await expect(call(service, { userId: 'u2' })).rejects.toThrow('nao encontrada');
    await expect(call(service, { mode: 'apagar' })).rejects.toThrow('excluir ou ignorar');
    await expect(call(service, { reason: 'x' })).rejects.toThrow('motivo');
  });

  // Defeito apontado na revisao: aluna e treinador agindo ao mesmo tempo; o estado precisa ser relido DENTRO da trava.
  it('uma exclusao concluida por outra pessoa no meio do caminho nao e sobrescrita por "ignorar"', async () => {
    const stale = makeActivity();
    const { state, prisma, service } = makeFake([makeActivity({ exclusionMode: 'deleted', excludedBy: 'coach' })]);
    prisma.activityLog.findUnique.mockImplementationOnce(async () => stale);
    await expect(call(service)).rejects.toThrow('ja foi excluida');
    expect(state.activities.get('a1')!.exclusionMode).toBe('deleted');
    expect(state.notes).toHaveLength(0);
  });

  it('o evento fisico inteiro e retirado junto (todas as observacoes do mesmo treino)', async () => {
    const a = makeActivity({ physicalIdentityStatus: 'matched', physicalEventId: 'ev1', physicalCanonicalActivityLogId: 'a1' });
    const b = makeActivity({ id: 'a2', provider: 'health_connect', externalId: 'h1', rawActivityId: 'r2', physicalIdentityStatus: 'matched', physicalEventId: 'ev1', physicalCanonicalActivityLogId: 'a1' });
    const { state, prisma, service } = makeFake([a, b]);
    prisma.activityLog.findMany.mockImplementation(async ({ where }: Row) => [...state.activities.values()].filter((x) => x.physicalEventId === where.physicalEventId));
    const out = await call(service);
    expect([...out.affectedActivityIds].sort()).toEqual(['a1', 'a2']);
    expect(state.activities.get('a2')).toMatchObject({ exclusionMode: 'ignored', excludedBy: 'student' });
    expect(state.notes[0].content).toContain('2 registros da mesma corrida');
  });
});

describe('restoreActivity e lista de ignoradas', () => {
  it('desfazer ignorar limpa a marca, mantem os dados e pede o recalculo das datas', async () => {
    const { state, service, recompute } = makeFake([makeActivity({ exclusionMode: 'ignored', excludedBy: 'student', excludedById: 'u1', exclusionReason: 'dont_count', excludedAt: new Date() })]);
    const out = await service.restoreActivity({ userId: 'u1', activityLogId: 'a1', actor: student });
    expect(out.restoredActivityIds).toEqual(['a1']);
    expect(state.activities.get('a1')).toMatchObject({ exclusionMode: null, excludedAt: null, excludedBy: null, excludedById: null, exclusionReason: null, distanceMeters: 12000 });
    expect(recompute).toHaveBeenCalledWith('u1', expect.any(Date), expect.objectContaining({ kind: 'activity_excluded', activityLogIds: ['a1'], affectedDates: ['2026-11-01'] }));
  });

  it('excluida nao volta; atividade nao ignorada e conta de outra aluna sao recusadas', async () => {
    const { service } = makeFake([makeActivity({ id: 'd1', exclusionMode: 'deleted' }), makeActivity({ id: 'n1' })]);
    await expect(service.restoreActivity({ userId: 'u1', activityLogId: 'd1', actor: student })).rejects.toThrow('nao pode ser recuperada');
    await expect(service.restoreActivity({ userId: 'u1', activityLogId: 'n1', actor: student })).rejects.toThrow('nao esta ignorada');
    await expect(service.restoreActivity({ userId: 'u2', activityLogId: 'n1', actor: { role: 'student', id: 'u2' } })).rejects.toThrow('nao encontrada');
  });

  it('a aluna nao desfaz o que o treinador ignorou; o treinador desfaz', async () => {
    const { state, service } = makeFake([makeActivity({ exclusionMode: 'ignored', excludedBy: 'coach', excludedById: 'coach-1' })]);
    await expect(service.restoreActivity({ userId: 'u1', activityLogId: 'a1', actor: student })).rejects.toThrow('ignorada pelo treinador');
    expect(state.activities.get('a1')!.exclusionMode).toBe('ignored');
    await expect(service.restoreActivity({ userId: 'u1', activityLogId: 'a1', actor: coach })).resolves.toMatchObject({ restoredActivityIds: ['a1'] });
    expect(state.activities.get('a1')!.exclusionMode).toBeNull();
  });

  it('a lista da aluna traz so as que ela mesma ignorou', async () => {
    const { prisma, service } = makeFake([makeActivity({ id: 'm', exclusionMode: 'ignored', excludedBy: 'student' }), makeActivity({ id: 'c', exclusionMode: 'ignored', excludedBy: 'coach' }), makeActivity({ id: 'x', exclusionMode: 'deleted', excludedBy: 'student' })]);
    const list = await service.listIgnoredForStudent('u1');
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', exclusionMode: 'ignored', excludedBy: 'student' } }));
    expect(list.map((row: Row) => row.id)).toEqual(['m']);
  });
});
