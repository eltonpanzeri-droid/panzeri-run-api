import { MeController } from '../src/me/me.controller';

// Nova Home do aluno (30/09/2026) — GET /me/observations/:variableId reaproveita a MESMA
// TrainingIntelligenceQueryService.getVariableSnapshot já usada pelo painel do treinador, só que
// sempre com athleteId = o próprio usuário autenticado (nunca outro aluno).

describe('MeController.getObservation', () => {
  it('chama getVariableSnapshot com o proprio userId (nunca um id da URL/outro aluno)', async () => {
    const getVariableSnapshot = jest.fn().mockResolvedValue({ mathApplicable: true });
    const controller = new MeController({} as never, { getVariableSnapshot } as never);
    const result = await controller.getObservation({ sub: 'aluno-1' } as never, 'workout.preSleepQuality');
    expect(getVariableSnapshot).toHaveBeenCalledWith('aluno-1', 'workout.preSleepQuality');
    expect(result).toEqual({ mathApplicable: true });
  });
});
