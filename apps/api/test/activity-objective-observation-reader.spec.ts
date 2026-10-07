import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';

// Evolucao objetiva (04/10/2026): pace e cadencia entram como variaveis longitudinais pela MESMA
// arquitetura (registro + leitor + motor). Cadencia so' de atividade com cadencia valida; pace
// derivado de duracao/distancia; ausencia nunca vira zero.

function buildReader(logs: unknown[]) {
  const prisma = { activityLog: { findMany: jest.fn().mockResolvedValue(logs) } };
  return { reader: new ObservationReaderService(prisma as never, {} as never, {} as never), prisma };
}

function log(overrides: Record<string, unknown>) {
  return {
    id: 'log-1', userId: 'aluno-1', provider: 'polar', sport: 'corrida', startedAt: new Date('2026-10-03T09:00:00Z'),
    distanceMeters: 30080, durationSec: 9367, cadenceAvg: 162, ...overrides,
  };
}

describe('ObservationReaderService — activity.* (ActivityLog)', () => {
  it('pace derivado de duracao/distancia, com rastro ate o ActivityLog', async () => {
    const { reader } = buildReader([log({})]);
    const obs = await reader.getObservations('aluno-1', 'activity.avgPaceSecondsKm');
    expect(obs).toHaveLength(1);
    expect(obs[0].value).toBe(Math.round(9367 / 30.08));
    expect(obs[0].context).toMatchObject({ activityLogId: 'log-1', provider: 'polar', modality: 'corrida' });
    expect(obs[0].source).toBe('activity_objective');
  });

  it('I: so cadencia valida entra — sem cadencia ou cadencia 0 nao gera observacao (nunca zero)', async () => {
    const { reader } = buildReader([
      log({ id: 'a', cadenceAvg: 170 }),
      log({ id: 'b', cadenceAvg: null }),
      log({ id: 'c', cadenceAvg: 0 }),
    ]);
    const obs = await reader.getObservations('aluno-1', 'activity.cadenceAvg');
    expect(obs.map((o) => o.value)).toEqual([170]);
  });

  it('F: atividade sem distancia/duracao nao gera pace', async () => {
    const { reader } = buildReader([log({ id: 'a', distanceMeters: null }), log({ id: 'b', durationSec: null }), log({ id: 'c', distanceMeters: 0 })]);
    expect(await reader.getObservations('aluno-1', 'activity.avgPaceSecondsKm')).toHaveLength(0);
  });

  it('consulta so atividades correspondente/alternativa do proprio aluno (ambigua fica fora); corrida decidida pela modalidade canonica', async () => {
    const { reader, prisma } = buildReader([]);
    await reader.getObservations('aluno-1', 'activity.cadenceAvg');
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'aluno-1', executionClassification: { in: ['corresponding', 'alternative'] } },
    }));
  });
});
