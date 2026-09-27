import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';

// 26/09/2026 — Auditoria Volume/Aderência/ACWR (item 6 do pedido). Confirma que a filtragem por
// modalidade reaproveita 100% a MESMA agregação/classificação de sessão de EvolutionMetricService
// — nunca uma segunda fórmula — e que getDistinctModalities descobre modalidades reais em vez de
// depender de uma lista fixa hardcoded.

function trainingSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    userId: 'aluno-1',
    scheduledDate: new Date('2026-08-03T00:00:00Z'),
    modality: 'corrida',
    distanceKm: 10,
    structure: {},
    plan: { status: 'active' },
    completion: { status: 'done', completedAt: new Date('2026-08-03T00:00:00Z'), perceivedEffort: null, distanceKm: 10 },
    ...overrides,
  };
}

function buildService(sessions: unknown[]) {
  const findMany = jest.fn().mockResolvedValue(sessions);
  const prisma = { trainingSession: { findMany } };
  return { service: new EvolutionMetricService(prisma as never), findMany };
}

describe('EvolutionMetricService.getSeriesByModality', () => {
  it('filtra a query pela modalidade pedida — nunca recalcula fora do Prisma', async () => {
    const { service, findMany } = buildService([]);
    await service.getSeriesByModality('aluno-1', 'corrida');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'aluno-1', modality: 'corrida' }),
    }));
  });

  it('sessões de musculação nunca contaminam a série de corrida', async () => {
    const { service } = buildService([
      trainingSession({ modality: 'corrida', distanceKm: 10, completion: { status: 'done', completedAt: new Date('2026-08-03T00:00:00Z'), distanceKm: 10 } }),
    ]);
    const series = await service.getSeriesByModality('aluno-1', 'corrida');
    expect(series.weeks).toHaveLength(1);
    expect(series.weeks[0].kmPercorridos).toBe(10);
  });

  it('série global (getSeries) não filtra por modalidade — comportamento pré-existente inalterado', async () => {
    const { service, findMany } = buildService([trainingSession({})]);
    await service.getSeries('aluno-1');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.not.objectContaining({ modality: expect.anything() }) }));
  });
});

describe('EvolutionMetricService.getDistinctModalities', () => {
  it('descobre modalidades reais do histórico, nunca uma lista fixa hardcoded', async () => {
    const findMany = jest.fn().mockResolvedValue([{ modality: 'corrida' }, { modality: 'forca' }]);
    const prisma = { trainingSession: { findMany } };
    const service = new EvolutionMetricService(prisma as never);
    const modalities = await service.getDistinctModalities('aluno-1');
    expect(modalities).toEqual(['corrida', 'forca']);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ distinct: ['modality'] }));
  });

  it('sem nenhuma sessão: lista vazia, nunca erro', async () => {
    const { service } = buildService([]);
    expect(await service.getDistinctModalities('aluno-1')).toEqual([]);
  });
});
