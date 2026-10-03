import { ActivityTimeSeriesService, NORMALIZATION_VERSION } from '../src/activity-timeseries/activity-timeseries.service';

// Primeira camada canonica de serie temporal (03/10/2026). Cobre exatamente os 7 cenarios pedidos:
// recording-rate 1, recording-rate diferente, series de comprimentos diferentes, valor
// ausente/invalido, tipo desconhecido preservado no raw (nunca normalizado), resync idempotente
// (sem duplicar), e normalizacao nunca escreve em RawActivitySample.

function buildSample(activityLogId: string, sampleType: string, data: string, recordingRate: number) {
  return {
    activityLogId,
    provider: 'polar',
    sampleType,
    payload: { data, 'sample-type': Number(sampleType), 'recording-rate': recordingRate },
  };
}

function fixture(samples: ReturnType<typeof buildSample>[]) {
  const pointStore = new Map<string, Record<string, unknown>>();
  const activityLogStore = new Map<string, Record<string, unknown>>([['activity-1', { id: 'activity-1', cadenceAvg: null }]]);
  let pointSeq = 0;

  const pointKey = (activityLogId: string, offsetSec: number, normalizationVersion: number) => `${activityLogId}|${offsetSec}|${normalizationVersion}`;

  const prisma = {
    rawActivitySample: {
      findMany: jest.fn(async ({ where }: { where: { activityLogId: string; provider: string } }) =>
        samples.filter((s) => s.activityLogId === where.activityLogId && s.provider === where.provider),
      ),
      // Nunca deve ser chamado por este service — presente so' pra' o teste de "nao altera raw"
      // poder afirmar isso com uma asserção direta, nao so' por ausencia de erro.
      upsert: jest.fn(),
      update: jest.fn(),
    },
    activityTimeSeriesPoint: {
      upsert: jest.fn(async ({ where, create, update }: { where: { activityLogId_offsetSec_normalizationVersion: { activityLogId: string; offsetSec: number; normalizationVersion: number } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = pointKey(where.activityLogId_offsetSec_normalizationVersion.activityLogId, where.activityLogId_offsetSec_normalizationVersion.offsetSec, where.activityLogId_offsetSec_normalizationVersion.normalizationVersion);
        const existing = pointStore.get(key);
        const row = existing ? { ...existing, ...update } : { id: `point-${++pointSeq}`, ...create };
        pointStore.set(key, row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: { where: { activityLogId: string; normalizationVersion: number; cadenceSpm?: { gt: number } } }) =>
        Array.from(pointStore.values()).filter(
          (row) =>
            row.activityLogId === where.activityLogId &&
            row.normalizationVersion === where.normalizationVersion &&
            (where.cadenceSpm === undefined || ((row.cadenceSpm as number | undefined) ?? -Infinity) > where.cadenceSpm.gt),
        ),
      ),
    },
    activityLog: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = activityLogStore.get(where.id) ?? {};
        const row = { ...existing, ...data };
        activityLogStore.set(where.id, row);
        return row;
      }),
    },
  };

  const service = new ActivityTimeSeriesService(prisma as never);
  return { service, prisma, pointStore, activityLogStore };
}

describe('ActivityTimeSeriesService.normalizeFromRawSamples', () => {
  it('cenario 1 — recording-rate 1: gera um ponto por segundo, offset = index * 1', async () => {
    const { service, pointStore } = fixture([
      buildSample('activity-1', '0', '65,66,67', 1),
    ]);
    await service.normalizeFromRawSamples('activity-1', 'polar');
    const offsets = Array.from(pointStore.values()).map((p) => p.offsetSec).sort((a, b) => (a as number) - (b as number));
    expect(offsets).toEqual([0, 1, 2]);
    expect(pointStore.get('activity-1|0|' + NORMALIZATION_VERSION)).toMatchObject({ heartRateBpm: 65 });
  });

  it('cenario 2 — recording-rate diferente (5s): offset = index * 5, nunca assume 1s', async () => {
    const { service, pointStore } = fixture([
      buildSample('activity-1', '2', '80,82,84', 5),
    ]);
    await service.normalizeFromRawSamples('activity-1', 'polar');
    const offsets = Array.from(pointStore.values()).map((p) => p.offsetSec).sort((a, b) => (a as number) - (b as number));
    expect(offsets).toEqual([0, 5, 10]);
  });

  it('cenario 3 — series de comprimentos diferentes: nao forca grid unico, cada metrica so' + ' cria pontos onde tem dado', async () => {
    const { service, pointStore } = fixture([
      buildSample('activity-1', '0', '65,66,67,68,69', 1), // 5 amostras
      buildSample('activity-1', '1', '10.0,10.5', 1), // so' 2 amostras
    ]);
    await service.normalizeFromRawSamples('activity-1', 'polar');
    const row0 = pointStore.get('activity-1|0|' + NORMALIZATION_VERSION) as Record<string, unknown>;
    const row4 = pointStore.get('activity-1|4|' + NORMALIZATION_VERSION) as Record<string, unknown>;
    expect(row0).toMatchObject({ heartRateBpm: 65, speedKmh: 10.0 });
    // offset 4 so' tem FC (a velocidade acabou em offset 1) — nunca inventa/interpola speedKmh aqui.
    expect(row4.heartRateBpm).toBe(69);
    expect(row4.speedKmh).toBeUndefined();
  });

  it('cenario 4 — valor ausente/invalido no meio da serie vira ausencia, nunca zero', async () => {
    const { service, pointStore } = fixture([
      buildSample('activity-1', '0', '65,,68,None,70', 1),
    ]);
    await service.normalizeFromRawSamples('activity-1', 'polar');
    // indices 1 e 3 (vazio e "None") nunca geram ponto (nenhum merge ocorreu pra' eles)
    expect(pointStore.has('activity-1|1|' + NORMALIZATION_VERSION)).toBe(false);
    expect(pointStore.has('activity-1|3|' + NORMALIZATION_VERSION)).toBe(false);
    expect(pointStore.get('activity-1|0|' + NORMALIZATION_VERSION)).toMatchObject({ heartRateBpm: 65 });
    expect(pointStore.get('activity-1|4|' + NORMALIZATION_VERSION)).toMatchObject({ heartRateBpm: 70 });
  });

  it('cenario 5 — sampleType desconhecido (ex.: "3" altitude) nunca e' + ' normalizado, mesmo presente no raw', async () => {
    const { service, pointStore } = fixture([
      buildSample('activity-1', '0', '65,66', 1),
      buildSample('activity-1', '3', '900.1,901.2', 1), // altitude — fora de escopo nesta versao
    ]);
    await service.normalizeFromRawSamples('activity-1', 'polar');
    const row0 = pointStore.get('activity-1|0|' + NORMALIZATION_VERSION) as Record<string, unknown>;
    expect(row0).not.toHaveProperty('altitudeMeters');
    expect(Object.keys(row0).some((key) => key.toLowerCase().includes('altitude'))).toBe(false);
  });

  it('cenario 6 — resincronizar a mesma atividade nao duplica a serie canonica (upsert idempotente)', async () => {
    const { service, pointStore } = fixture([
      buildSample('activity-1', '0', '65,66,67', 1),
    ]);
    await service.normalizeFromRawSamples('activity-1', 'polar');
    await service.normalizeFromRawSamples('activity-1', 'polar');
    expect(pointStore.size).toBe(3);
  });

  it('cenario 7 — normalizacao nunca escreve em RawActivitySample', async () => {
    const { service, prisma } = fixture([
      buildSample('activity-1', '0', '65,66,67', 1),
    ]);
    await service.normalizeFromRawSamples('activity-1', 'polar');
    expect(prisma.rawActivitySample.upsert).not.toHaveBeenCalled();
    expect(prisma.rawActivitySample.update).not.toHaveBeenCalled();
    expect(prisma.rawActivitySample.findMany).toHaveBeenCalledWith({ where: { activityLogId: 'activity-1', provider: 'polar' } });
  });

  it('cadencia: aplica x2 (regra Polar) gravando so' + ' cadenceSpm no canonico — sem nenhum campo especifico de provedor — e preenche ActivityLog.cadenceAvg so' + ' com amostras validas (> 0)', async () => {
    const { service, pointStore, activityLogStore } = fixture([
      // primeiros 2 samples = 0 (sem sinal de movimento ainda, padrao real observado) — devem
      // virar pontos com cadenceSpm=0, mas NAO entrar na media.
      buildSample('activity-1', '2', '0,0,80,82', 1),
    ]);
    await service.normalizeFromRawSamples('activity-1', 'polar');

    const zeroPoint = pointStore.get('activity-1|0|' + NORMALIZATION_VERSION) as Record<string, unknown>;
    expect(zeroPoint).toMatchObject({ cadenceSpm: 0 });

    const movingPoint = pointStore.get('activity-1|2|' + NORMALIZATION_VERSION) as Record<string, unknown>;
    expect(movingPoint).toMatchObject({ cadenceSpm: 160 });

    // O valor bruto da Polar (80) e qualquer marca de transformacao NUNCA aparecem no canonico —
    // so' RawActivitySample guarda o bruto. A regra x2 so' e' auditavel via provider+version+codigo.
    expect(movingPoint).not.toHaveProperty('cadenceRawPolar');
    expect(movingPoint).not.toHaveProperty('cadenceTransform');
    expect(Object.keys(movingPoint).some((key) => key.toLowerCase().includes('polar'))).toBe(false);

    // Media so' de 80 e 82 (x2 = 160 e 164) — os dois zeros ficam de fora, conforme documentado.
    expect(activityLogStore.get('activity-1')).toMatchObject({ cadenceAvg: 162 });
  });

  it('provider desconhecido: nenhum ponto e' + ' gerado (nunca inventa mapeamento sem confirmacao)', async () => {
    const { service, pointStore } = fixture([
      buildSample('activity-1', '0', '65,66', 1),
    ]);
    await service.normalizeFromRawSamples('activity-1', 'garmin');
    expect(pointStore.size).toBe(0);
  });

  it('recording-rate ausente/invalido na propria amostra: serie inteira ignorada, nunca assume 1s', async () => {
    const activityLogId = 'activity-1';
    const prisma = {
      rawActivitySample: {
        findMany: jest.fn(async () => [
          { activityLogId, provider: 'polar', sampleType: '0', payload: { data: '65,66', 'sample-type': 0 } }, // sem recording-rate
        ]),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      activityTimeSeriesPoint: { upsert: jest.fn(), findMany: jest.fn(async () => []) },
      activityLog: { update: jest.fn() },
    };
    const service = new ActivityTimeSeriesService(prisma as never);
    await service.normalizeFromRawSamples(activityLogId, 'polar');
    expect(prisma.activityTimeSeriesPoint.upsert).not.toHaveBeenCalled();
  });
});
