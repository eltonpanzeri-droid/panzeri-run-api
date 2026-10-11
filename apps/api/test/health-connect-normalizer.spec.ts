import { normalizeHealthConnectExercise, recordingMethodLabel } from '../src/health-connect/health-connect-normalizer';
import { healthConnectModality } from '../src/activity-execution/activity-modality-map';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const base = {
  recordId: 'hc-1',
  dataOrigin: 'fi.polar.polarflow',
  lastModifiedTime: '2026-10-09T10:30:00.000Z',
  exerciseType: 56,
  startTime: '2026-10-09T09:00:00.000Z',
  endTime: '2026-10-09T09:55:00.000Z',
  startZoneOffsetSeconds: -10800,
  device: { manufacturer: 'Polar', model: 'Vantage V3', type: 1 },
  recordingMethod: 1,
  distanceMeters: 10000,
  avgHeartRateBpm: 150,
  maxHeartRateBpm: 172,
  heartRateSampleCount: 3300,
};
const ok = (input: unknown) => {
  const r = normalizeHealthConnectExercise(input, NOW);
  if (!r.ok) throw new Error(`rejeitado: ${r.reason}`);
  return r.value;
};

describe('normalizador Health Connect', () => {
  it('corrida com distancia e FC: campos canonicos e proveniencia em camadas separadas (canal x app x dispositivo)', () => {
    const v = ok(base);
    expect(v.externalId).toBe('hc-1');
    expect(v.activity).toMatchObject({ sport: 'corrida', durationSec: 3300, distanceMeters: 10000, avgHeartRateBpm: 150, maxHeartRateBpm: 172, utcOffsetMinutes: -180 });
    expect(v.providerMetrics).toMatchObject({
      channel: 'health_connect',
      source: { packageName: 'fi.polar.polarflow', name: null },
      device: { manufacturer: 'Polar', model: 'Vantage V3', type: 1 },
      recordingMethod: 'actively_recorded',
      hcRecordId: 'hc-1',
    });
  });

  it('sem distancia: distancia null (nunca zero inventado)', () => {
    const { distanceMeters: _d, ...rest } = base;
    expect(ok(rest).activity.distanceMeters).toBeNull();
  });

  it('sem FC: FC null e sem bloco de FC na proveniencia', () => {
    const { avgHeartRateBpm: _a, maxHeartRateBpm: _m, heartRateSampleCount: _c, ...rest } = base;
    const v = ok(rest);
    expect(v.activity.avgHeartRateBpm).toBeNull();
    expect(v.activity.maxHeartRateBpm).toBeNull();
    expect(v.providerMetrics.heartRate).toBeNull();
  });

  it('FC fora da faixa ou max < media: descartada, nunca "corrigida"', () => {
    expect(ok({ ...base, avgHeartRateBpm: 400 }).activity.avgHeartRateBpm).toBeNull();
    const inconsistent = ok({ ...base, avgHeartRateBpm: 170, maxHeartRateBpm: 150 });
    expect(inconsistent.activity.avgHeartRateBpm).toBeNull();
    expect(inconsistent.activity.maxHeartRateBpm).toBeNull();
  });

  it('dispositivo ausente permanece null (nao presume Galaxy Watch, Polar etc.)', () => {
    const { device: _d, ...rest } = base;
    expect(ok(rest).providerMetrics.device).toBeNull();
    expect(ok({ ...base, device: {} }).providerMetrics.device).toBeNull();
  });

  it('fuso ausente permanece null', () => {
    const { startZoneOffsetSeconds: _z, ...rest } = base;
    expect(ok(rest).activity.utcOffsetMinutes).toBeNull();
  });

  it('modalidade: forca/outra/desconhecida registradas, nunca descartadas', () => {
    expect(ok({ ...base, exerciseType: 70 }).activity.sport).toBe('forca');
    expect(ok({ ...base, exerciseType: 57 }).activity.sport).toBe('esteira');
    expect(ok({ ...base, exerciseType: 9999 }).activity.sport).toBe('outra');
    expect(healthConnectModality('x')).toBe('outra');
  });

  it('metodo de gravacao: ativo, automatico, manual; desconhecido vira null', () => {
    expect([1, 2, 3, 0, 7].map(recordingMethodLabel)).toEqual(['actively_recorded', 'automatically_recorded', 'manual_entry', null, null]);
  });

  it.each([
    ['item nao-objeto', 'x', 'item_invalido'],
    ['sem id', { ...base, recordId: '' }, 'registro_sem_id'],
    ['tipo invalido', { ...base, exerciseType: 'corrida' }, 'tipo_invalido'],
    ['inicio invalido', { ...base, startTime: 'ontem' }, 'inicio_invalido'],
    ['fim antes do inicio', { ...base, endTime: '2026-10-09T08:00:00.000Z' }, 'fim_invalido'],
    ['inicio no futuro', { ...base, startTime: '2026-10-20T09:00:00.000Z', endTime: '2026-10-20T10:00:00.000Z' }, 'inicio_futuro'],
    ['duracao absurda', { ...base, endTime: '2026-10-20T09:00:00.000Z' }, 'duracao_invalida'],
  ])('rejeita: %s', (_name, input, reason) => {
    expect(normalizeHealthConnectExercise(input, NOW)).toEqual({ ok: false, reason });
  });
});
