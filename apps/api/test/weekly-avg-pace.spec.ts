import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { evidenceKindOf, getVariableDefinition } from '../src/training-intelligence/variable-registry';
import { explorerInfoOf } from '../src/training-intelligence/explorer-catalog';

// 02/11/2026 — ritmo medio SEMANAL (activity.weeklyAvgPaceSecondsKm): tempo total ÷ distancia total das corridas da semana (nao a media dos ritmos), semana sem corrida valida sem observacao.
const log = (id: string, startedAt: string, distanceMeters: number | null, durationSec: number | null, sport = 'corrida') => ({
  id, userId: 'a1', provider: 'polar', sport, startedAt: new Date(startedAt), distanceMeters, durationSec, cadenceAvg: null, executionClassification: 'corresponding',
});
const readerWith = (logs: unknown[]) => new ObservationReaderService({ activityLog: { findMany: jest.fn().mockResolvedValue(logs) } } as never, {} as never, {} as never);

describe('activity.weeklyAvgPaceSecondsKm', () => {
  it('registro: semanal, em s/km, fora da lista da IA, no Explorar', () => {
    const def = getVariableDefinition('activity.weeklyAvgPaceSecondsKm')!;
    expect(def).toMatchObject({ source: 'activity_objective', expectedFrequency: 'per_week', scale: { unit: 's/km' }, missingPolicy: 'never_impute' });
    expect(evidenceKindOf(def)).toBeTruthy();
    expect(explorerInfoOf(def).subgroup).toBe('intensidade_resposta');
  });

  it('soma tempo ÷ soma distancia (corrida longa pesa mais que tiro curto) e conta as corridas', async () => {
    // 10 km em 3000 s (300 s/km) + 2 km em 480 s (240 s/km): media simples = 270; correta = 3480 / 12 = 290
    const obs = await readerWith([log('x', '2026-10-06T10:00:00Z', 10000, 3000), log('y', '2026-10-08T10:00:00Z', 2000, 480)]).getObservations('a1', 'activity.weeklyAvgPaceSecondsKm');
    expect(obs).toHaveLength(1);
    expect(obs[0].value).toBe(290);
    expect(obs[0].timestamp.toISOString()).toBe('2026-10-05T12:00:00.000Z');
    expect(obs[0].context).toMatchObject({ modality: 'global', numerator: 2, isPartialWeek: false });
  });

  it('semana sem corrida valida (sem distancia/duracao ou so de outra modalidade) nao gera observacao; semanas diferentes ficam separadas', async () => {
    const obs = await readerWith([
      log('a', '2026-10-06T10:00:00Z', 5000, 1500),
      log('b', '2026-10-13T10:00:00Z', null, 1500),
      log('c', '2026-10-14T10:00:00Z', 5000, 0),
      log('d', '2026-10-15T10:00:00Z', 5000, 1500, 'bike'),
      log('e', '2026-10-21T10:00:00Z', 4000, 1200),
    ]).getObservations('a1', 'activity.weeklyAvgPaceSecondsKm');
    expect(obs.map((o) => [o.timestamp.toISOString().slice(0, 10), o.value])).toEqual([['2026-10-05', 300], ['2026-10-19', 300]]);
  });

  it('corrida de domingo a noite (fuso de Sao Paulo) fica na semana que termina, nao na seguinte', async () => {
    // 2026-10-12 01:30Z = domingo 11/10 22:30 em Sao Paulo -> semana de 05/10
    const obs = await readerWith([log('n', '2026-10-12T01:30:00Z', 5000, 1500)]).getObservations('a1', 'activity.weeklyAvgPaceSecondsKm');
    expect(obs[0].timestamp.toISOString().slice(0, 10)).toBe('2026-10-05');
  });
});
