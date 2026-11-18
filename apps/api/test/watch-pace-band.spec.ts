import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { buildCanonicalWorkout, paceBoundForWatch } from '../src/training-plans/canonical-workout';
import { translateToGarminWorkout } from '../src/garmin/garmin-workout-spec';
import { translateToCorosCourse } from '../src/coros/coros-workout-spec';
import { traceStub } from './helpers/trace-stub';

// 18/11/2026 (Elton, caso Juliana/Garmin): o app mostra a FAIXA (ex.: 3:55 a 4:35) e o relogio tem que receber a MESMA faixa. Antes so' o centro (valor unico) ia, e o relogio
// avisava "fora do ritmo" o tempo todo. A banda de +-20 s do gerador agora vai ao relogio; faixa prescrita (continuo) continua como esta.
const noop = {} as never;
const service = new TrainingPlansService(noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, traceStub()) as unknown as {
  runPrescription: (durationMin: number, modality: string, decision: { parts: unknown[] }) => Record<string, unknown>;
};
const interval = { kind: 'intervalada', repeatCount: 5, stimulusLabel: 'Correr forte', stimulusStepKm: 1, stimulusPaceSecondsPerKm: 255, recoveryLabel: 'Trotar', recoveryStepKm: 0.4, recoveryPaceSecondsPerKm: 390 };
const continua = { kind: 'continua', distanceKm: 2, paceSecondsPerKmMin: 340, paceSecondsPerKmMax: 360 };
const canonical = () => buildCanonicalWorkout({ id: 's1', modality: 'corrida', structure: service.runPrescription(50, 'corrida', { parts: [continua, interval] }) });

describe('faixa de pace enviada aos relogios', () => {
  it('paceBoundForWatch: usa a banda do gerador quando existe; senao, o prescrito', () => {
    expect(paceBoundForWatch({ prescribed: { fastSecPerKm: 255, slowSecPerKm: 255 }, derivedToleranceBand: { fastSecPerKm: 235, slowSecPerKm: 275, toleranceSec: 20 } })).toEqual({ fastSecPerKm: 235, slowSecPerKm: 275 });
    expect(paceBoundForWatch({ prescribed: { fastSecPerKm: 340, slowSecPerKm: 360 }, derivedToleranceBand: null })).toEqual({ fastSecPerKm: 340, slowSecPerKm: 360 });
  });

  it('Garmin: o intervalado leva faixa (low != high, em m/s) e o aquecimento continua com a faixa prescrita', () => {
    const result = translateToGarminWorkout(canonical(), { scheduledDate: '2026-11-18', distanceKm: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const steps = result.workout.segments[0].steps;
    const warm = steps[0] as { targetValueLow: number; targetValueHigh: number };
    expect(warm.targetValueLow).toBeLessThan(warm.targetValueHigh);
    const repeat = steps[1] as { steps: Array<{ targetValueLow: number | null; targetValueHigh: number | null }> };
    const work = repeat.steps[0];
    expect(work.targetValueLow).toBeLessThan(work.targetValueHigh as number);
    expect(work.targetValueHigh).toBeCloseTo(1000 / 235, 2); // 3:55/km
    expect(work.targetValueLow).toBeCloseTo(1000 / 275, 2); // 4:35/km
  });

  it('COROS: o intervalado vai com os limites 235 e 275 s/km, nao com o valor unico', () => {
    const result = translateToCorosCourse(canonical(), { scheduledDate: '2026-11-18' } as never);
    expect(JSON.stringify(result)).toContain('235');
    expect(JSON.stringify(result)).toContain('275');
  });
});
