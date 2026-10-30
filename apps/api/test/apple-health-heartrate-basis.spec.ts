import { normalizeAppleHealthWorkout } from '../src/apple-health/apple-health-normalizer';
import { APPLE_SENSOR_KEYS } from '../src/apple-health/apple-health-consent.service';

// FC de treinos de terceiros (ex.: Garmin Connect) lida pelo intervalo do treino (30/10/2026). Dados SINTETICOS.
const workout = (over: Record<string, unknown> = {}) => ({
  uuid: '11111111-2222-3333-4444-555555555555', sourceName: 'Garmin Connect', sourceBundleId: 'com.garmin.connect.mobile', activityType: 'running', activityTypeRaw: 37,
  startDate: '2026-10-29T20:00:00.000Z', endDate: '2026-10-29T20:35:00.000Z', durationSeconds: 2100, distanceMeters: 6000, ...over,
});
const ok = (input: unknown, sensors: boolean) => { const r = normalizeAppleHealthWorkout(input, { sensors }); if (!r.ok) throw new Error(r.reason); return r.value; };

describe('base da frequência cardíaca do treino', () => {
  it('com medidas autorizadas: guarda a FC e a base ("time_window" para treino sem estatística própria)', () => {
    const value = ok(workout({ avgHeartRateBpm: 151.4, maxHeartRateBpm: 176, heartRateBasis: 'time_window' }), true);
    expect(value.activity.avgHeartRateBpm).toBe(151);
    expect(value.activity.maxHeartRateBpm).toBe(176);
    expect(JSON.stringify(value.providerMetrics)).toContain('"heartRateBasis":"time_window"');
  });

  it('sem FC não há base (ausência continua ausência); base desconhecida é ignorada', () => {
    const none = ok(workout({ heartRateBasis: 'time_window' }), true);
    expect(none.activity.avgHeartRateBpm).toBeNull();
    expect(JSON.stringify(none.providerMetrics)).toContain('"heartRateBasis":null');
    const odd = ok(workout({ avgHeartRateBpm: 140, heartRateBasis: 'qualquer_coisa' }), true);
    expect(JSON.stringify(odd.providerMetrics)).toContain('"heartRateBasis":null');
  });

  it('sem autorização das medidas: nada de FC nem de base; a base entra na limpeza ao retirar o grupo', () => {
    const value = ok(workout({ avgHeartRateBpm: 151, maxHeartRateBpm: 176, heartRateBasis: 'time_window' }), false);
    expect(value.activity.avgHeartRateBpm).toBeNull();
    expect(JSON.stringify(value.providerMetrics)).toContain('"heartRateBasis":null');
    expect(APPLE_SENSOR_KEYS as readonly string[]).toContain('heartRateBasis');
  });
});
