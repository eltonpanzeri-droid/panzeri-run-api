import { NotFoundException } from '@nestjs/common';
import { ActivityDetailService } from '../src/activity-execution/activity-detail.service';

// "Ver treino completo" (03/10/2026): leitura canonica. Cobre posse, prescrito x realizado separado,
// null nunca zero, parciais vindas da serie canonica e amostragem do grafico sem interpolacao.

function build(opts: {
  log?: Record<string, unknown> | null;
  link?: Record<string, unknown> | null;
  points?: Record<string, unknown>[];
  pointsAfterRebuild?: Record<string, unknown>[];
  rawCount?: number;
  structure?: unknown;
}) {
  const prisma = {
    activityLog: {
      findFirst: jest.fn().mockResolvedValue(opts.log === undefined
        ? {
            id: 'log-1', provider: 'polar', startedAt: new Date('2026-10-03T04:58:04Z'), utcOffsetMinutes: -180,
            sport: 'corrida', distanceMeters: 30076, durationSec: 9367, avgHeartRateBpm: 151, maxHeartRateBpm: 171,
            cadenceAvg: 162, caloriesKcal: 2876, userId: 'aluno-1',
          }
        : opts.log),
    },
    sessionExecutionLink: {
      findFirst: jest.fn().mockResolvedValue(opts.link === undefined
        ? {
            trainingSession: {
              id: 'sess-30km', title: 'Treino longo 30km', modality: 'corrida', distanceKm: 30,
              durationMin: 163, scheduledDate: new Date('2026-10-03T00:00:00Z'), structure: opts.structure ?? null,
            },
          }
        : opts.link),
    },
    activityTimeSeriesPoint: {
      findMany: opts.pointsAfterRebuild
        ? jest.fn().mockResolvedValueOnce(opts.points ?? []).mockResolvedValue(opts.pointsAfterRebuild)
        : jest.fn().mockResolvedValue(opts.points ?? []),
    },
    rawActivitySample: { count: jest.fn().mockResolvedValue(opts.rawCount ?? 0) },
  };
  const timeSeries = { normalizeFromRawSamples: jest.fn().mockResolvedValue(undefined) };
  return { service: new ActivityDetailService(prisma as never, timeSeries as never), prisma, timeSeries };
}

describe('ActivityDetailService.getDetail', () => {
  it('atividade de outro aluno: 404, nunca vaza o detalhe (checagem de posse no findFirst)', async () => {
    const { service, prisma } = build({ log: null });
    await expect(service.getDetail('aluno-2', 'log-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.activityLog.findFirst).toHaveBeenCalledWith({ where: { id: 'log-1', userId: 'aluno-2' } });
  });

  it('prescrito e realizado vem separados: realizado do ActivityLog, prescrito do vinculo ativo', async () => {
    const { service } = build({});
    const detail = await service.getDetail('aluno-1', 'log-1');
    expect(detail.summary.distanceKm).toBe(30.076);
    expect(detail.summary.avgPaceSecondsKm).toBe(Math.round(9367 / 30.076));
    expect(detail.prescribed).toMatchObject({ trainingSessionId: 'sess-30km', distanceKm: 30 });
    expect(detail.provider).toBe('polar'); // provider so' como origem
  });

  it('sem vinculo ativo: prescribed null (nunca inventado a partir do treino do dia)', async () => {
    const { service } = build({ link: null });
    const detail = await service.getDetail('aluno-1', 'log-1');
    expect(detail.prescribed).toBeNull();
  });

  it('metricas ausentes ficam null, nunca zero (sem distancia => pace null, sem FC => null)', async () => {
    const { service } = build({
      log: { id: 'log-2', provider: 'polar', startedAt: new Date(), utcOffsetMinutes: 0, sport: 'forca', distanceMeters: null, durationSec: 2700, avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, caloriesKcal: null, userId: 'aluno-1' },
      link: null,
    });
    const detail = await service.getDetail('aluno-1', 'log-2');
    expect(detail.summary.distanceKm).toBeNull();
    expect(detail.summary.avgPaceSecondsKm).toBeNull();
    expect(detail.summary.avgHeartRateBpm).toBeNull();
    expect(detail.summary.cadenceAvg).toBeNull();
    expect(detail.splits).toEqual([]);
    expect(detail.chart).toEqual([]);
  });

  it('parciais vem da serie canonica (ActivityTimeSeriesPoint), ultima fracionaria incluida', async () => {
    const points = Array.from({ length: 1501 }, (_, i) => ({
      offsetSec: i, distanceMeters: i, heartRateBpm: 150, speedKmh: 3.6, cadenceSpm: 170,
    }));
    const { service } = build({ points });
    const detail = await service.getDetail('aluno-1', 'log-1');
    expect(detail.splits.map((s) => s.isPartial)).toEqual([false, true]);
    expect(detail.splits[detail.splits.length - 1].distanceKm).toBe(0.5);
  });

  it('grafico agregado em baldes: nunca mais de 300 pontos, eixo por distancia, sem valor inventado', async () => {
    const points = Array.from({ length: 5000 }, (_, i) => ({
      offsetSec: i, distanceMeters: i, heartRateBpm: 150, speedKmh: 3.6, cadenceSpm: 170,
    }));
    const { service } = build({ points });
    const detail = await service.getDetail('aluno-1', 'log-1');
    expect(detail.chart.length).toBeLessThanOrEqual(300);
    expect(detail.chartAxis).toBe('distance');
    expect(detail.chart.every((p) => p.heartRateBpm === 150 && p.speedKmh === 3.6 && p.cadenceSpm === 170)).toBe(true);
  });

  it('metrica ausente na serie fica null no grafico (nunca zero)', async () => {
    const points = Array.from({ length: 100 }, (_, i) => ({
      offsetSec: i, distanceMeters: i * 3, heartRateBpm: null, speedKmh: 10.8, cadenceSpm: 0,
    }));
    const { service } = build({ points });
    const detail = await service.getDetail('aluno-1', 'log-1');
    expect(detail.chart.every((p) => p.heartRateBpm === null && p.cadenceSpm === null)).toBe(true);
  });

  it('CAUSA RAIZ: serie vazia com raw persistido => reconstroi do raw (sem Polar) e devolve parciais/graficos', async () => {
    const rebuilt = Array.from({ length: 2001 }, (_, i) => ({
      offsetSec: i, distanceMeters: i, heartRateBpm: 150, speedKmh: 3.6, cadenceSpm: 170,
    }));
    const { service, timeSeries } = build({ points: [], pointsAfterRebuild: rebuilt, rawCount: 5 });
    const detail = await service.getDetail('aluno-1', 'log-1');
    expect(timeSeries.normalizeFromRawSamples).toHaveBeenCalledWith('log-1', 'polar');
    expect(detail.splits.length).toBe(2); // 0..2000 m => 2 km fechados, sem resto
    expect(detail.chart.length).toBeGreaterThan(0);
  });

  it('serie vazia sem nenhum raw: nao tenta normalizar e devolve vazio (metrica ausente permanece ausente)', async () => {
    const { service, timeSeries } = build({ points: [], rawCount: 0 });
    const detail = await service.getDetail('aluno-1', 'log-1');
    expect(timeSeries.normalizeFromRawSamples).not.toHaveBeenCalled();
    expect(detail.splits).toEqual([]);
    expect(detail.chart).toEqual([]);
  });

  it('falha na reconstrucao nao derruba o detalhe', async () => {
    const { service, timeSeries } = build({ points: [], rawCount: 3 });
    timeSeries.normalizeFromRawSamples.mockRejectedValue(new Error('boom'));
    const detail = await service.getDetail('aluno-1', 'log-1');
    expect(detail.summary.distanceKm).toBe(30.076);
  });

  it('serie ja existente nao dispara reconstrucao', async () => {
    const points = [{ offsetSec: 0, distanceMeters: 0, heartRateBpm: 1, speedKmh: 1, cadenceSpm: 1 }];
    const { service, timeSeries } = build({ points, rawCount: 5 });
    await service.getDetail('aluno-1', 'log-1');
    expect(timeSeries.normalizeFromRawSamples).not.toHaveBeenCalled();
  });

  it('consulta a serie pela versao de normalizacao vigente (nunca mistura versoes)', async () => {
    const { service, prisma } = build({});
    await service.getDetail('aluno-1', 'log-1');
    expect(prisma.activityTimeSeriesPoint.findMany.mock.calls[0][0].where).toEqual({ activityLogId: 'log-1', normalizationVersion: 1 });
  });
});
