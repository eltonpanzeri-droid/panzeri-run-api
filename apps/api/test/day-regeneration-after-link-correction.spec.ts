import { TrainingAnalystService } from '../src/training-plans/training-analyst.service';
import { buildEvidenceIndex } from '../src/training-plans/prescription-trace';
import { MethodologyInput } from '../src/training-plans/training-methodology';

// Lote 3 (15/10/2026) — regeneracao de um dia APOS correcao de vinculo. O retrato entregue com o programa e' historico e nunca e' reescrito; se um vinculo que
// ele toca foi corrigido depois, a evidencia enviada ao Prescritor e' RECALCULADA so' para leitura (ou retirada, se o recalculo falhar) e o que foi usado
// fica registrado no pacote de evidencias.

type Row = Record<string, any>;
const USER = 'u1';
const PLAN = 'plan-1';
const DELIVERED_AT = new Date('2026-10-12T09:00:00Z');
const AFTER = new Date('2026-10-13T15:00:00Z');

const finding = (code: string, statement: string) => ({ code, statement, kind: 'divergencia', support: 'alta', horizon: 'recente', data: {} });
const contract = (scope: 'week' | 'longitudinal', statement: string, sessionIds: string[], activityLogIds: string[], providers = ['polar']) => ({
  schema: 'training-analysis/1', analystVersion: 1, scope, period: { start: '2026-10-05', end: '2026-10-11' }, asOf: '2026-10-11',
  facts: [], reported: [], findings: [finding(`${scope}:achado`, statement)], gaps: [], capabilities: [], changes: [],
  evidence: { sessionIds, activityLogIds, providers, windowsDays: [], limitations: [], madeWithoutAI: true as const },
});

function build(opts: { links?: Row[]; linkQueryThrows?: boolean; extraRows?: Row[] } = {}) {
  const delivered: Row[] = [
    { id: 'tw', userId: USER, scope: 'week', deliveredWithPlanId: PLAN, status: 'active', computedAt: DELIVERED_AT, contract: contract('week', 'ANTIGO-semana: corrida de domingo cumpriu a faixa', ['s-run'], ['a-run']) },
    { id: 'tl', userId: USER, scope: 'longitudinal', deliveredWithPlanId: PLAN, status: 'active', computedAt: DELIVERED_AT, contract: contract('longitudinal', 'ANTIGO-evolucao: ritmo estavel', ['s-run', 's-old'], ['a-run']) },
    ...(opts.extraRows ?? []),
  ];
  const prisma: any = {
    trainingAnalysis: {
      findMany: jest.fn(async ({ where }: any) => delivered.filter((r) => (where.scope?.in ? where.scope.in.includes(r.scope) : true) && (where.deliveredWithPlanId === undefined || r.deliveredWithPlanId === where.deliveredWithPlanId) && (where.status === undefined || r.status === where.status))),
      create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(),
    },
    sessionExecutionLink: {
      findMany: jest.fn(async () => { if (opts.linkQueryThrows) throw new Error('banco fora'); return opts.links ?? []; }),
    },
    trainingPlan: { findUnique: jest.fn(async () => ({ userId: USER, startDate: new Date('2026-10-12T00:00:00Z') })) },
    weeklyExecutionReport: { findFirst: jest.fn(async () => ({ analyzedPlanId: 'plan-0', weekStartDate: new Date('2026-10-05T00:00:00Z') })) },
    trainingSession: {
      findMany: jest.fn(async () => [
        { id: 's-run', origin: null, modality: 'corrida' },
        { id: 's-extra', origin: 'student_extra', modality: 'corrida' }, // extra: fora da semana anterior prescrita
        { id: 's-other', origin: null, modality: 'natacao' }, // modalidade nao analisada
      ]),
    },
  };
  const executionAnalysis = { prepareWeeklyReport: jest.fn(async () => ({ indicators: { marker: 'fresh-week-indicators' } })) };
  const service = new TrainingAnalystService(prisma as never, executionAnalysis as never, {} as never);
  jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { service, prisma, executionAnalysis, delivered };
}

const freshDraft = (overrides: Row = {}) => ({
  asOf: '2026-10-11',
  week: contract('week', 'ATUAL-semana: corrida de domingo vinculada ao treino correto', ['s-run'], ['a-run']),
  longitudinal: contract('longitudinal', 'ATUAL-evolucao: ritmo em melhora', ['s-run'], ['a-run'], ['apple']),
  sessions: [], promptEvidence: null, providers: ['apple'], sessionIds: ['s-run'], ...overrides,
});

const link = (id: string, extra: Row = {}) => ({ id, trainingSessionId: 's-run', activityLogId: 'a-run', origin: 'student', note: null, createdAt: new Date('2026-10-01T00:00:00Z'), revokedAt: null, ...extra });
const text = (value: unknown) => JSON.stringify(value);

describe('regeneracao de um dia: sem correcao posterior ao retrato', () => {
  it('usa o retrato entregue como sempre (sem recalculo, sem registro de correcao)', async () => {
    const { service, prisma } = build({ links: [link('l-old')] }); // vinculo anterior ao retrato: nao e' correcao
    const recompute = jest.spyOn(service as any, 'recomputeForRead');
    const result = await service.forDayRegeneration(USER, PLAN);
    expect(recompute).not.toHaveBeenCalled();
    expect(result?.correction).toBeNull();
    expect(text(result?.promptEvidence)).toContain('ANTIGO-semana');
    expect(result?.providers).toEqual(['polar']);
    expect(prisma.trainingAnalysis.create).not.toHaveBeenCalled();
  });

  it('correcao em sessao/atividade que o retrato NAO toca nao invalida nada', async () => {
    const { service } = build({ links: [link('l-x', { trainingSessionId: 's-outra', activityLogId: 'a-outra', createdAt: AFTER })] });
    const recompute = jest.spyOn(service as any, 'recomputeForRead');
    const result = await service.forDayRegeneration(USER, PLAN);
    expect(recompute).not.toHaveBeenCalled();
    expect(result?.correction).toBeNull();
  });

  it('plano sem retrato entregue continua devolvendo null', async () => {
    const { service, delivered } = build();
    delivered.length = 0;
    expect(await service.forDayRegeneration(USER, PLAN)).toBeNull();
  });
});

describe('regeneracao de um dia: apos correcao de vinculo (opcao A)', () => {
  const corrected = () => build({ links: [link('l1', { status: 'revoked', createdAt: new Date('2026-10-10T00:00:00Z'), revokedAt: AFTER, note: 'student_unlinked' })] });

  it('o retrato entregue sai da evidencia; a evidencia vem do recalculo para leitura, com aviso e registro do que foi corrigido', async () => {
    const { service } = corrected();
    const recompute = jest.spyOn(service as any, 'recomputeForRead').mockResolvedValue(freshDraft());
    const result = await service.forDayRegeneration(USER, PLAN);
    const evidence = text(result?.promptEvidence);
    expect(evidence).toContain('ATUAL-semana');
    expect(evidence).not.toContain('ANTIGO');
    expect(result?.promptEvidence).toMatchObject({ correcaoDeVinculo: { correcoes: [{ acao: 'vinculo de atividade desfeito' }] } });
    expect(result?.providers).toEqual(['apple']); // provedores da evidencia ATUAL, nao do retrato antigo
    expect(recompute).toHaveBeenCalledWith(USER, PLAN);
    expect(result?.correction).toMatchObject({
      recalculatedForRead: true,
      retratosEntregues: ['tw', 'tl'],
      correcoes: [{ linkId: 'l1', acao: 'vinculo_revogado', origem: 'student', trainingSessionId: 's-run', activityLogId: 'a-run' }],
      usadasNaEvidenciaAtual: { sessionIds: ['s-run'], activityLogIds: ['a-run'] },
      retiradasDaEvidencia: { sessionIds: [], activityLogIds: [] },
    });
  });

  it('o que a correcao tirou da evidencia fica registrado como "retirado" (atividade desvinculada nao e mais usada)', async () => {
    const { service } = corrected();
    jest.spyOn(service as any, 'recomputeForRead').mockResolvedValue(freshDraft({
      week: contract('week', 'ATUAL-semana', [], []), longitudinal: contract('longitudinal', 'ATUAL-evolucao', ['s-old'], []),
    }));
    const result = await service.forDayRegeneration(USER, PLAN);
    expect(result?.correction?.usadasNaEvidenciaAtual).toEqual({ sessionIds: [], activityLogIds: [] });
    expect(result?.correction?.retiradasDaEvidencia).toEqual({ sessionIds: ['s-run'], activityLogIds: ['a-run'] });
  });

  it('retratos entregues NAO sao alterados nem apagados (nenhuma escrita em TrainingAnalysis)', async () => {
    const { service, prisma, delivered } = corrected();
    const before = text(delivered);
    jest.spyOn(service as any, 'recomputeForRead').mockResolvedValue(freshDraft());
    await service.forDayRegeneration(USER, PLAN);
    for (const fn of [prisma.trainingAnalysis.create, prisma.trainingAnalysis.update, prisma.trainingAnalysis.updateMany, prisma.trainingAnalysis.delete, prisma.trainingAnalysis.deleteMany]) expect(fn).not.toHaveBeenCalled();
    expect(text(delivered)).toBe(before);
  });

  it('FALHA do recalculo: o retrato antigo e RETIRADO (nada obsoleto segue ao Prescritor) e a falha fica registrada', async () => {
    const { service } = corrected();
    jest.spyOn(service as any, 'recomputeForRead').mockRejectedValue(new Error('timeout'));
    const result = await service.forDayRegeneration(USER, PLAN);
    expect(result?.promptEvidence).toBeNull();
    expect(result?.providers).toEqual([]);
    expect(result?.correction).toMatchObject({ recalculatedForRead: false, motivo: expect.stringContaining('falhou') });
    expect((service as any).logger.error).toHaveBeenCalled();
  });

  it('nao conseguir VERIFICAR as correcoes tambem retira o retrato (nunca presume que esta valido)', async () => {
    const { service } = build({ linkQueryThrows: true });
    const recompute = jest.spyOn(service as any, 'recomputeForRead');
    const result = await service.forDayRegeneration(USER, PLAN);
    expect(recompute).not.toHaveBeenCalled();
    expect(result?.promptEvidence).toBeNull();
    expect(result?.correction).toMatchObject({ recalculatedForRead: false, motivo: expect.stringContaining('verificar') });
  });

  it('vinculo CRIADO apos o retrato (atividade passou a cumprir um treino) tambem invalida e e registrado', async () => {
    const { service } = build({ links: [link('l2', { createdAt: AFTER })] });
    jest.spyOn(service as any, 'recomputeForRead').mockResolvedValue(freshDraft());
    const result = await service.forDayRegeneration(USER, PLAN);
    expect(result?.correction?.correcoes.map((c) => c.acao)).toEqual(['vinculo_criado']);
  });

  it('criar e revogar o mesmo vinculo depois do retrato gera as duas entradas, sem duplicar', async () => {
    const { service } = build({ links: [link('l3', { createdAt: AFTER, revokedAt: new Date('2026-10-13T16:00:00Z') })] });
    jest.spyOn(service as any, 'recomputeForRead').mockResolvedValue(freshDraft());
    const result = await service.forDayRegeneration(USER, PLAN);
    expect(result?.correction?.correcoes.map((c) => c.acao)).toEqual(['vinculo_criado', 'vinculo_revogado']);
  });
});

describe('recalculo para leitura (recomputeForRead)', () => {
  it('usa a semana do programa, a semana anterior do relatorio entregue (so treinos prescritos analisados) e NAO persiste', async () => {
    const { service, executionAnalysis } = build();
    const buildForGeneration = jest.spyOn(service, 'buildForGeneration').mockResolvedValue(freshDraft() as never);
    await (service as any).recomputeForRead(USER, PLAN);
    expect(executionAnalysis.prepareWeeklyReport).toHaveBeenCalledWith(USER, { startDate: new Date('2026-10-05T00:00:00Z'), planId: 'plan-0', sessionIds: ['s-run'] });
    expect(buildForGeneration).toHaveBeenCalledWith(
      USER, new Date('2026-10-12T00:00:00Z'),
      { startDate: new Date('2026-10-05T00:00:00Z'), sessionIds: ['s-run'], indicators: { marker: 'fresh-week-indicators' } },
      { persist: false },
    );
  });

  it('plano de outro aluno nao e recalculado', async () => {
    const { service, prisma } = build();
    prisma.trainingPlan.findUnique = jest.fn(async () => ({ userId: 'outro', startDate: new Date() }));
    const buildForGeneration = jest.spyOn(service, 'buildForGeneration');
    expect(await (service as any).recomputeForRead(USER, PLAN)).toBeNull();
    expect(buildForGeneration).not.toHaveBeenCalled();
  });

  it('buildForGeneration com persist=false nao grava o retrato vivo; com o padrao grava', async () => {
    const run = async (options?: { persist?: boolean }) => {
      const { service } = build();
      const s: any = service;
      jest.spyOn(s, 'ensureRows').mockResolvedValue(undefined);
      jest.spyOn(s, 'loadRows').mockResolvedValue([{ sessionId: 's-run', scheduledDate: '2026-10-07', modality: 'corrida', isExtra: false, activityLogId: null, provider: null, analysis: { kind: 'not_done', version: 1, modality: 'corrida', reason: 'sem_registro', prescribedKm: null, prescribedDurationMin: null } }]);
      jest.spyOn(s, 'loadFeedback').mockResolvedValue(new Map());
      jest.spyOn(s, 'prescriptionContexts').mockResolvedValue(new Map());
      jest.spyOn(s, 'loadTrends').mockResolvedValue([]);
      jest.spyOn(s, 'loadOtherActivities').mockResolvedValue({ items: [], providers: [], activityLogIds: [] });
      const upsert = jest.spyOn(s, 'upsertSession').mockResolvedValue(undefined);
      (service as any).prisma.trainingSession.findMany = jest.fn(async () => []);
      await service.buildForGeneration(USER, new Date('2026-10-12T00:00:00Z'), { startDate: new Date('2026-10-05T00:00:00Z'), sessionIds: ['s-run'], indicators: null }, options);
      return upsert.mock.calls.length;
    };
    expect(await run({ persist: false })).toBe(0);
    expect(await run()).toBe(1);
  });

  it('sessao sem comprovacao continua "sem registro", nunca "nao realizada" (tratamento preservado no relatorio da semana)', async () => {
    const { buildWeeklyExecutionIndicators } = await import('../src/activity-execution/execution-report');
    const indicators = buildWeeklyExecutionIndicators('2026-10-05', [
      { sessionId: 's1', scheduledDate: '2026-10-07', modality: 'corrida', kind: 'run', analysis: { kind: 'not_done', version: 1, modality: 'corrida', reason: 'sem_registro', prescribedKm: 5, prescribedDurationMin: null } as never, activityLogId: null, provider: null },
    ]);
    expect(indicators.overview).toMatchObject({ noRecord: 1, notPerformed: 0, performed: 0 });
  });
});

describe('TrainingAnalystService.read: nunca apresenta analise desatualizada como atual', () => {
  const live = (id: string, status: string) => ({ id, userId: USER, scope: 'session', refKey: id, deliveredWithPlanId: null, status, computedAt: DELIVERED_AT, periodEnd: DELIVERED_AT, contract: contract('week', 'x', ['s-run'], ['a-run']) });

  it('rotula cada linha: viva atual, viva desatualizada por correcao, retrato entregue (com contagem de correcoes posteriores)', async () => {
    const { service, prisma } = build({ links: [link('l1', { status: 'revoked', revokedAt: AFTER })] });
    prisma.trainingAnalysis.findMany = jest.fn(async () => [live('v1', 'active'), live('v2', 'stale'), live('v3', 'invalidated'),
      { id: 'tw', userId: USER, scope: 'week', deliveredWithPlanId: PLAN, status: 'active', computedAt: DELIVERED_AT, periodEnd: DELIVERED_AT, contract: contract('week', 'ANTIGO', ['s-run'], ['a-run']) },
      { id: 'tz', userId: USER, scope: 'week', deliveredWithPlanId: 'plan-9', status: 'active', computedAt: DELIVERED_AT, periodEnd: DELIVERED_AT, contract: contract('week', 'outro', ['s-z'], ['a-z']) },
    ]);
    const rows: Row[] = await service.read(USER, {});
    const by = Object.fromEntries(rows.map((r) => [r.id, [r.atualidade, r.correcoesPosteriores]]));
    expect(by).toEqual({ v1: ['atual', null], v2: ['desatualizada_por_correcao_de_vinculo', null], v3: ['invalidada', null], tw: ['retrato_entregue', 1], tz: ['retrato_entregue', 0] });
    expect(rows).toHaveLength(5); // nada some: historico preservado
    expect(rows.find((r) => r.id === 'tw')?.contract).toBeDefined(); // conteudo original intacto
  });

  it('se nao for possivel verificar as correcoes, o retrato entregue vem com correcoesPosteriores=null (desconhecido), nao 0', async () => {
    const { service, prisma } = build({ linkQueryThrows: true });
    prisma.trainingAnalysis.findMany = jest.fn(async () => [{ id: 'tw', userId: USER, scope: 'week', deliveredWithPlanId: PLAN, status: 'active', computedAt: DELIVERED_AT, periodEnd: DELIVERED_AT, contract: contract('week', 'ANTIGO', ['s-run'], ['a-run']) }]);
    const rows: Row[] = await service.read(USER, {});
    expect(rows[0]).toMatchObject({ atualidade: 'retrato_entregue', correcoesPosteriores: null });
  });
});

describe('pacote de evidencias: registra o que foi corrigido e usado', () => {
  const input = { goal: 'x', experience: '', answers: {}, availability: [], history: [] } as unknown as MethodologyInput;
  const base = { input, directives: [], observations: [], interpretedReportIds: [], pendingReportIds: [], pendingProfileEventIds: [], historyWeeks: [], checkIn: null, targetRaces: [], reassessment: null, evolutionReport: null, interviewCompletedAt: null, paceSource: null, contextGaps: [] };
  const correction = {
    recalculatedForRead: true, motivo: 'motivo', retratosEntregues: ['tw'], correcoes: [{ linkId: 'l1', acao: 'vinculo_revogado' as const, origem: 'student', quando: AFTER.toISOString(), trainingSessionId: 's-run', activityLogId: 'a-run', nota: null }],
    usadasNaEvidenciaAtual: { sessionIds: ['s-run'], activityLogIds: [] }, retiradasDaEvidencia: { sessionIds: [], activityLogIds: ['a-run'] },
  };

  it('com correcao: um item training_analysis_correction com as correcoes e o que ficou/saiu da evidencia', () => {
    const item = buildEvidenceIndex({ ...base, analysisCorrection: correction }).find((i) => i.ref === 'training_analysis_correction');
    expect(item).toMatchObject({ kind: 'training_analysis_correction', source: 'SessionExecutionLink', delivery: 'delivered', correction });
  });

  it('recalculo falhou: o item aparece como "ausente" (a evidencia nao foi entregue)', () => {
    const item = buildEvidenceIndex({ ...base, analysisCorrection: { ...correction, recalculatedForRead: false } }).find((i) => i.ref === 'training_analysis_correction');
    expect(item?.delivery).toBe('absent');
  });

  it('sem correcao: nenhum item extra (nada inventado)', () => {
    expect(buildEvidenceIndex({ ...base, analysisCorrection: null }).map((i) => i.ref)).toEqual(['availability:week']);
  });
});
