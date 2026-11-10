import { APPLE_SERIES_LIMITS, buildSeriesPoints, normalizeSeries } from '../src/apple-health/apple-health-series';
import { AppleHealthIngestionService } from '../src/apple-health/apple-health-ingestion.service';

// 10/11/2026: series do treino do Apple Saude (FC, velocidade, potencia, cadencia, distancia ao longo do treino). Dados SINTETICOS.
describe('series do treino: normalizacao e montagem', () => {
  it('valida formato e limites; amostra invalida e descartada e contada', () => {
    expect(normalizeSeries({}).ok).toBe(false);
    expect(normalizeSeries({ series: [] }).ok).toBe(false);
    const tooMany = { series: [{ recordId: 'A', metrics: { heartRate: Array.from({ length: APPLE_SERIES_LIMITS.maxSamplesPerMetric + 1 }, (_, i) => [i, i, 100]) } }] };
    expect(normalizeSeries(tooMany).ok).toBe(false);
    const result = normalizeSeries({ series: [{ recordId: ' ABC ', metrics: { heartRate: [[0, 0, 120], [5, 3, 130], ['x', 1, 2], [1, 2]], bogus: [[0, 1, 1]] } }, { recordId: '', metrics: {} }] });
    expect(result).toMatchObject({ ok: true, dropped: 4 });
    if (result.ok) expect(result.series).toEqual([{ recordId: 'abc', metrics: { heartRate: [[0, 0, 120]] } }]);
  });

  it('junta tudo numa linha por segundo, converte unidades e nunca transforma ausencia em zero', () => {
    const points = buildSeriesPoints({
      heartRate: [[10, 10, 150.4], [20, 20, 400]], // 400 bpm e' impossivel: descartado
      runningSpeed: [[9, 11, 3]], // m/s -> km/h
      runningPower: [[9, 11, 250.2]],
      stepCount: [[8, 12, 12]], // 12 passos em 4 s = 180 spm
      distance: [[8, 12, 12], [12, 16, 14]], // cumulativo
    });
    const at10 = points.find((p) => p.offsetSec === 10)!;
    expect(at10).toMatchObject({ heartRateBpm: 150, speedKmh: 10.8, powerWatts: 250, cadenceSpm: 180 });
    expect(points.find((p) => p.offsetSec === 20)?.heartRateBpm).toBeUndefined();
    expect(points.find((p) => p.offsetSec === 12)?.distanceMeters).toBe(12);
    expect(points.find((p) => p.offsetSec === 16)?.distanceMeters).toBe(26);
    expect(points.map((p) => p.offsetSec)).toEqual([...points.map((p) => p.offsetSec)].sort((a, b) => a - b));
  });

  it('sem velocidade medida, a velocidade vem da distancia da propria amostra; com velocidade medida, nao e derivada', () => {
    const derived = buildSeriesPoints({ distance: [[0, 10, 30]] }); // 3 m/s = 10,8 km/h
    expect(derived.find((p) => p.offsetSec === 5)?.speedKmh).toBe(10.8);
    const measured = buildSeriesPoints({ runningSpeed: [[0, 2, 4]], distance: [[0, 10, 30]] });
    expect(measured.some((p) => p.offsetSec === 5 && p.speedKmh !== undefined)).toBe(false);
  });
});

describe('importSeries (consentimento e gravacao)', () => {
  function build(allowed: string[], hasLog = true) {
    const created: any[] = [];
    const deleted: any[] = [];
    const tx: any = {
      activityLog: { findUnique: jest.fn(async () => (hasLog ? { id: 'log1' } : null)) },
      activityTimeSeriesPoint: {
        findMany: jest.fn(async () => [{ offsetSec: 10 }]), // um ponto de percurso no segundo 10
        deleteMany: jest.fn(async (args: any) => { deleted.push(args); }),
        createMany: jest.fn(async (args: any) => { created.push(...args.data); }),
      },
    };
    const consent: any = {
      access: jest.fn(async () => ({ mode: 'recorded', allowed: new Set(allowed) })),
      writeWhileAuthorized: jest.fn(async (_u: string, fn: any) => fn(tx, { mode: 'recorded', allowed: new Set(allowed) })),
    };
    const service = new AppleHealthIngestionService({} as any, undefined, undefined, undefined, consent);
    return { service, created, deleted, consent };
  }
  const body = { series: [{ recordId: 'AAA', metrics: { heartRate: [[10, 10, 140], [20, 20, 150]] } }] };

  it('sem a autorizacao das medidas do treino, recusa (nada e gravado)', async () => {
    const { service, created } = build(['activity']);
    await expect(service.importSeries('u1', body)).rejects.toThrow(/Autorizacao das medidas/);
    expect(created).toHaveLength(0);
  });

  it('com autorizacao: apaga so a serie antiga (sem latitude), preserva o percurso e desloca 0,5 s quando o segundo ja e do percurso', async () => {
    const { service, created, deleted } = build(['activity', 'activity_sensors']);
    const result = await service.importSeries('u1', body);
    expect(result).toMatchObject({ stored: 1, rejected: 0 });
    expect(deleted[0].where).toMatchObject({ activityLogId: 'log1', provider: 'apple_health', latitude: null });
    expect(created.map((row) => row.offsetSec).sort((a, b) => a - b)).toEqual([10.5, 20]);
    expect(created.every((row) => row.provider === 'apple_health' && row.normalizationVersion === 1 && row.latitude === undefined)).toBe(true);
  });

  it('treino nao importado: rejeitado sem erro', async () => {
    const { service } = build(['activity', 'activity_sensors'], false);
    expect(await service.importSeries('u1', body)).toMatchObject({ stored: 0, rejected: 1, items: [{ status: 'rejected', reason: 'atividade_nao_encontrada' }] });
  });
});
