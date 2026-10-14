import { Logger } from '@nestjs/common';
import { PendingReevaluationSweeperService } from '../src/activity-execution/pending-reevaluation-sweeper.service';
import { registerMedalProcessor, waitForPendingContinuations } from '../src/activity-execution/pending-reevaluation';
import { pendingModel } from './helpers/pending-fake';

// Varredor: retoma, sozinho, correcoes que ficaram pendentes (inclusive apos reinicio do servidor) — a pendencia vive no banco, nao na memoria.
jest.mock('../src/activity-execution/execution-analysis.service', () => ({ ExecutionAnalysisService: class { analyzeSession = jest.fn(); } }));

const scope = { categories: ['treinos_concluidos'], weeks: [], months: [], countsChanged: true, absenceOfData: false, causes: [] };

afterEach(async () => { await waitForPendingContinuations(); registerMedalProcessor(null); jest.restoreAllMocks(); });

describe('PendingReevaluationSweeperService', () => {
  it('processa as linhas devidas e remove as concluidas; sem pendencia nao faz nada', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const processed: string[] = [];
    registerMedalProcessor(async (userId) => { processed.push(userId); return { complete: true }; });
    const { model, rows } = pendingModel([
      { userId: 'a', medalsPending: true, medalScope: scope, lastAttemptAt: new Date(Date.now() - 3_600_000) },
      { userId: 'b', medalsPending: true, medalScope: scope },
    ]);
    const sweeper = new PendingReevaluationSweeperService({ correctionReevaluation: model, trainingSession: { findMany: jest.fn(async () => []) } } as never);
    expect(await sweeper.sweep()).toEqual({ examined: 2, processed: 2 });
    expect(processed.sort()).toEqual(['a', 'b']);
    expect(rows.size).toBe(0);
    expect(await sweeper.sweep()).toEqual({ examined: 0, processed: 0 });
  });

  it('uma varredura lenta nao se sobrepoe a seguinte (trava de reentrada)', async () => {
    let release!: () => void;
    registerMedalProcessor(() => new Promise((resolve) => { release = () => resolve({ complete: true }); }));
    const { model } = pendingModel([{ userId: 'a', medalsPending: true, medalScope: scope }]);
    const sweeper = new PendingReevaluationSweeperService({ correctionReevaluation: model, trainingSession: { findMany: jest.fn(async () => []) } } as never);
    const first = sweeper.sweep();
    await new Promise((r) => setTimeout(r, 20));
    expect(await sweeper.sweep()).toBeNull(); // ja em andamento
    release();
    await first;
  });
});
