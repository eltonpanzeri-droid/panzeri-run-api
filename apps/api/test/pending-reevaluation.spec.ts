import { Logger } from '@nestjs/common';
import {
  markPending, processDueReevaluations, processPendingReevaluation, readPending, registerMedalProcessor, settlePendingReevaluation, viewOf, waitForPendingContinuations,
} from '../src/activity-execution/pending-reevaluation';
import { pendingModel } from './helpers/pending-fake';

// Reavaliacao pendente DURAVEL (CorrectionReevaluation): marcar -> reivindicar (lease) -> processar -> so' remover se nada foi marcado no meio. Sobrevive a
// reinicio (a linha esta no banco), nao processa duas vezes ao mesmo tempo e nunca entrega dado pendente como definitivo.

const analyzeSession = jest.fn();
jest.mock('../src/activity-execution/execution-analysis.service', () => ({
  ExecutionAnalysisService: class { analyzeSession = (...args: unknown[]) => analyzeSession(...args); },
}));

type Row = Record<string, any>;
const USER = 'u1';
const scope = { categories: ['treinos_concluidos'], weeks: ['2026-10-12'], months: ['2026-10'], countsChanged: true, absenceOfData: false, causes: [{ kind: 'link_correction' }] };

function build(initial: Row[] = [], sessions: Row[] = []) {
  const pending = pendingModel(initial);
  const prisma: any = {
    correctionReevaluation: pending.model,
    trainingSession: {
      findMany: jest.fn(async ({ where }: any) => sessions
        .map((s): Row => ({ scheduledDate: new Date('2026-10-10T00:00:00Z'), userId: USER, completion: { id: 'c' }, executionLinks: [], ...s }))
        .filter((s) => (!where.id?.in || where.id.in.includes(s.id)) && s.userId === where.userId)),
    },
  };
  return { prisma, rows: pending.rows };
}
const sess = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}` }));

beforeEach(() => { analyzeSession.mockReset(); analyzeSession.mockResolvedValue({}); registerMedalProcessor(null); jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
afterEach(async () => { await waitForPendingContinuations(); registerMedalProcessor(null); jest.restoreAllMocks(); });

describe('markPending', () => {
  it('cria a linha; novas marcacoes MESCLAM (uniao de sessoes e escopo) e sobem a versao — nada e perdido', async () => {
    const { prisma, rows } = build();
    const first = await markPending(prisma, USER, { analysisSessionIds: ['s1'], medals: { ...scope } });
    expect(first.version).toBe(1);
    const second = await markPending(prisma, USER, { analysisSessionIds: ['s2', 's1'], forceSessionIds: ['s2'], medals: { categories: ['feedbacks'], weeks: ['2026-10-05'], months: ['2026-09'], causes: [{ kind: 'session_edit' }] } });
    expect(second.version).toBe(2);
    expect(second.analysisSessionIds.sort()).toEqual(['s1', 's2']);
    expect(second.forceSessionIds).toEqual(['s2']);
    expect(second.medalScope).toMatchObject({ categories: ['treinos_concluidos', 'feedbacks'], weeks: ['2026-10-05', '2026-10-12'], months: ['2026-09', '2026-10'], countsChanged: true });
    expect(second.medalScope?.causes.map((c) => c.kind)).toEqual(['link_correction', 'session_edit']);
    expect(rows.size).toBe(1);
  });

  it('exclusao de dados (ausencia de dado) e conservadora: uma vez marcada, a reavaliacao inteira nao revoga', async () => {
    const { prisma } = build();
    await markPending(prisma, USER, { medals: { ...scope, absenceOfData: true } });
    const merged = await markPending(prisma, USER, { medals: { ...scope, absenceOfData: false } });
    expect(merged.medalScope?.absenceOfData).toBe(true);
  });
});

describe('processPendingReevaluation', () => {
  it('processa e REMOVE a linha quando nada ficou pendente nem foi marcado no meio', async () => {
    const { prisma, rows } = build([], sess(3));
    await markPending(prisma, USER, { analysisSessionIds: ['s1', 's2', 's3'] });
    const result = await processPendingReevaluation(prisma, USER);
    expect(result.status).toBe('done');
    expect(result.recomputedSessionIds.sort()).toEqual(['s1', 's2', 's3']);
    expect(rows.has(USER)).toBe(false);
    expect((await processPendingReevaluation(prisma, USER)).status).toBe('idle'); // idempotente
  });

  it('SEM processamento duplicado: lease ativo => "busy" e nada e analisado', async () => {
    const { prisma, rows } = build([{ userId: USER, analysisSessionIds: ['s1'], leaseUntil: new Date(Date.now() + 60_000) }], sess(1));
    const result = await processPendingReevaluation(prisma, USER);
    expect(result.status).toBe('busy');
    expect(analyzeSession).not.toHaveBeenCalled();
    expect(rows.get(USER)?.analysisSessionIds).toEqual(['s1']);
  });

  it('lease VENCIDO (processo que caiu no meio) e reivindicado: a pendencia nao fica presa', async () => {
    const { prisma, rows } = build([{ userId: USER, analysisSessionIds: ['s1'], leaseUntil: new Date(Date.now() - 1000), attempts: 2 }], sess(1));
    const result = await processPendingReevaluation(prisma, USER);
    expect(result.status).toBe('done');
    expect(analyzeSession).toHaveBeenCalledTimes(1);
    expect(rows.has(USER)).toBe(false);
  });

  it('marcacao NOVA durante o processamento: a linha nao e removida e e reprocessada na rodada seguinte (nada se perde)', async () => {
    const { prisma, rows } = build([], sess(2));
    await markPending(prisma, USER, { medals: { ...scope } });
    let calls = 0;
    registerMedalProcessor(async () => {
      calls += 1;
      if (calls === 1) await markPending(prisma, USER, { analysisSessionIds: ['s2'] }); // correcao nova chegou enquanto processava
      return { complete: true };
    });
    const result = await processPendingReevaluation(prisma, USER);
    expect(calls).toBe(2); // medalhas reavaliadas de novo
    expect(analyzeSession).toHaveBeenCalledWith(USER, 's2', { force: false });
    expect(result.status).toBe('done');
    expect(rows.has(USER)).toBe(false);
  });

  it('medalhas incompletas (conflito/falha): a linha FICA com o motivo, sem laco apertado; o varredor retoma depois', async () => {
    const { prisma, rows } = build();
    await markPending(prisma, USER, { medals: { ...scope } });
    const medals = jest.fn(async () => ({ complete: false, error: 'conflito em treinos_concluidos_10' }));
    registerMedalProcessor(medals);
    const result = await processPendingReevaluation(prisma, USER);
    await waitForPendingContinuations();
    expect(result.status).toBe('partial');
    expect(result.medals).toBe('pending');
    expect(medals).toHaveBeenCalledTimes(1);
    expect(rows.get(USER)).toMatchObject({ medalsPending: true, lastError: 'conflito em treinos_concluidos_10', leaseUntil: null });
  });

  it('o processador de medalhas que LANCA nao derruba nada: pendencia segue registrada', async () => {
    const { prisma, rows } = build();
    await markPending(prisma, USER, { medals: { ...scope } });
    registerMedalProcessor(async () => { throw new Error('banco fora'); });
    const result = await processPendingReevaluation(prisma, USER);
    expect(result.medals).toBe('pending');
    expect(rows.get(USER)?.medalsPending).toBe(true);
    expect(rows.get(USER)?.lastError).toContain('banco fora');
  });

  it('sem processador de medalhas registrado a pendencia NAO e descartada em silencio', async () => {
    const { prisma, rows } = build();
    await markPending(prisma, USER, { medals: { ...scope } });
    await processPendingReevaluation(prisma, USER);
    expect(rows.get(USER)?.medalsPending).toBe(true);
    expect(rows.get(USER)?.lastError).toContain('processador de medalhas nao registrado');
  });

  it('nunca gera treino: so existem as dependencias de leitura/analise (sem nenhum servico de prescricao envolvido)', async () => {
    const { prisma } = build([], sess(1));
    await markPending(prisma, USER, { analysisSessionIds: ['s1'] });
    await processPendingReevaluation(prisma, USER);
    expect(Object.keys(prisma).sort()).toEqual(['correctionReevaluation', 'trainingSession']);
  });
});

describe('durabilidade: reinicio do servidor', () => {
  it('a linha gravada ANTES do "reinicio" e processada pelo varredor depois, sem nenhuma fila em memoria', async () => {
    // simula o reinicio: so' a linha do banco existe (com um lease de um processo que morreu)
    const { prisma, rows } = build([{ userId: USER, analysisSessionIds: ['s1', 's2'], medalsPending: true, medalScope: scope, leaseUntil: new Date(Date.now() - 5000), attempts: 1, lastAttemptAt: new Date(Date.now() - 3_600_000) }], sess(2));
    const medals = jest.fn(async () => ({ complete: true }));
    registerMedalProcessor(medals);
    const sweep = await processDueReevaluations(prisma);
    expect(sweep).toEqual({ examined: 1, processed: 1 });
    expect(analyzeSession).toHaveBeenCalledTimes(2);
    expect(medals).toHaveBeenCalledTimes(1);
    expect(rows.has(USER)).toBe(false);
  });

  it('varredura respeita lease ativo e espera crescente apos falha (nao martela um erro persistente)', async () => {
    const recent = new Date();
    const { prisma } = build([
      { userId: 'busy', analysisSessionIds: ['s1'], leaseUntil: new Date(Date.now() + 60_000) },
      { userId: 'backoff', analysisSessionIds: ['s1'], attempts: 4, lastAttemptAt: recent },
      { userId: 'due', analysisSessionIds: [], medalsPending: false, attempts: 0, lastAttemptAt: null },
    ]);
    const processed = jest.fn(async () => ({ complete: true }));
    registerMedalProcessor(processed);
    const result = await processDueReevaluations(prisma);
    expect(result.processed).toBe(1); // so' 'due'
  });
});

describe('settlePendingReevaluation e viewOf: leitura consistente', () => {
  it('sem pendencia: nada provisorio (null)', async () => {
    const { prisma } = build();
    expect(await settlePendingReevaluation(prisma, USER)).toBeNull();
    expect(viewOf(null)).toEqual({ updating: false, since: null, medalCategories: [], analysisSessions: 0 });
  });

  it('conclui a pendencia ANTES de ler quando consegue: o dado lido e definitivo (null)', async () => {
    const { prisma } = build([], sess(1));
    await markPending(prisma, USER, { analysisSessionIds: ['s1'], medals: { ...scope } });
    registerMedalProcessor(async () => ({ complete: true }));
    expect(await settlePendingReevaluation(prisma, USER)).toBeNull();
  });

  it('nao conseguiu concluir: devolve o estado (categorias e sessoes pendentes) para a leitura marcar como PROVISORIO', async () => {
    const { prisma } = build([], sess(1));
    await markPending(prisma, USER, { analysisSessionIds: ['s1'], medals: { ...scope } });
    registerMedalProcessor(async () => ({ complete: false }));
    const state = await settlePendingReevaluation(prisma, USER);
    const view = viewOf(state);
    expect(view.updating).toBe(true);
    expect(view.medalCategories).toEqual(['treinos_concluidos']);
  });

  it('processamento lento: a leitura NAO espera alem do orcamento e devolve o estado pendente (provisorio)', async () => {
    const { prisma } = build([], []);
    await markPending(prisma, USER, { medals: { ...scope } });
    registerMedalProcessor(() => new Promise((resolve) => setTimeout(() => resolve({ complete: true }), 150)));
    const started = Date.now();
    const state = await settlePendingReevaluation(prisma, USER, 30);
    expect(Date.now() - started).toBeLessThan(140);
    expect(viewOf(state).updating).toBe(true);
    await new Promise((r) => setTimeout(r, 250)); // o processamento termina em segundo plano e a linha some
    expect(await readPending(prisma, USER)).toBeNull();
  });

  it('erro ao ler o estado nunca lanca na leitura', async () => {
    const prisma: any = { correctionReevaluation: { findUnique: jest.fn(async () => { throw new Error('fora'); }) } };
    await expect(settlePendingReevaluation(prisma, USER)).resolves.toBeNull();
  });
});
