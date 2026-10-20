import { runWithAiScope } from '../src/ai-governance/ai-scope';
import { neutralizePlansForAi, neutralizeSessionsForAi } from '../src/ai-governance/ai-session-filter';
import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { ExecutionAnalysisService } from '../src/activity-execution/execution-analysis.service';
import { StudentProfileService } from '../src/training-plans/student-profile.service';
import { TrainingAnalystService } from '../src/training-plans/training-analyst.service';

// Cada leitor que alimenta um agente de IA trata como INEXISTENTES os dados de provedores bloqueados no escopo — e, fora de escopo, nada muda.
type Row = Record<string, any>;
const scope = (blocked: string[], userId = 'u1') => ({ userId, destination: 'external_ai' as const, blocked, computedAt: Date.now() });
const inScope = <T>(blocked: string[], fn: () => Promise<T>) => runWithAiScope(scope(blocked), fn);

// ActivityLog em memoria que honra userId, id.in, executionClassification.in/igual e provider.notIn (o filtro que importa).
function activityStore(rows: Row[]) {
  const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([key, cond]) => {
    if (key === 'startedAt') return true;
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(value);
      if ('notIn' in cond) return !cond.notIn.includes(value);
      return true;
    }
    return value === cond;
  });
  return { findMany: jest.fn(async ({ where }: Row) => rows.filter((r) => matches(r, where))) };
}

const link = (provider: string, over: Row = {}) => ({ activityLog: { provider, startedAt: new Date('2026-10-12T10:00:00Z'), distanceMeters: 10000, durationSec: 3000, avgHeartRateBpm: 150, maxHeartRateBpm: 170, ...over } });
const completion = (over: Row = {}) => ({ status: 'done', distanceKm: 10, durationMin: 50, avgHeartRate: 150, maxHeartRate: 170, avgPaceSecondsKm: 300, perceivedEffort: 7, notes: 'ok', ...over });
const session = (over: Row = {}) => ({ origin: 'agent', structure: null, completion: completion(), executionLinks: [link('zepp')], ...over });

describe('neutralizeSessionsForAi', () => {
  it('fora de escopo, ou sem provedor bloqueado, devolve a MESMA lista (comportamento identico ao anterior)', async () => {
    const list = [session()];
    expect(neutralizeSessionsForAi(list)).toBe(list);
    await inScope([], async () => expect(neutralizeSessionsForAi(list)).toBe(list));
  });

  it('provedor bloqueado: vinculo some e as colunas que ERAM COPIA do relogio viram null; o que e do aluno permanece', async () => {
    const original = session();
    const [out] = await inScope(['zepp'], async () => neutralizeSessionsForAi([original]));
    expect(out.executionLinks).toEqual([]);
    expect(out.completion).toMatchObject({ distanceKm: null, durationMin: null, avgHeartRate: null, maxHeartRate: null, avgPaceSecondsKm: null, perceivedEffort: 7, notes: 'ok', status: 'done' });
    expect(original.completion.distanceKm).toBe(10); // nunca muta o original
    expect(original.executionLinks).toHaveLength(1);
  });

  it('valor DIGITADO/editado pelo aluno (nao e copia) permanece, mesmo com vinculo bloqueado', async () => {
    const edited = session({ completion: completion({ distanceKm: 10.4, durationMin: 55, avgHeartRate: 148 }) });
    const [out] = await inScope(['zepp'], async () => neutralizeSessionsForAi([edited]));
    expect(out.completion).toMatchObject({ distanceKm: 10.4, durationMin: 55, avgHeartRate: 148 });
  });

  it('vinculo de outro provedor (elegivel) e preservado; so o bloqueado sai', async () => {
    const mixed = session({ executionLinks: [link('zepp'), link('polar', { distanceMeters: 10050 })] });
    const [out] = await inScope(['zepp'], async () => neutralizeSessionsForAi([mixed]));
    expect(out.executionLinks.map((l: Row) => l.activityLog.provider)).toEqual(['polar']);
  });

  it('sessao sintetica do relogio (device_extra) de provedor bloqueado some por inteiro; de provedor elegivel ou sem provedor permanece', async () => {
    const extras = [
      session({ origin: 'device_extra', structure: { provider: 'zepp' }, executionLinks: [] }),
      session({ origin: 'device_extra', structure: { provider: 'polar' }, executionLinks: [] }),
      session({ origin: 'device_extra', structure: {}, executionLinks: [] }),
    ];
    const out = await inScope(['zepp'], async () => neutralizeSessionsForAi(extras));
    expect(out).toHaveLength(2);
    expect(out.map((s) => (s.structure as any)?.provider)).toEqual(['polar', undefined]);
  });

  it('neutralizePlansForAi aplica a regra as sessoes de cada plano', async () => {
    const plans = [{ id: 'p', sessions: [session()] }];
    const out = await inScope(['zepp'], async () => neutralizePlansForAi(plans));
    expect(out[0].sessions[0].executionLinks).toEqual([]);
    expect(plans[0].sessions[0].executionLinks).toHaveLength(1);
  });
});

describe('EvolutionMetricService (serie que alimenta Training Intelligence e o Agente de Evolucao)', () => {
  const rows = [
    { id: 'polar-1', userId: 'u1', provider: 'polar', startedAt: new Date('2026-08-03T10:00:00Z'), utcOffsetMinutes: 0, distanceMeters: 10000, executionClassification: 'corresponding', sport: 'corrida', physicalIdentityStatus: 'matched', physicalEventId: 'E', physicalCanonicalActivityLogId: 'zepp-1' },
    { id: 'zepp-1', userId: 'u1', provider: 'zepp', startedAt: new Date('2026-08-03T10:00:05Z'), utcOffsetMinutes: 0, distanceMeters: 10050, executionClassification: 'corresponding', sport: 'corrida', physicalIdentityStatus: 'matched', physicalEventId: 'E', physicalCanonicalActivityLogId: 'zepp-1' },
    { id: 'zepp-2', userId: 'u1', provider: 'zepp', startedAt: new Date('2026-08-04T10:00:00Z'), utcOffsetMinutes: 0, distanceMeters: 5000, executionClassification: 'corresponding', sport: 'corrida', physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: 'zepp-2' },
  ];
  const build = () => new EvolutionMetricService({ activityLog: activityStore(rows) } as never) as unknown as { fetchRealizedActivities(u: string): Promise<Array<{ id: string; distanceKm: number | null }>> };

  it('fora de escopo: a canonica do evento (Zepp) representa o evento e as duas atividades contam', async () => {
    const out = await build().fetchRealizedActivities('u1');
    expect(out.map((a) => [a.id, a.distanceKm]).sort()).toEqual([['zepp-1', 10.05], ['zepp-2', 5]]);
  });

  it('em escopo: o Zepp some e o evento passa a ser representado pela observacao ELEGIVEL (fallback para outra fonte autorizada) — antes de escolher a canonica', async () => {
    const out = await inScope(['zepp'], () => build().fetchRealizedActivities('u1'));
    expect(out.map((a) => [a.id, a.distanceKm])).toEqual([['polar-1', 10]]);
  });

  it('em escopo, as sessoes partem sem os dados do provedor bloqueado (vinculo, copia e sessao sintetica)', async () => {
    const sessions = [
      { id: 's1', scheduledDate: new Date('2026-08-03T00:00:00Z'), modality: 'corrida', distanceKm: 10, structure: null, origin: 'agent', plan: { status: 'active' }, completion: completion({ status: 'done' }), executionLinks: [link('zepp')] },
      { id: 's2', scheduledDate: new Date('2026-08-04T00:00:00Z'), modality: 'corrida', distanceKm: null, structure: { provider: 'zepp' }, origin: 'device_extra', plan: { status: 'active' }, completion: completion(), executionLinks: [] },
    ];
    const service = new EvolutionMetricService({ trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) }, activityLog: activityStore([]) } as never) as unknown as { fetchRawSessions(u: string): Promise<Row[]> };
    const open = await service.fetchRawSessions('u1');
    expect(open.map((s) => [s.sessionId, s.hasActiveLink, s.distanceKm])).toEqual([['s1', true, 10], ['s2', false, 10]]);
    const scoped = await inScope(['zepp'], () => service.fetchRawSessions('u1'));
    expect(scoped.map((s) => [s.sessionId, s.hasActiveLink, s.distanceKm])).toEqual([['s1', false, null]]);
  });
});

describe('ObservationReaderService (Training Intelligence)', () => {
  it('atividade objetiva: provedor bloqueado nao vira observacao', async () => {
    const rows = [
      { id: 'a', userId: 'u1', provider: 'polar', sport: 'corrida', startedAt: new Date('2026-10-03T09:00:00Z'), distanceMeters: 10000, durationSec: 3000, cadenceAvg: 170, executionClassification: 'corresponding', physicalIdentityStatus: null },
      { id: 'b', userId: 'u1', provider: 'zepp', sport: 'corrida', startedAt: new Date('2026-10-04T09:00:00Z'), distanceMeters: 10000, durationSec: 2900, cadenceAvg: 175, executionClassification: 'corresponding', physicalIdentityStatus: null },
    ];
    const reader = new ObservationReaderService({ activityLog: activityStore(rows) } as never, {} as never, {} as never);
    expect((await reader.getObservations('u1', 'activity.cadenceAvg')).map((o) => o.value)).toEqual([170, 175]);
    const scoped = await inScope(['zepp'], () => reader.getObservations('u1', 'activity.cadenceAvg'));
    expect(scoped.map((o) => [o.value, o.context.provider])).toEqual([[170, 'polar']]);
  });

  it('analise de execucao: a consulta exclui linhas de provedor bloqueado (mantendo as sem provedor); fora de escopo a consulta e a de antes', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const reader = new ObservationReaderService({ sessionExecutionAnalysis: { findMany } } as never, {} as never, {} as never);
    await reader.getObservations('u1', 'execution.timeInBandPct');
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('OR');
    await inScope(['zepp'], () => reader.getObservations('u1', 'execution.timeInBandPct'));
    expect(findMany.mock.calls[1][0].where.OR).toEqual([{ provider: null }, { provider: { notIn: ['zepp'] } }]);
  });
});

describe('TrainingAnalystService', () => {
  it('atividades extras (alternativas) enviadas ao Prescritor ignoram provedor bloqueado, inclusive na escolha da canonica', async () => {
    const rows = [
      { id: 'p', userId: 'u1', provider: 'polar', sport: 'natacao', startedAt: new Date('2026-10-05T10:00:00Z'), durationSec: 1800, executionClassification: 'alternative', physicalIdentityStatus: null },
      { id: 'z', userId: 'u1', provider: 'zepp', sport: 'natacao', startedAt: new Date('2026-10-06T10:00:00Z'), durationSec: 3600, executionClassification: 'alternative', physicalIdentityStatus: null },
    ];
    const analyst = new TrainingAnalystService({ activityLog: activityStore(rows) } as never, {} as never, {} as never) as unknown as { loadOtherActivities(u: string, f: Date, t: Date): Promise<{ items: Row[]; providers: string[]; activityLogIds: string[] }> };
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-10-30T00:00:00Z');
    const open = await analyst.loadOtherActivities('u1', from, to);
    expect(open.providers).toEqual(['polar', 'zepp']);
    const scoped = await inScope(['zepp'], () => analyst.loadOtherActivities('u1', from, to));
    expect(scoped.providers).toEqual(['polar']);
    expect(scoped.activityLogIds).toEqual(['p']);
  });
});

describe('ExecutionAnalysisService.analyzeSession na visao para IA', () => {
  function build() {
    const base = {
      id: 'sess', userId: 'u1', modality: 'corrida', origin: 'agent', distanceKm: 10, durationMin: 50, structure: null, scheduledDate: new Date('2026-10-05T00:00:00Z'),
      completion: null,
      executionLinks: [{ activityLog: { id: 'zl', provider: 'zepp', startedAt: new Date('2026-10-05T10:00:00Z'), distanceMeters: 10000, durationSec: 3000, avgHeartRateBpm: 150, maxHeartRateBpm: 170, cadenceAvg: 170, caloriesKcal: 700, physicalIdentityStatus: null, physicalEventId: null, physicalCanonicalActivityLogId: null } }],
    };
    const upsert = jest.fn();
    const prisma = {
      trainingSession: { findFirst: jest.fn().mockResolvedValue(base) },
      activityLog: activityStore([]),
      activityTimeSeriesPoint: { aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _min: {}, _max: {} }), findMany: jest.fn().mockResolvedValue([]) },
      sessionExecutionAnalysis: { findUnique: jest.fn().mockResolvedValue(null), upsert },
    };
    return { service: new ExecutionAnalysisService(prisma as never), upsert };
  }

  it('visao completa grava a linha com o provedor; visao para IA recalcula SEM o provedor bloqueado e NUNCA grava', async () => {
    const { service, upsert } = build();
    const full = await service.analyzeSession('u1', 'sess');
    expect(full?.provider).toBe('zepp');
    expect(upsert).toHaveBeenCalledTimes(1);

    const { service: s2, upsert: upsert2 } = build();
    const forAi = await inScope(['zepp'], () => s2.analyzeSession('u1', 'sess', { forAi: true }));
    expect(forAi?.provider).toBeNull();
    expect(forAi?.activityLogId).toBeNull();
    expect(forAi?.analysis.kind).toBe('not_done'); // sem registro nenhum fora o dado bloqueado => "sem registro", nunca invencao
    expect(upsert2).not.toHaveBeenCalled();
  });
});

describe('StudentProfileService: eventos do prontuario derivados de provedor bloqueado', () => {
  function build(events: Row[]) {
    const updateMany = jest.fn();
    const prisma = {
      studentProfile: { findUnique: jest.fn().mockResolvedValue({ summary: 'resumo' }), upsert: jest.fn() },
      studentProfileEvent: { findMany: jest.fn().mockResolvedValue(events), updateMany },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    const condense = jest.fn().mockResolvedValue('novo resumo');
    return { service: new StudentProfileService(prisma as never, { condenseProfile: condense } as never), condense, updateMany };
  }
  const ev = (id: string, sourceProviders: unknown = null) => ({ id, code: 'X', content: `texto ${id}`, createdAt: new Date('2026-10-01T00:00:00Z'), sourceProviders });

  it('evento de provedor bloqueado NAO e condensado nem marcado como condensado (continua pendente para pessoas); os demais seguem', async () => {
    const { service, condense, updateMany } = build([ev('a'), ev('b', ['zepp']), ev('c', ['polar'])]);
    await inScope(['zepp'], () => service.refreshProfileDetailed('u1'));
    expect(condense.mock.calls[0][0].newEvents.map((e: Row) => e.content)).toEqual(['texto a', 'texto c']);
    expect(updateMany.mock.calls[0][0].where.id.in).toEqual(['a', 'c']);
  });

  it('so ha evento bloqueado: nada e enviado (nem chamada ao agente)', async () => {
    const { service, condense } = build([ev('b', ['zepp'])]);
    const result = await inScope(['zepp'], () => service.refreshProfileDetailed('u1'));
    expect(condense).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'nothing_pending', pendingEvents: [] });
    expect((await inScope(['zepp'], () => service.loadProfileContext('u1'))).pendingEvents).toEqual([]);
  });

  it('fora de escopo (ou sem bloqueio) todos os eventos seguem como antes', async () => {
    const { service, condense } = build([ev('a'), ev('b', ['zepp'])]);
    await service.refreshProfileDetailed('u1');
    expect(condense.mock.calls[0][0].newEvents).toHaveLength(2);
  });
});
