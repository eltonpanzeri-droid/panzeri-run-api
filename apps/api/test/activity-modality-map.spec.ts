import { appleHealthModality, wahooModality } from '../src/activity-execution/activity-modality-map';
import { canonicalModality } from '../src/activity-execution/canonical-modality';
import { compareObservations, observerKeyOf, ObservedActivity } from '../src/activity-execution/physical-activity-identity';
import { normalizeAppleHealthWorkout } from '../src/apple-health/apple-health-normalizer';
import { normalizePolarModality } from '../src/polar/polar-activity-normalizer';

// Equivalencias oficiais de modalidade (10/2026): so' codigos da tabela de cada provedor; nada por semelhanca de nome.

describe('Apple HealthKit (HKWorkoutActivityType, valores numericos oficiais)', () => {
  it('corrida (37), esteira (running em ambiente fechado), forca (50) e funcional (20/11/63/73/59)', () => {
    expect(appleHealthModality(37, 'running', false)).toBe('corrida');
    expect(appleHealthModality(37, 'running', true)).toBe('esteira');
    expect(appleHealthModality(50, 'other', null)).toBe('forca');
    for (const raw of [20, 11, 63, 73, 59]) expect(appleHealthModality(raw, 'other', null)).toBe('funcional');
  });

  it('natacao (46), ciclismo (13/74) e caminhada (52/24); futebol, tenis e desconhecidos sao registrados como outra', () => {
    expect(appleHealthModality(46, 'other', null)).toBe('natacao');
    expect(appleHealthModality(13, 'other', null)).toBe('bike');
    expect(appleHealthModality(74, 'other', null)).toBe('bike');
    expect(appleHealthModality(52, 'other', null)).toBe('caminhada');
    expect(appleHealthModality(24, 'other', null)).toBe('caminhada');
    for (const raw of [41, 48, 3000, 9999]) expect(appleHealthModality(raw, 'other', null)).toBe('outra');
  });

  it('sem o numero (versao antiga do app): so\' "running" e reconhecido; nome parecido nao vira equivalencia', () => {
    expect(appleHealthModality(null, 'running', null)).toBe('corrida');
    expect(appleHealthModality(null, 'strength_training', null)).toBe('outra');
    expect(appleHealthModality(undefined, 'other', null)).toBe('outra');
  });

  it('o normalizador grava a modalidade canonica e preserva o tipo bruto no payload', () => {
    const base = { uuid: '8ced6eb4-59f8-4499-a7ae-38976cb5a02b', startDate: '2026-10-01T10:34:01.000Z', endDate: '2026-10-01T11:24:57.000Z', durationSeconds: 3056, activityType: 'other', isIndoor: false };
    const result = normalizeAppleHealthWorkout({ ...base, activityTypeRaw: 50 });
    expect(result.ok && result.value.activity.sport).toBe('forca');
    expect(result.ok && result.value.raw.activityTypeRaw).toBe(50);
    const swim = normalizeAppleHealthWorkout({ ...base, activityTypeRaw: 46 });
    expect(swim.ok && swim.value.activity.sport).toBe('natacao');
    const run = normalizeAppleHealthWorkout({ ...base, activityType: 'running', activityTypeRaw: 37 });
    expect(run.ok && run.value.activity.sport).toBe('corrida');
  });
});

describe('deduplicacao entre provedores com o vocabulario ampliado', () => {
  const obs = (overrides: Partial<ObservedActivity> & { id: string }): ObservedActivity => ({
    userId: 'u', provider: 'polar', sport: 'forca', startedAt: new Date('2026-10-01T08:04:51Z'), durationSec: 3460, distanceMeters: null, endedAt: null, observerKey: 'polar', ...overrides,
  });
  const apple = observerKeyOf('apple_health', { source: { bundleId: 'com.apple.health.X', name: 'Treino' } });

  it('forca (Polar) e funcional (Apple) do mesmo horario continuam sendo o MESMO evento fisico', () => {
    const result = compareObservations(obs({ id: 'p' }), obs({ id: 'a', provider: 'apple_health', sport: 'funcional', observerKey: apple, startedAt: new Date('2026-10-01T08:04:55Z'), durationSec: 3458 }));
    expect(result.verdict).toBe('same');
  });

  it('natacao e bike continuam incompativeis entre si; forca e corrida tambem', () => {
    const base = { provider: 'apple_health', observerKey: apple, startedAt: new Date('2026-10-01T08:04:55Z'), durationSec: 3458 };
    expect(compareObservations(obs({ id: 'p', sport: 'natacao' }), obs({ id: 'a', sport: 'bike', ...base })).verdict).not.toBe('same');
    expect(compareObservations(obs({ id: 'p', sport: 'forca' }), obs({ id: 'a', sport: 'corrida', ...base })).verdict).not.toBe('same');
  });
});

describe('Wahoo (workout_type_id) e Polar', () => {
  it('Wahoo: corrida, esteira, bike, natacao, caminhada, funcional (WORKOUT generico); motociclismo e ioga nao viram bike/forca', () => {
    expect(wahooModality(5)).toBe('esteira');
    expect(wahooModality(67)).toBe('corrida');
    expect(wahooModality(15)).toBe('bike');
    expect(wahooModality(26)).toBe('natacao');
    expect(wahooModality(56)).toBe('caminhada');
    expect(wahooModality(42)).toBe('funcional');
    expect([wahooModality(17), wahooModality(66), wahooModality(69), wahooModality(null)]).toEqual(['outra', 'outra', 'outra', 'outra']);
  });

  it('Polar: so\' o documentado/observado — RUNNING e OTHER+STRENGTH_TRAINING; o resto e registrado como outra', () => {
    expect(normalizePolarModality({ sport: 'RUNNING' })).toBe('corrida');
    expect(normalizePolarModality({ sport: 'OTHER', 'detailed-sport-info': 'STRENGTH_TRAINING' })).toBe('forca');
    expect(normalizePolarModality({ sport: 'OTHER', 'detailed-sport-info': 'FUNCTIONAL_TRAINING' })).toBe('outra');
  });

  it('o vocabulario canonico aceita as modalidades novas e continua idempotente', () => {
    for (const m of ['corrida', 'esteira', 'forca', 'funcional', 'bike', 'natacao', 'caminhada', 'outra']) expect(canonicalModality(m)).toBe(m);
    expect(canonicalModality('RUNNING')).toBe('corrida');
    expect(canonicalModality('OTHER')).toBe('outra');
  });
});
