import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { pickCanonicalPerEvent } from '../src/activity-execution/canonical-observation';

// 3C.1 — consumo objetivo CANONICO: Polar + Apple do mesmo PhysicalEvent = 1 volume e 1 conjunto de metricas. So' muda a SELECAO da
// observacao objetiva; a matematica de volume (Evolution) e de pace/cadencia (TI) e' a mesma de antes.
const DAY = new Date('2026-08-03T10:00:00Z');

function log(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, userId: 'aluno-1', provider: 'polar', sport: 'corrida', startedAt: DAY, utcOffsetMinutes: 0, distanceMeters: 10000, durationSec: 3000, cadenceAvg: 170,
    executionClassification: 'corresponding', physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null, ...overrides,
  };
}
const asEvent = (eventId: string, canonicalId: string, rows: Array<Record<string, unknown>>): Array<Record<string, any>> =>
  rows.map((row) => ({ ...row, physicalIdentityStatus: 'matched', physicalEventId: eventId, physicalCanonicalActivityLogId: canonicalId }));

function store(rows: Array<Record<string, any>>) {
  return {
    findMany: jest.fn(async ({ where }: any) =>
      rows.filter((r) => {
        if (where.userId !== undefined && r.userId !== where.userId) return false;
        if (where.id?.in !== undefined && !where.id.in.includes(r.id)) return false;
        if (where.executionClassification?.in !== undefined && !where.executionClassification.in.includes(r.executionClassification)) return false;
        return true;
      }),
    ),
  };
}

function evolution(rows: Array<Record<string, any>>) {
  const prisma = { trainingSession: { findMany: jest.fn().mockResolvedValue([]) }, activityLog: store(rows) };
  return new EvolutionMetricService(prisma as never);
}

function reader(rows: Array<Record<string, any>>) {
  const prisma = { activityLog: store(rows) };
  return new ObservationReaderService(prisma as never, {} as never, {} as never);
}

describe('3C.1 — Evolution: distancia objetiva por PhysicalEvent', () => {
  it('Polar + Apple do mesmo evento: a distancia conta UMA vez, com o valor da canonica (a outra observacao nao contamina)', async () => {
    const rows = asEvent('ev-1', 'polar-1', [log('polar-1', { distanceMeters: 10200 }), log('apple-1', { provider: 'apple_health', distanceMeters: 10500, executionClassification: 'corresponding' })]);
    const series = await evolution(rows).getSeries('aluno-1');
    expect(series.weeks[0].kmPercorridos).toBe(10.2);
  });

  it('atividade unique continua contando; atividade adicional (alternative) continua entrando', async () => {
    const rows = [log('u1', { distanceMeters: 8000 }), log('alt1', { distanceMeters: 5000, executionClassification: 'alternative', startedAt: new Date('2026-08-04T10:00:00Z') })];
    const series = await evolution(rows).getSeries('aluno-1');
    expect(series.weeks[0].kmPercorridos).toBe(13);
    expect(series.weeks[0].kmExtras).toBe(5);
  });

  it('dois PhysicalEvents DIFERENTES no mesmo dia: ambos contam', async () => {
    const rows = [
      ...asEvent('ev-a', 'polar-a', [log('polar-a', { distanceMeters: 10000 }), log('apple-a', { provider: 'apple_health', executionClassification: null })]),
      ...asEvent('ev-b', 'polar-b', [log('polar-b', { distanceMeters: 5000, startedAt: new Date('2026-08-03T20:00:00Z') }), log('apple-b', { provider: 'apple_health', executionClassification: null })]),
    ];
    const series = await evolution(rows).getSeries('aluno-1');
    expect(series.weeks[0].kmPercorridos).toBe(15);
  });

  it('classificacao legada na observacao NAO canonica: a canonica passa a representar o evento (sem dupla contagem nem perda)', async () => {
    // Legado ainda nao reconciliado: so' a copia Apple foi classificada; a canonica (Polar) esta sem classificacao.
    const rows = asEvent('ev-1', 'polar-1', [log('polar-1', { distanceMeters: 10200, executionClassification: null }), log('apple-1', { provider: 'apple_health', distanceMeters: 10500 })]);
    const series = await evolution(rows).getSeries('aluno-1');
    expect(series.weeks[0].kmPercorridos).toBe(10.2);
  });

  it('modalidade: RUNNING (legado), corrida e esteira sao a mesma modalidade interna (corrida) no filtro por modalidade (10/2026)', async () => {
    const rows = [log('legacy', { sport: 'RUNNING', distanceMeters: 6000 }), log('modern', { distanceMeters: 4000, startedAt: new Date('2026-08-04T10:00:00Z') }), log('treadmill', { sport: 'esteira', distanceMeters: 3000, startedAt: new Date('2026-08-05T10:00:00Z') })];
    const prisma = { trainingSession: { findMany: jest.fn().mockResolvedValue([]) }, activityLog: store(rows) };
    const series = await new EvolutionMetricService(prisma as never).getSeriesByModality('aluno-1', 'corrida');
    expect(series.weeks[0].kmPercorridos).toBe(13); // 6 (RUNNING legado) + 4 (corrida) + 3 (esteira)
  });
});

describe('3C.1 — Training Intelligence: pace/cadencia por PhysicalEvent', () => {
  it('Polar + Apple do mesmo evento: UMA observacao de pace e UMA de cadencia, com os valores da canonica', async () => {
    const rows = asEvent('ev-1', 'polar-1', [
      log('polar-1', { distanceMeters: 10000, durationSec: 3000, cadenceAvg: 172 }),
      log('apple-1', { provider: 'apple_health', distanceMeters: 10300, durationSec: 3090, cadenceAvg: 150 }),
    ]);
    const pace = await reader(rows).getObservations('aluno-1', 'activity.avgPaceSecondsKm');
    expect(pace).toHaveLength(1);
    expect(pace[0].value).toBe(300);
    expect(pace[0].context).toMatchObject({ activityLogId: 'polar-1', provider: 'polar' });
    const cadence = await reader(rows).getObservations('aluno-1', 'activity.cadenceAvg');
    expect(cadence.map((o) => o.value)).toEqual([172]);
  });

  it('a canonica sem cadencia NAO e completada pela observacao nao-canonica (sem fusao de metricas)', async () => {
    const rows = asEvent('ev-1', 'polar-1', [log('polar-1', { cadenceAvg: null }), log('apple-1', { provider: 'apple_health', cadenceAvg: 160 })]);
    expect(await reader(rows).getObservations('aluno-1', 'activity.cadenceAvg')).toHaveLength(0);
  });

  it('atividade unique continua valida; dois eventos diferentes no mesmo dia geram duas observacoes', async () => {
    const rows = [log('u1', { cadenceAvg: 168 }), ...asEvent('ev-b', 'polar-b', [log('polar-b', { cadenceAvg: 171, startedAt: new Date('2026-08-03T20:00:00Z') }), log('apple-b', { provider: 'apple_health', cadenceAvg: 140, executionClassification: null })])];
    const obs = await reader(rows).getObservations('aluno-1', 'activity.cadenceAvg');
    expect(obs.map((o) => o.value)).toEqual([168, 171]);
  });

  it('RUNNING (legado) e corrida entram como corrida; modalidade nao-corrida fica fora', async () => {
    const rows = [log('legacy', { sport: 'RUNNING', cadenceAvg: 165 }), log('strength', { sport: 'forca', cadenceAvg: 100, startedAt: new Date('2026-08-04T10:00:00Z') })];
    const obs = await reader(rows).getObservations('aluno-1', 'activity.cadenceAvg');
    expect(obs.map((o) => o.value)).toEqual([165]);
  });

  it('classificacao legada so na copia Apple: o evento vira UMA observacao, com os dados da canonica Polar', async () => {
    const rows = asEvent('ev-1', 'polar-1', [log('polar-1', { cadenceAvg: 172, executionClassification: null }), log('apple-1', { provider: 'apple_health', cadenceAvg: 150 })]);
    const obs = await reader(rows).getObservations('aluno-1', 'activity.cadenceAvg');
    expect(obs.map((o) => [o.value, (o.context as { activityLogId?: string }).activityLogId])).toEqual([[172, 'polar-1']]);
  });
});

describe('3C.1 — pickCanonicalPerEvent', () => {
  it('sem canonica encontrada, mantem a linha lida (nunca perde atividade)', async () => {
    const rows = asEvent('ev-1', 'ghost', [log('apple-1', { provider: 'apple_health' })]);
    const picks = await pickCanonicalPerEvent(rows as Array<{ id: string; physicalIdentityStatus: string; physicalEventId: string; physicalCanonicalActivityLogId: string }>, async () => []);
    expect(picks.map((p) => p.row.id)).toEqual(['apple-1']);
  });
});
