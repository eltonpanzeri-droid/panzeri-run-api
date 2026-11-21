import { NotFoundException } from '@nestjs/common';
import { buildRecordingChoices, recordingLabel, type RecordingMember } from '../src/activity-execution/recording-choices';
import { ROUTE_MAX_POINTS, simplifyRoute } from '../src/activity-execution/route-points';
import { ActivityDetailService } from '../src/activity-execution/activity-detail.service';

// 21/11/2026 — "Qual gravacao vale?" na tela (so' existe com gravacao do Panzeri Run no evento) e percurso para o mapa/cartao de compartilhamento.
const member = (id: string, provider: string, over: Partial<RecordingMember> = {}): RecordingMember => ({
  id, provider, physicalEventId: 'ev1', physicalIdentityStatus: 'matched', physicalCanonicalActivityLogId: 'run', studentCanonicalChoiceAt: null, durationSec: 1800, distanceMeters: 5000,
  avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null, hasRoute: null, providerMetrics: {}, ...over,
});

describe('escolha entre a gravacao do Panzeri Run e a do relogio (o que a tela recebe)', () => {
  it('padrao: vale o Panzeri Run; o relogio aparece como outra gravacao, com o que registrou a mais', () => {
    const run = member('run', 'panzeri_run');
    const watch = member('watch', 'garmin', { avgHeartRateBpm: 150, cadenceAvg: 170, hasRoute: true, providerMetrics: { garmin: { deviceName: 'Forerunner 265' } } });
    const out = buildRecordingChoices(['run'], [run, watch]);
    expect(out.run).toMatchObject({ currentProvider: 'panzeri_run', currentIsOwn: true, chosenByStudent: false });
    expect(out.run.alternatives).toEqual([{ activityLogId: 'watch', provider: 'garmin', label: 'Garmin Forerunner 265', durationMin: 30, distanceKm: 5, avgHeartRateBpm: 150, hasCadence: true, hasPower: false, hasRoute: true, moreData: true }]);
  });
  it('escolhida pela aluna: vale o relogio; a alternativa passa a ser voltar ao Panzeri Run', () => {
    const run = member('run', 'panzeri_run', { physicalCanonicalActivityLogId: 'watch' });
    const watch = member('watch', 'garmin', { physicalCanonicalActivityLogId: 'watch', studentCanonicalChoiceAt: new Date(), avgHeartRateBpm: 150 });
    const out = buildRecordingChoices(['watch'], [run, watch]);
    expect(out.watch).toMatchObject({ currentProvider: 'garmin', currentIsOwn: false, chosenByStudent: true });
    expect(out.watch.alternatives.map((a) => [a.activityLogId, a.provider, a.moreData])).toEqual([['run', 'panzeri_run', false]]);
  });
  it('relogio sem dado a mais que o Panzeri Run: nao recomenda (moreData=false)', () => {
    const out = buildRecordingChoices(['run'], [member('run', 'panzeri_run'), member('watch', 'polar')]);
    expect(out.run.alternatives[0].moreData).toBe(false);
  });
  it('sem gravacao do Panzeri Run no evento, ou evento ambiguo/unico, ou id desconhecido: nada a escolher', () => {
    expect(buildRecordingChoices(['a'], [member('a', 'garmin', { physicalCanonicalActivityLogId: 'a' }), member('b', 'polar', { physicalCanonicalActivityLogId: 'a' })])).toEqual({});
    expect(buildRecordingChoices(['run'], [member('run', 'panzeri_run', { physicalIdentityStatus: 'unique', physicalEventId: null })])).toEqual({});
    expect(buildRecordingChoices(['run'], [member('run', 'panzeri_run', { physicalIdentityStatus: 'ambiguous' }), member('w', 'garmin', { physicalIdentityStatus: 'ambiguous' })])).toEqual({});
    expect(buildRecordingChoices(['x'], [member('run', 'panzeri_run')])).toEqual({});
    expect(buildRecordingChoices(['run'], [member('run', 'panzeri_run')])).toEqual({}); // so' a propria gravacao
  });
  it('mais de um relogio no evento: lista todos, em ordem estavel', () => {
    const out = buildRecordingChoices(['run'], [member('run', 'panzeri_run'), member('w2', 'polar'), member('w1', 'garmin')]);
    expect(out.run.alternatives.map((a) => a.activityLogId)).toEqual(['w1', 'w2']);
  });
});

describe('nome da fonte (credito do fabricante)', () => {
  it('Garmin: "Garmin [modelo]" sem repetir a palavra; sem modelo so Garmin; outras fontes pelo nome', () => {
    expect(recordingLabel('garmin', { garmin: { deviceName: 'Forerunner 265' } })).toBe('Garmin Forerunner 265');
    expect(recordingLabel('garmin', { garmin: { deviceName: 'Garmin Fenix 7' } })).toBe('Garmin Fenix 7');
    expect(recordingLabel('garmin', {})).toBe('Garmin');
    expect(recordingLabel('garmin', null)).toBe('Garmin');
    expect(recordingLabel('polar', {})).toBe('Polar');
    expect(recordingLabel('panzeri_run', {})).toBe('Panzeri Run');
    expect(recordingLabel('desconhecido', {})).toBe('desconhecido');
  });
});

describe('percurso para mapa e cartao', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ offsetSec: i, latitude: -19.9 + i * 1e-5, longitude: -43.9, elevationMeters: 800 + (i % 5) }));
  it('mantem o primeiro e o ultimo ponto (nada do inicio ou do fim e escondido) e respeita o limite', () => {
    const out = simplifyRoute(rows(5000));
    expect(out).toHaveLength(ROUTE_MAX_POINTS);
    expect(out[0].t).toBe(0);
    expect(out[out.length - 1].t).toBe(4999);
    expect(simplifyRoute(rows(10))).toHaveLength(10);
    expect(simplifyRoute(rows(5), 2).map((p) => p.t)).toEqual([0, 4]);
  });
  it('descarta coordenada invalida, 0/0 e altitude absurda vira nula', () => {
    const out = simplifyRoute([
      { offsetSec: 0, latitude: null, longitude: null, elevationMeters: null }, { offsetSec: 1, latitude: 0, longitude: 0, elevationMeters: null }, { offsetSec: 2, latitude: 95, longitude: 10, elevationMeters: null },
      { offsetSec: 3, latitude: -19.9, longitude: -43.9, elevationMeters: Number.NaN }, { offsetSec: 4, latitude: -19.91, longitude: -43.9, elevationMeters: 812.34 },
    ]);
    expect(out).toEqual([{ t: 3, lat: -19.9, lon: -43.9, alt: null }, { t: 4, lat: -19.91, lon: -43.9, alt: 812.3 }]);
  });

  function service(log: Record<string, unknown> | null, points: unknown[] = []) {
    const prisma = { activityLog: { findFirst: jest.fn(async () => log) }, activityTimeSeriesPoint: { findMany: jest.fn(async () => points) } };
    return { service: new ActivityDetailService(prisma as never, {} as never), prisma };
  }
  const log = (over: Record<string, unknown> = {}) => ({ id: 'a1', userId: 'u1', provider: 'garmin', startedAt: new Date('2026-11-20T09:00:00Z'), utcOffsetMinutes: -180, sport: 'corrida', distanceMeters: 5060, durationSec: 1607, elevationGainMeters: 36, hasRoute: true, providerMetrics: { garmin: { deviceName: 'Forerunner 265' } }, ...over });

  it('devolve resumo e percurso da atividade da propria aluna; Garmin leva o credito "Garmin [modelo]"', async () => {
    const h = service(log(), [{ offsetSec: 0, latitude: -19.9, longitude: -43.9, elevationMeters: 800 }, { offsetSec: 9, latitude: -19.91, longitude: -43.91, elevationMeters: 801 }]);
    const r = await h.service.getRoute('u1', 'a1');
    expect(r).toMatchObject({ activityLogId: 'a1', provider: 'garmin', distanceKm: 5.06, durationSec: 1607, avgPaceSecondsKm: 318, elevationGainMeters: 36, attribution: 'Garmin Forerunner 265' });
    expect(r.points).toHaveLength(2);
    expect(h.prisma.activityLog.findFirst).toHaveBeenCalledWith({ where: { id: 'a1', userId: 'u1' } });
  });
  it('Polar leva o credito da Polar; Panzeri Run e outras fontes sem credito; sem percurso devolve lista vazia sem consultar pontos', async () => {
    expect((await service(log({ provider: 'polar' })).service.getRoute('u1', 'a1')).attribution).toBe('Dados fornecidos pela Polar (Polar Flow)');
    expect((await service(log({ provider: 'panzeri_run' })).service.getRoute('u1', 'a1')).attribution).toBeNull();
    const noRoute = service(log({ hasRoute: false }));
    expect((await noRoute.service.getRoute('u1', 'a1')).points).toEqual([]);
    expect(noRoute.prisma.activityTimeSeriesPoint.findMany).not.toHaveBeenCalled();
  });
  it('atividade de outra conta ou inexistente: 404', async () => {
    await expect(service(null).service.getRoute('intruso', 'a1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
