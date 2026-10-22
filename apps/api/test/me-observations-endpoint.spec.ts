import { MeController } from '../src/me/me.controller';

// Nova Home do aluno (30/09/2026) — GET /me/observations/:variableId reaproveita a MESMA
// TrainingIntelligenceQueryService.getVariableSnapshot já usada pelo painel do treinador, só que
// sempre com athleteId = o próprio usuário autenticado (nunca outro aluno).

describe('MeController.getObservation', () => {
  it('chama getVariableSnapshot com o proprio userId (nunca um id da URL/outro aluno)', async () => {
    const getVariableSnapshot = jest.fn().mockResolvedValue({ mathApplicable: true });
    const controller = new MeController({} as never, { getVariableSnapshot } as never, {} as never, {} as never);
    const result = await controller.getObservation({ sub: 'aluno-1' } as never, 'workout.preSleepQuality');
    expect(getVariableSnapshot).toHaveBeenCalledWith('aluno-1', 'workout.preSleepQuality');
    expect(result).toEqual({ mathApplicable: true });
  });
});

// 15/10/2026: indicadores de EXECUCAO dependem de analises por sessao. Depois de uma correcao de atividade, a leitura tenta concluir a atualizacao pendente e, se ainda
// restar algo, devolve `provisional` (o app mostra "em atualizacao"). Variaveis comuns nao consultam a pendencia.
describe('MeController.getObservation: dados em atualizacao (provisorios)', () => {
  const snapshot = { mathApplicable: true, evidence: { n: 3 } };
  const pendingRow = { userId: 'aluno-1', version: 1, dirtySince: new Date('2026-10-15T12:00:00Z'), analysisSessionIds: ['s1', 's2'], forceSessionIds: [], medalsPending: false, medalScope: null, leaseUntil: null, attempts: 0, lastAttemptAt: null, lastError: null };

  it('execution.*: com pendencia que nao conclui, a resposta traz provisional (sessoes e desde quando)', async () => {
    const getVariableSnapshot = jest.fn().mockResolvedValue(snapshot);
    // a pendencia nao consegue concluir aqui (sem acesso a sessoes): permanece registrada
    const prisma: any = { correctionReevaluation: { findUnique: jest.fn(async () => ({ ...pendingRow })), updateMany: jest.fn(async () => ({ count: 1 })) } };
    const controller = new MeController({} as never, { getVariableSnapshot } as never, prisma, {} as never);
    const result = await controller.getObservation({ sub: 'aluno-1' } as never, 'execution.timeInBandPct');
    expect(result).toMatchObject({ mathApplicable: true, provisional: { reason: 'correction_pending', sessions: 2 } });
  });

  it('execution.* sem pendencia: provisional = null (dado definitivo)', async () => {
    const getVariableSnapshot = jest.fn().mockResolvedValue(snapshot);
    const prisma: any = { correctionReevaluation: { findUnique: jest.fn(async () => null) } };
    const controller = new MeController({} as never, { getVariableSnapshot } as never, prisma, {} as never);
    expect(await controller.getObservation({ sub: 'aluno-1' } as never, 'execution.timeInBandPct')).toMatchObject({ provisional: null });
  });

  it('variavel comum (fadiga, RPE...) nao consulta a pendencia e devolve o mesmo formato de antes', async () => {
    const getVariableSnapshot = jest.fn().mockResolvedValue(snapshot);
    const prisma: any = { correctionReevaluation: { findUnique: jest.fn() } };
    const controller = new MeController({} as never, { getVariableSnapshot } as never, prisma, {} as never);
    expect(await controller.getObservation({ sub: 'aluno-1' } as never, 'workout.perceivedEffort')).toEqual(snapshot);
    expect(prisma.correctionReevaluation.findUnique).not.toHaveBeenCalled();
  });
});
