import { isRunModality } from '../src/activity-execution/canonical-modality';
import { appleWorkoutEligibility } from '../src/workout-delivery/apple-workout-eligibility';

// 05/11/2026 — ordem de Elton: ESTEIRA E' A MESMA COISA QUE CORRIDA. Nunca tratar como modalidade diferente sem ordem expressa.
describe('esteira e corrida', () => {
  it('isRunModality: corrida, esteira e os apelidos dos provedores sao corrida; o resto nao', () => {
    for (const value of ['corrida', 'esteira', 'running', 'RUNNING', 'treadmill', 'treadmill_running']) expect(isRunModality(value)).toBe(true);
    for (const value of ['forca', 'bike', 'natacao', 'caminhada', 'outra', null, undefined, 42]) expect(isRunModality(value)).toBe(false);
  });

  it('Apple Watch: a mesma sessao e elegivel como corrida e como esteira, com o mesmo resultado', () => {
    const structure = { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 5, distanceUnit: 'km' }] };
    const session = (modality: string) => ({ id: 's1', modality, origin: null, scheduledDate: new Date('2026-11-10T00:00:00Z'), distanceKm: 5, structure, completionStatus: null });
    const run = appleWorkoutEligibility(session('corrida'), '2026-11-06');
    const treadmill = appleWorkoutEligibility(session('esteira'), '2026-11-06');
    expect(run.eligible).toBe(true);
    expect(treadmill.eligible).toBe(true);
    if (run.eligible && treadmill.eligible) expect(treadmill.distanceKm).toBe(run.distanceKm);
  });
});
