import { ConfigService } from '@nestjs/config';

// O Snapshot do atleta tem teste proprio; aqui so interessa se a FALHA dele vira lacuna explicita.
jest.mock('../src/training-intelligence/compact-agent-context', () => ({ buildCompactAgentContext: () => ({ athleteId: 'u1', generatedAt: 'x' }) }));

import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';
import { StudentProfileService } from '../src/training-plans/student-profile.service';
import { ReportTimelineService } from '../src/reporter/report-timeline.service';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { MethodologyInput } from '../src/training-plans/training-methodology';
import {
  formatObservationForAgent, REPORT_CONTEXT_LIMITS, ReportEntryRow, selectHistoryWeeks, selectRelevantReportEntries,
} from '../src/training-plans/student-information-context';
import { traceStub } from './helpers/trace-stub';

// Etapa 1.1 (09/10/2026) — informacoes do aluno chegam ao Prescritor; o que nao chega fica EXPLICITO; informacao
// desatualizada nao prevalece; planos arquivados nao distorcem o historico. Sem chamada de IA paga: tudo com mocks.

const NOW = new Date('2026-10-08T15:00:00.000Z');
const d = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

function row(overrides: Partial<ReportEntryRow> & { id: string; occurredAt: Date }): ReportEntryRow {
  return {
    sourceType: 'student_observation', relatedLabel: null, originalText: 'texto original', analyzedAt: overrides.occurredAt, analysisError: null,
    createdAt: overrides.occurredAt, facts: 'fato', perception: null, themes: [], temporality: 'ATUAL', longitudinalNote: null, hypotheses: [], relevance: 'ACOMPANHAR',
    ...overrides,
  };
}

describe('selectRelevantReportEntries — a informacao relevante chega, com data e status', () => {
  it('restricao persistente (equipamento) chega MESMO muito antiga; relato pontual e antigo nao polui', () => {
    const rows = [
      row({ id: 'equip', occurredAt: d('2026-01-10'), temporality: 'PERSISTENTE_ATE_CONTRARIO', relevance: 'PONTUAL', facts: 'A academia nao tem hack squat', themes: ['equipamento'] }),
      row({ id: 'esteira', occurredAt: d('2026-03-02'), temporality: 'PERSISTENTE_ATE_CONTRARIO', relevance: 'ACOMPANHAR', facts: 'A esteira vai so ate 12 km/h' }),
      row({ id: 'pontual', occurredAt: d('2026-10-01'), temporality: 'ATUAL', relevance: 'PONTUAL', facts: 'dormiu mal ontem' }),
      row({ id: 'recente', occurredAt: d('2026-10-03'), temporality: 'RECORRENTE', relevance: 'LONGITUDINAL', facts: 'nao consegue cumprir o pace' }),
      row({ id: 'velho-relevante', occurredAt: d('2026-04-01'), temporality: 'ATUAL', relevance: 'ACOMPANHAR', facts: 'fora da janela de 120 dias' }),
    ];
    const { interpreted } = selectRelevantReportEntries(rows, NOW);
    expect(interpreted.map((e) => e.fatos)).toEqual(['A academia nao tem hack squat', 'A esteira vai so ate 12 km/h', 'nao consegue cumprir o pace']);
    expect(interpreted[0]).toMatchObject({ data: '2026-01-10', temporalidade: 'PERSISTENTE_ATE_CONTRARIO', temas: ['equipamento'] });
  });

  it('informacao ATUALIZADA nao e escondida pela antiga: a restricao e o relato RESOLVIDO posterior chegam juntos, em ordem cronologica', () => {
    const rows = [
      row({ id: 'resolvido', occurredAt: d('2026-09-20'), temporality: 'RESOLVIDO', relevance: 'ACOMPANHAR', facts: 'Agora tem esteira em casa, sem limite de velocidade' }),
      row({ id: 'restricao', occurredAt: d('2026-02-01'), temporality: 'PERSISTENTE_ATE_CONTRARIO', relevance: 'ACOMPANHAR', facts: 'Nao tem esteira em casa' }),
    ];
    const { interpreted } = selectRelevantReportEntries(rows, NOW);
    expect(interpreted.map((e) => e.data)).toEqual(['2026-02-01', '2026-09-20']); // o mais recente por ultimo (regra de precedencia no prompt)
    expect(interpreted[1].temporalidade).toBe('RESOLVIDO');
  });

  it('relatos ainda sem interpretacao entram em texto BRUTO, com a situacao correta (em andamento / falhou / parado)', () => {
    const rows = [
      row({ id: 'andamento', occurredAt: d('2026-10-08'), analyzedAt: null, createdAt: new Date(NOW.getTime() - 2 * 60_000), originalText: 'minha esteira so vai ate 12 km/h' }),
      row({ id: 'falhou', occurredAt: d('2026-10-05'), analyzedAt: null, analysisError: 'Analise indisponivel', createdAt: d('2026-10-05'), originalText: 'estou com dor no joelho ha tres dias' }),
      row({ id: 'parado', occurredAt: d('2026-10-01'), analyzedAt: null, createdAt: d('2026-10-01'), originalText: 'vou viajar' }),
    ];
    const { interpreted, pending } = selectRelevantReportEntries(rows, NOW);
    expect(interpreted).toHaveLength(0);
    expect(pending.map((p) => [p.situacao, p.relatoOriginal])).toEqual([
      ['sem_analise', 'vou viajar'],
      ['analise_falhou', 'estou com dor no joelho ha tres dias'],
      ['em_processamento', 'minha esteira so vai ate 12 km/h'],
    ]);
  });

  it('hipoteses do Relator seguem identificadas como hipoteses; o texto original do aluno acompanha', () => {
    const { interpreted } = selectRelevantReportEntries([row({ id: 'a', occurredAt: d('2026-10-04'), hypotheses: ['pode ser sobrecarga'], originalText: 'dor no joelho', perception: 'preocupada' })], NOW);
    expect(interpreted[0]).toMatchObject({ hipotesesDoRelator: ['pode ser sobrecarga'], relatoOriginal: 'dor no joelho', percepcaoDoAluno: 'preocupada' });
  });

  it('limite de tamanho: descarta primeiro os mais ANTIGOS nao persistentes e SEMPRE preserva os persistentes; registra o que ficou de fora', () => {
    const big = 'x'.repeat(480);
    const rows: ReportEntryRow[] = [
      row({ id: 'persist', occurredAt: d('2025-12-01'), temporality: 'PERSISTENTE_ATE_CONTRARIO', facts: big, originalText: big }),
      ...Array.from({ length: 38 }, (_, i) => row({ id: `r${i}`, occurredAt: new Date(NOW.getTime() - (i + 1) * 86_400_000), facts: big, originalText: big, relevance: 'ACOMPANHAR' })),
    ];
    const { interpreted, omittedForBudget } = selectRelevantReportEntries(rows, NOW);
    expect(interpreted.some((e) => e.temporalidade === 'PERSISTENTE_ATE_CONTRARIO')).toBe(true);
    expect(omittedForBudget).toBeGreaterThan(0);
    expect(JSON.stringify(interpreted).length).toBeLessThanOrEqual(REPORT_CONTEXT_LIMITS.totalBudgetChars + 1500);
    // os mais RECENTES foram mantidos
    expect(interpreted.some((e) => e.data === new Date(NOW.getTime() - 86_400_000).toISOString().slice(0, 10))).toBe(true);
  });

  it('observacoes do aluno chegam com a data de registro', () => {
    expect(formatObservationForAgent({ content: 'academia sem leg press', createdAt: d('2026-09-30') })).toBe('[registrada em 2026-09-30] academia sem leg press');
  });
});

describe('selectHistoryWeeks — plano arquivado nao distorce o historico', () => {
  const session = (id: string, completed: boolean) => ({ id, completion: completed ? { status: 'done' } : null });
  const plan = (id: string, start: string, created: string, sessions: ReturnType<typeof session>[], planCode = 0) => ({ id, startDate: d(start), createdAt: d(created), planCode, sessions });

  it('semana regenerada: so o plano mais recente conta; sessoes-fantasma (sem registro) do plano antigo NAO entram', () => {
    const weeks = selectHistoryWeeks([
      plan('v2', '2026-09-21', '2026-09-22', [session('a', true), session('b', false), session('c', false)], 2),
      plan('v1', '2026-09-21', '2026-09-20', [session('x', false), session('y', false), session('z', false), session('w', false)], 1),
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].planId).toBe('v2');
    expect(weeks[0].sessions.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(weeks[0].supersededPlanIds).toEqual(['v1']);
  });

  it('sessao COM registro que ficou no plano antigo nao se perde (execucao real nunca e descartada)', () => {
    const weeks = selectHistoryWeeks([
      plan('v2', '2026-09-21', '2026-09-22', [session('a', false)]),
      plan('v1', '2026-09-21', '2026-09-20', [session('keep', true), session('ghost', false)]),
    ]);
    expect(weeks[0].sessions.map((s) => s.id).sort()).toEqual(['a', 'keep']);
  });

  it('o historico e de 4 SEMANAS, nao de 4 planos: semanas regeneradas muitas vezes nao empurram semanas antigas para fora', () => {
    const plans = [
      plan('s4v3', '2026-09-28', '2026-09-30', [session('p', true)]), plan('s4v2', '2026-09-28', '2026-09-29', [session('o', false)]), plan('s4v1', '2026-09-28', '2026-09-28', [session('n', false)]),
      plan('s3v2', '2026-09-21', '2026-09-23', [session('m', true)]), plan('s3v1', '2026-09-21', '2026-09-21', [session('l', false)]),
      plan('s2', '2026-09-14', '2026-09-14', [session('k', true)]),
      plan('s1', '2026-09-07', '2026-09-07', [session('j', true)]),
      plan('s0', '2026-08-31', '2026-08-31', [session('i', true)]),
    ];
    const weeks = selectHistoryWeeks(plans, 4);
    expect(weeks.map((w) => w.startDate.toISOString().slice(0, 10))).toEqual(['2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07']);
    expect(weeks.map((w) => w.planId)).toEqual(['s4v3', 's3v2', 's2', 's1']);
  });

  it('semana sem regeneracao permanece IDENTICA (sessoes sem registro continuam contando como "sem registro")', () => {
    const weeks = selectHistoryWeeks([plan('only', '2026-09-14', '2026-09-14', [session('a', true), session('b', false)])]);
    expect(weeks[0].sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(weeks[0].supersededPlanIds).toEqual([]);
  });
});

describe('prontuario: falha da condensacao nao faz o evento sumir', () => {
  function build(condensed: string | null, failWith?: Error) {
    const events = [
      { id: 'e1', userId: 'u', code: 'STUDENT_REPORT_ANALYZED', content: 'FATO: esteira so ate 12 km/h', createdAt: d('2026-10-05'), summarizedAt: null as Date | null },
      { id: 'e2', userId: 'u', code: 'PAIN_REPORT', content: 'dor no joelho', createdAt: d('2026-10-06'), summarizedAt: null as Date | null },
    ];
    let profile: { summary: string } | null = { summary: 'RESUMO ANTIGO' };
    const prisma = {
      studentProfile: { findUnique: jest.fn(async () => profile), upsert: jest.fn(async ({ create }: { create: { summary: string } }) => { profile = { summary: create.summary }; return profile; }) },
      studentProfileEvent: {
        findMany: jest.fn(async ({ where }: { where: { summarizedAt: null } }) => events.filter((e) => e.summarizedAt === where.summarizedAt)),
        updateMany: jest.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: { summarizedAt: Date } }) => { events.filter((e) => where.id.in.includes(e.id)).forEach((e) => { e.summarizedAt = data.summarizedAt; }); return { count: 2 }; }),
      },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const agent = { condenseProfile: jest.fn(async () => { if (failWith) throw failWith; return condensed; }) };
    return { service: new StudentProfileService(prisma as never, agent as never), prisma, agent, events };
  }

  it('condensacao OK: eventos viram resumo, nada fica pendente', async () => {
    const { service, events } = build('RESUMO NOVO');
    await expect(service.refreshProfileDetailed('u')).resolves.toMatchObject({ summary: 'RESUMO NOVO', pendingEvents: [], status: 'ok' });
    expect(events.every((e) => e.summarizedAt)).toBe(true);
  });

  it('condensacao FALHOU (IA devolveu nulo): resumo antigo + os eventos novos em texto bruto, status failed, eventos seguem pendentes para a proxima vez', async () => {
    const { service, events } = build(null);
    const result = await service.refreshProfileDetailed('u');
    expect(result.status).toBe('failed');
    expect(result.summary).toBe('RESUMO ANTIGO');
    expect(result.pendingEvents.map((e) => e.content)).toEqual(['FATO: esteira so ate 12 km/h', 'dor no joelho']);
    expect(events.every((e) => e.summarizedAt === null)).toBe(true);
  });

  it('condensacao LANCOU erro: mesmo tratamento — nada se perde e nada e marcado como condensado', async () => {
    const { service, events } = build(null, new Error('timeout'));
    const result = await service.refreshProfileDetailed('u');
    expect(result.status).toBe('failed');
    expect(result.pendingEvents).toHaveLength(2);
    expect(events.every((e) => e.summarizedAt === null)).toBe(true);
  });

  it('leitura SEM IA (regeneracao de um dia): nao chama o agente e devolve pendencias', async () => {
    const { service, agent } = build('x');
    const result = await service.loadProfileContext('u');
    expect(agent.condenseProfile).not.toHaveBeenCalled();
    expect(result.pendingEvents).toHaveLength(2);
    expect(result.summary).toBe('RESUMO ANTIGO');
  });

  it('refreshProfile (API antiga) continua devolvendo so o resumo', async () => {
    const { service } = build(null);
    await expect(service.refreshProfile('u')).resolves.toBe('RESUMO ANTIGO');
  });
});

describe('Relator: reprocessar o que ficou sem interpretacao', () => {
  it('reprocessa so relatos parados (nao os recentes, que podem estar em andamento), com limite, e conta o resultado', async () => {
    const analyzed = new Set<string>();
    const prisma = {
      studentReportEntry: {
        findMany: jest.fn(async () => [{ id: 'a' }, { id: 'b' }]),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({ analyzedAt: analyzed.has(where.id) ? new Date() : null })),
      },
    };
    const service = new ReportTimelineService(prisma as never, {} as never, {} as never);
    jest.spyOn(service, 'analyzeEntry').mockImplementation(async (id: string) => { if (id === 'a') analyzed.add(id); });
    const result = await service.retryStalledAnalyses('u', { max: 3, stalledAfterMs: 10 * 60_000 });
    expect(result).toEqual({ attempted: 2, resolved: 1, stillPending: 1 });
    const query = (prisma.studentReportEntry.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown>; take: number }])[0];
    expect(query.where).toMatchObject({ userId: 'u', analyzedAt: null });
    expect((query.where.createdAt as { lt: Date }).lt.getTime()).toBeLessThan(Date.now() - 9 * 60_000); // nao toca em relato recente
    expect(query.take).toBe(3);
  });
});

describe('o que o Prescritor realmente recebe (prompts)', () => {
  function service() {
    return new PrescriptionAgentService({ get: jest.fn().mockReturnValue('') } as unknown as ConfigService, { enqueue: jest.fn() } as never);
  }
  const base: MethodologyInput = { goal: 'Correr 10km', experience: 'intermediario', answers: { sleep_hours: '7' }, availability: [], history: [], studentDirectives: [], activeObservations: [] };
  const reports = selectRelevantReportEntries([row({ id: 'equip', occurredAt: d('2026-03-02'), temporality: 'PERSISTENTE_ATE_CONTRARIO', facts: 'A esteira vai so ate 12 km/h', originalText: 'minha esteira vai so ate 12 km/h' })], NOW);
  const withContext: MethodologyInput = {
    ...base,
    studentProfileSummary: 'PRONTUARIO X',
    studentReports: reports.interpreted,
    pendingStudentReports: [{ data: '2026-10-08', origem: 'observacao', situacao: 'em_processamento', relatoOriginal: 'nao consigo correr no pace pedido' }],
    pendingProfileEvents: ['[2026-10-06] PAIN_REPORT: dor no joelho'],
    contextGaps: [{ source: 'estado_do_atleta', severity: 'degradado', reason: 'timeout', effect: 'sem estado' }],
  };

  it('geracao semanal: restricao persistente, relato pendente, evento nao condensado e lacunas chegam no contexto', () => {
    const raw = (service() as any).buildUserPrompt(withContext, [], [], false, false, {}, null);
    const prompt = JSON.parse(raw);
    expect(prompt.relatosEstruturadosDoAluno[0]).toMatchObject({ fatos: 'A esteira vai so ate 12 km/h', temporalidade: 'PERSISTENTE_ATE_CONTRARIO' });
    expect(prompt.relatosAindaNaoInterpretadosDoAluno[0].relatoOriginal).toBe('nao consigo correr no pace pedido');
    expect(prompt.eventosDoProntuarioAindaNaoCondensados).toEqual(['[2026-10-06] PAIN_REPORT: dor no joelho']);
    expect(prompt.lacunasDeContexto[0]).toMatchObject({ source: 'estado_do_atleta', severity: 'degradado' });
    expect(prompt.prontuarioDoAluno).toBe('PRONTUARIO X');
  });

  it('sem nada novo: os campos existem e vazios (ausencia explicita, nunca omitida)', () => {
    const prompt = JSON.parse((service() as any).buildUserPrompt(base, [], [], false, false, {}, null));
    expect(prompt.relatosEstruturadosDoAluno).toEqual([]);
    expect(prompt.relatosAindaNaoInterpretadosDoAluno).toEqual([]);
    expect(prompt.eventosDoProntuarioAindaNaoCondensados).toEqual([]);
    expect(prompt.lacunasDeContexto).toEqual([]);
  });

  it('REGENERACAO DE UM DIA DE CORRIDA (antes nao recebia nada disso): recebe prontuario, relatos, pendencias, lacunas e entrevista', () => {
    const prompt = JSON.parse((service() as any).buildRunSessionUserPrompt({
      durationMin: 40, evidence: {}, studentDirectives: [], activeObservations: [], painTier: 'normal', painReason: null,
      answers: base.answers, studentProfileSummary: 'PRONTUARIO X', studentReports: withContext.studentReports, pendingStudentReports: withContext.pendingStudentReports,
      pendingProfileEvents: withContext.pendingProfileEvents, contextGaps: withContext.contextGaps,
    }));
    expect(prompt.relatosEstruturadosDoAluno[0].fatos).toBe('A esteira vai so ate 12 km/h');
    expect(prompt.relatosAindaNaoInterpretadosDoAluno).toHaveLength(1);
    expect(prompt.eventosDoProntuarioAindaNaoCondensados).toHaveLength(1);
    expect(prompt.lacunasDeContexto).toHaveLength(1);
    expect(prompt.prontuarioDoAluno).toBe('PRONTUARIO X');
    expect(prompt.respostasEntrevista).toEqual({ sleep_hours: '7' });
  });

  it('REGENERACAO DE UM DIA DE FORCA: relatos (equipamento da academia) chegam ao agente', () => {
    const prompt = JSON.parse((service() as any).buildSingleStrengthUserPrompt(withContext, { weekday: 2, modality: 'forca', durationMin: 45 }));
    expect(prompt.relatosEstruturadosDoAluno[0].fatos).toBe('A esteira vai so ate 12 km/h');
    expect(prompt.prontuarioDoAluno).toBe('PRONTUARIO X');
    expect(prompt.relatosAindaNaoInterpretadosDoAluno).toHaveLength(1);
  });

  it('os tres prompts de sistema ensinam a precedencia (mais recente prevalece, RESOLVIDO encerra, persistente vale ate contrario) e a natureza das informacoes', () => {
    const weekly = (service() as any).buildSystemPromptStable() as string;
    const run = (service() as any).buildRunSessionSystemPrompt() as string;
    const strength = (service() as any).buildSingleStrengthSystemPrompt() as string;
    for (const text of [weekly, run, strength]) {
      expect(text).toContain('relatosEstruturadosDoAluno');
      expect(text).toContain('RESOLVIDO');
      expect(text).toContain('PERSISTENTE_ATE_CONTRARIO');
      expect(text).toContain('lacunasDeContexto');
    }
    expect(weekly).toContain('RESTRICAO REAL');
    expect(weekly).toContain('DIFICULDADE DE EXECUCAO');
    expect(weekly).toContain('cite-o em rationale');
  });
});

// ── Integracao: o que o TrainingPlansService entrega ao Prescritor ─────────────────────────────────────────────────

describe('regenerateSession (um dia): recebe o MESMO contexto textual da semana, sem chamar IA para condensar', () => {
  function dayHarness(modality: 'corrida' | 'forca') {
    const captured: { run?: Record<string, unknown>; strength?: MethodologyInput } = {};
    const prisma = {
      trainingSession: {
        findFirst: jest.fn().mockResolvedValue({ id: 's1', userId: 'u1', modality, weekday: 3, scheduledDate: new Date('2026-10-07T00:00:00Z'), durationMin: 40, completion: null }),
        update: jest.fn(),
      },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', name: 'Aluna Teste', studentCode: 7, preferences: null }) },
      fitnessTest: { findFirst: jest.fn().mockResolvedValue(null) },
      onboardingInterview: { findUnique: jest.fn().mockResolvedValue({ answers: { weekly_running_km: 'x' } }) },
      studentDirective: { findMany: jest.fn().mockResolvedValue([]) },
      studentObservation: { findMany: jest.fn().mockResolvedValue([{ content: 'academia sem leg press', createdAt: new Date('2026-09-30T12:00:00Z') }]) },
      reassessment: { findFirst: jest.fn().mockResolvedValue(null) },
      studentReportEntry: { findMany: jest.fn().mockResolvedValue([row({ id: 'e', occurredAt: d('2026-03-02'), temporality: 'PERSISTENTE_ATE_CONTRARIO', facts: 'A esteira vai so ate 12 km/h' })]) },
    };
    const studentProfile = {
      refreshProfileDetailed: jest.fn(),
      loadProfileContext: jest.fn().mockResolvedValue({ summary: 'PRONTUARIO', pendingEvents: [{ code: 'PAIN_REPORT', content: 'dor leve', createdAt: d('2026-10-04') }], status: 'not_attempted' }),
    };
    const prescriptionAgent = {
      proposeRunSession: jest.fn(async (params: Record<string, unknown>) => { captured.run = params; return null; }),
      proposeStrengthSession: jest.fn(async (input: MethodologyInput) => { captured.strength = input; return null; }),
    };
    const service = new TrainingPlansService(
      prisma as never, prescriptionAgent as never,
      { computeSafetyTier: jest.fn().mockResolvedValue({ tier: 'normal', reason: null }) } as never, {} as never,
      { notifyCoach: jest.fn().mockResolvedValue(undefined) } as never, studentProfile as never, {} as never, {} as never, {} as never, {} as never,
      { getLatestValidEvolutionReport: jest.fn().mockResolvedValue(null) } as never, {} as never, {} as never, {} as never,
      traceStub(),
    );
    return { service, captured, studentProfile, prisma };
  }

  beforeEach(() => { jest.useFakeTimers({ now: new Date('2026-10-05T15:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout'] }); });
  afterEach(() => { jest.useRealTimers(); });

  it('dia de CORRIDA: prontuario, relatos persistentes, eventos nao condensados, entrevista e observacoes datadas chegam ao agente', async () => {
    const h = dayHarness('corrida');
    await expect(h.service.regenerateSession('u1', 's1')).rejects.toThrow();
    const params = h.captured.run!;
    expect(params.studentProfileSummary).toBe('PRONTUARIO');
    expect((params.studentReports as Array<{ fatos: string }>).map((r) => r.fatos)).toEqual(['A esteira vai so ate 12 km/h']);
    expect(params.pendingProfileEvents).toEqual(['[2026-10-04] PAIN_REPORT: dor leve']);
    expect(params.answers).toEqual({ weekly_running_km: 'x' });
    expect(params.activeObservations).toEqual(['[registrada em 2026-09-30] academia sem leg press']);
    expect(h.studentProfile.refreshProfileDetailed).not.toHaveBeenCalled(); // sem IA de condensacao na regeneracao de um dia
    expect(h.prisma.trainingSession.update).not.toHaveBeenCalled(); // falha da IA => treino existente intocado
  });

  it('dia de FORCA: o mesmo contexto chega (equipamento da academia e restricao real)', async () => {
    const h = dayHarness('forca');
    await expect(h.service.regenerateSession('u1', 's1')).rejects.toThrow();
    const input = h.captured.strength!;
    expect(input.studentProfileSummary).toBe('PRONTUARIO');
    expect(input.studentReports!.map((r) => r.fatos)).toEqual(['A esteira vai so ate 12 km/h']);
    expect(input.activeObservations).toEqual(['[registrada em 2026-09-30] academia sem leg press']);
    expect(input.pendingProfileEvents).toHaveLength(1);
  });
});

describe('generateWeekLocked entrega o contexto textual completo ao Prescritor', () => {
  const SENTINEL = new Error('STOP_AFTER_CAPTURE');

  function harness(opts: { reports?: ReportEntryRow[]; profile?: { summary: string; pendingEvents: Array<{ code: string; content: string; createdAt: Date }>; status: string } | Error; plans?: unknown[]; snapshotFails?: boolean; menstrualFails?: boolean } = {}) {
    const trainingPlanFindMany = jest.fn().mockResolvedValue(opts.plans ?? []);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ subscriptionStatus: 'active' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', name: 'Aluna Teste', studentCode: 42, subscriptionStatus: 'active', healthProfile: null, preferences: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      fitnessTest: { findFirst: jest.fn().mockResolvedValue(null) },
      weeklyAvailability: { findMany: jest.fn().mockResolvedValue([{ weekday: 2, modalities: ['corrida'], availableMin: 40, noTraining: false }]) },
      onboardingInterview: { findUnique: jest.fn().mockResolvedValue({ completedAt: new Date('2026-08-01T00:00:00.000Z'), answers: {} }) },
      trainingPlan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-old', startDate: new Date('2026-09-28T00:00:00.000Z') }), findMany: trainingPlanFindMany, create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      studentDirective: { findMany: jest.fn().mockResolvedValue([]) },
      reassessment: { findFirst: jest.fn().mockResolvedValue(null) },
      studentObservation: { findMany: jest.fn().mockResolvedValue([{ content: 'minha academia nao tem hack squat', createdAt: new Date('2026-09-30T12:00:00Z') }]) },
      trainingSession: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
      weeklyCheckIn: { findFirst: jest.fn().mockResolvedValue(null) },
      studentReportEntry: { findMany: jest.fn().mockResolvedValue(opts.reports ?? []) },
      $transaction: jest.fn(),
    };
    const profile = opts.profile ?? { summary: 'PRONTUARIO', pendingEvents: [], status: 'ok' };
    const studentProfile = {
      refreshProfileDetailed: jest.fn(async () => { if (profile instanceof Error) throw profile; return profile; }),
      loadProfileContext: jest.fn(async () => { if (profile instanceof Error) throw profile; return profile; }),
    };
    const captured: { input?: MethodologyInput } = {};
    const prescriptionAgent = { proposeWeeklyDecision: jest.fn(async (input: MethodologyInput) => { captured.input = input; throw SENTINEL; }) };
    const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
    const reportTimeline = { retryStalledAnalyses: jest.fn().mockResolvedValue({ attempted: 0, resolved: 0, stillPending: 0 }) };
    const service = new TrainingPlansService(
      prisma as never,
      prescriptionAgent as never,
      { computeSafetyTier: jest.fn().mockResolvedValue({ tier: 'normal', reason: null }) } as never,
      { activeGoals: jest.fn().mockResolvedValue([]) } as never,
      telegram as never,
      studentProfile as never,
      {} as never,
      {} as never,
      { getAgentContext: opts.menstrualFails ? jest.fn().mockRejectedValue(new Error('ciclo fora')) : jest.fn().mockResolvedValue(null) } as never,
      { getSnapshot: opts.snapshotFails === false ? jest.fn().mockResolvedValue({}) : jest.fn().mockRejectedValue(new Error('snapshot fora')) } as never,
      { isReassessmentDue: jest.fn().mockResolvedValue(false), getLatestValidEvolutionReport: jest.fn().mockResolvedValue(null) } as never,
      reportTimeline as never,
      {} as never,
      {} as never,
      traceStub(),
    );
    return { service, prisma, captured, telegram, studentProfile, reportTimeline, prescriptionAgent };
  }

  const run = (service: TrainingPlansService) => (service as unknown as { generateWeekLocked: (userId: string) => Promise<unknown> }).generateWeekLocked('u1');

  beforeEach(() => { jest.useFakeTimers({ now: new Date('2026-10-05T15:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout'] }); });
  afterEach(() => { jest.useRealTimers(); });

  it('restricao de equipamento relatada ha meses + relato pendente + observacao datada chegam ao Prescritor', async () => {
    const h = harness({
      snapshotFails: false,
      reports: [
        row({ id: 'equip', occurredAt: d('2026-03-02'), temporality: 'PERSISTENTE_ATE_CONTRARIO', facts: 'A esteira vai so ate 12 km/h' }),
        row({ id: 'novo', occurredAt: d('2026-10-05'), analyzedAt: null, createdAt: new Date('2026-10-05T14:55:00Z'), originalText: 'nao estou conseguindo correr no pace que voce pediu' }),
      ],
    });
    await expect(run(h.service)).rejects.toBe(SENTINEL);
    const input = h.captured.input!;
    expect(input.studentReports!.map((r) => r.fatos)).toEqual(['A esteira vai so ate 12 km/h']);
    expect(input.pendingStudentReports!.map((r) => [r.situacao, r.relatoOriginal])).toEqual([['em_processamento', 'nao estou conseguindo correr no pace que voce pediu']]);
    expect(input.activeObservations).toEqual(['[registrada em 2026-09-30] minha academia nao tem hack squat']);
    expect(input.studentProfileSummary).toBe('PRONTUARIO');
    expect(h.reportTimeline.retryStalledAnalyses).toHaveBeenCalledWith('u1'); // tenta resolver o que ficou parado antes de prescrever
    // informacao pendente e' informativa: nao dispara alerta ao treinador
    expect(h.telegram.notifyCoach).not.toHaveBeenCalledWith(expect.stringContaining('CONTEXTO INCOMPLETO'));
    expect(input.contextGaps!.some((g) => g.source === 'relatos_do_aluno' && g.severity === 'informativo')).toBe(true);
  });

  it('condensacao do prontuario FALHOU: os eventos novos chegam em texto bruto e a lacuna e registrada (informativa)', async () => {
    const h = harness({ snapshotFails: false, profile: { summary: 'RESUMO ANTIGO', pendingEvents: [{ code: 'STUDENT_REPORT_ANALYZED', content: 'FATO: nao tem esteira', createdAt: d('2026-10-04') }], status: 'failed' } });
    await expect(run(h.service)).rejects.toBe(SENTINEL);
    const input = h.captured.input!;
    expect(input.studentProfileSummary).toBe('RESUMO ANTIGO');
    expect(input.pendingProfileEvents).toEqual(['[2026-10-04] STUDENT_REPORT_ANALYZED: FATO: nao tem esteira']);
    expect(input.contextGaps).toEqual([expect.objectContaining({ source: 'prontuario', severity: 'informativo' })]);
  });

  it('falhas de recuperacao NAO sao silenciosas: viram lacunas "degradado" no contexto, no log e em aviso ao treinador (a geracao nao e bloqueada)', async () => {
    const h = harness({ menstrualFails: true, profile: new Error('banco fora') }); // snapshot ja falha por padrao
    await expect(run(h.service)).rejects.toBe(SENTINEL);
    const gaps = h.captured.input!.contextGaps!;
    expect(gaps.filter((g) => g.severity === 'degradado').map((g) => g.source).sort()).toEqual(['ciclo_menstrual', 'estado_do_atleta', 'prontuario']);
    expect(gaps.find((g) => g.source === 'ciclo_menstrual')!.reason).toContain('ciclo fora');
    expect(h.telegram.notifyCoach).toHaveBeenCalledTimes(1);
    const message = h.telegram.notifyCoach.mock.calls[0][0] as string;
    expect(message).toContain('CONTEXTO INCOMPLETO');
    expect(message).toContain('Aluna Teste');
    expect(message).toContain('ciclo_menstrual');
  });

  it('falha ao ler os relatos interpretados: lacuna "degradado" explicita (nunca contexto incompleto em silencio)', async () => {
    const h = harness({ snapshotFails: false });
    (h.prisma.studentReportEntry.findMany as jest.Mock).mockRejectedValue(new Error('tabela indisponivel'));
    await expect(run(h.service)).rejects.toBe(SENTINEL);
    const gap = h.captured.input!.contextGaps!.find((g) => g.source === 'relatos_do_aluno')!;
    expect(gap).toMatchObject({ severity: 'degradado' });
    expect(gap.reason).toContain('tabela indisponivel');
    expect(h.telegram.notifyCoach).toHaveBeenCalledTimes(1);
  });

  it('restricao persistente antiga NAO sai do contexto mesmo havendo centenas de relatos mais novos (leitura propria dos persistentes)', async () => {
    const persistent = row({ id: 'equip', occurredAt: d('2025-11-01'), temporality: 'PERSISTENTE_ATE_CONTRARIO', facts: 'Treina em casa, so tem halteres' });
    const recent = Array.from({ length: 300 }, (_, i) => row({ id: `n${i}`, occurredAt: new Date(NOW.getTime() - i * 3_600_000), relevance: 'PONTUAL' }));
    const h = harness({ snapshotFails: false });
    (h.prisma.studentReportEntry.findMany as jest.Mock).mockImplementation(async ({ where }: { where: { temporality?: string } }) => (where.temporality === 'PERSISTENTE_ATE_CONTRARIO' ? [persistent] : recent));
    await expect(run(h.service)).rejects.toBe(SENTINEL);
    expect(h.captured.input!.studentReports!.map((r) => r.fatos)).toEqual(['Treina em casa, so tem halteres']);
  });

  it('contexto completo: nenhuma lacuna, nenhum aviso ao treinador', async () => {
    const h = harness({ snapshotFails: false });
    await expect(run(h.service)).rejects.toBe(SENTINEL);
    expect(h.captured.input!.contextGaps).toEqual([]);
    expect(h.telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('semanas regeneradas: o historico enviado ao Prescritor conta UMA vez cada semana e ignora sessoes-fantasma', async () => {
    const mkSession = (id: string, completed: boolean) => ({
      id, scheduledDate: new Date('2026-09-22T12:00:00Z'), weekday: 2, modality: 'corrida', sessionType: null, structure: null, distanceKm: 5, durationMin: 40, paceMinSec: null,
      completion: completed ? { status: 'done', distanceKm: 5, durationMin: 40, avgPaceSecondsKm: 480, details: {}, shoeUsage: null } : null,
    });
    const plans = [
      { id: 'v2', startDate: new Date('2026-09-21T00:00:00Z'), createdAt: new Date('2026-09-22T00:00:00Z'), planCode: 2, sessions: [mkSession('a', true), mkSession('b', false)] },
      { id: 'v1', startDate: new Date('2026-09-21T00:00:00Z'), createdAt: new Date('2026-09-20T00:00:00Z'), planCode: 1, sessions: [mkSession('x', false), mkSession('y', false), mkSession('z', false)] },
    ];
    const h = harness({ snapshotFails: false, plans });
    await expect(run(h.service)).rejects.toBe(SENTINEL);
    const history = h.captured.input!.history;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ prescribedSessions: 2, completedSessions: 1, unregisteredSessions: 1, weekStartDate: '2026-09-21' }); // antes: 5 prescritas, 4 "sem registro"
  });

  it('NENHUM treino ja prescrito e alterado em resposta a novos relatos (so o proximo ciclo considera)', async () => {
    const h = harness({ reports: [row({ id: 'n', occurredAt: d('2026-10-05'), analyzedAt: null, originalText: 'nao tenho esteira' })] });
    await expect(run(h.service)).rejects.toBe(SENTINEL);
    expect(h.prisma.trainingSession.update).not.toHaveBeenCalled();
    expect(h.prisma.trainingSession.updateMany).not.toHaveBeenCalled();
    expect(h.prisma.trainingSession.create).not.toHaveBeenCalled();
    expect(h.prisma.trainingPlan.create).not.toHaveBeenCalled();
    expect(h.prisma.trainingPlan.update).not.toHaveBeenCalled();
    expect(h.prisma.trainingPlan.updateMany).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
