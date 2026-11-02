import { MeTrainingLoadController } from '../src/coach/me-training-load.controller';

// 02/11/2026 — GET /me/training-load: a aluna le a MESMA carga interna percebida do painel do treinador, sempre com o proprio id (nunca um id vindo da URL).
describe('MeTrainingLoadController', () => {
  it('chama o servico canonico com o id da aluna autenticada e repassa o periodo pedido', async () => {
    const forStudent = jest.fn().mockResolvedValue({ views: {} });
    const controller = new MeTrainingLoadController({ forStudent } as never);
    const result = await controller.get({ sub: 'aluno-1' } as never, { from: '2026-09-01', to: '2026-10-31' });
    expect(forStudent).toHaveBeenCalledWith('aluno-1', { from: '2026-09-01', to: '2026-10-31' });
    expect(result).toEqual({ views: {} });
  });

  it('sem periodo, deixa o servico usar o padrao (12 semanas)', async () => {
    const forStudent = jest.fn().mockResolvedValue({});
    await new MeTrainingLoadController({ forStudent } as never).get({ sub: 'aluno-2' } as never, {});
    expect(forStudent).toHaveBeenCalledWith('aluno-2', {});
  });
});
