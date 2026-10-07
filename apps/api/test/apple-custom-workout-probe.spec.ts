import { readFileSync } from 'fs';
import { join } from 'path';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { buildCanonicalWorkout } from '../src/training-plans/canonical-workout';
import { translateToAppleCustomWorkout } from '../src/workout-delivery/apple-custom-workout-spec';
import { CUSTOM_WORKOUT_PROBE_CASES } from '../../mobile/src/appleWatchDelivery/customWorkoutProbeSpecs';
import { validateAppleSpecOnDevice } from '../../mobile/src/appleWatchDelivery/customWorkoutBridge';

// Sonda nativa (Apple Etapa 6): os specs embutidos no app sao EXATAMENTE a saida do tradutor Apple da API para os tres casos de referencia, e a
// tela usa a ponte ja existente (nenhuma segunda implementacao). O Swift em si so' roda no iPhone.
const noop = {} as never;
const service = new TrainingPlansService(noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop) as unknown as {
  runPrescription: (durationMin: number, modality: string, decision: { parts: unknown[] }) => Record<string, unknown>;
};
const continua = (distanceKm: number, min: number, max = min) => ({ kind: 'continua', distanceKm, paceSecondsPerKmMin: min, paceSecondsPerKmMax: max });
const intervalada = (repeatCount: number, stimulus: [string, number, number], recovery: [string, number, number]) => ({
  kind: 'intervalada', repeatCount,
  stimulusLabel: stimulus[0], stimulusStepKm: stimulus[1], stimulusPaceSecondsPerKm: stimulus[2],
  recoveryLabel: recovery[0], recoveryStepKm: recovery[1], recoveryPaceSecondsPerKm: recovery[2],
});
const REFERENCE: Record<string, unknown[]> = {
  continuo: [continua(8, 345, 360)],
  intervalado: [intervalada(6, ['Correr forte', 0.4, 240], ['Trotar', 0.2, 420])],
  misto: [continua(2, 360), intervalada(5, ['Forte', 1, 300], ['Caminhar', 0.4, 600]), continua(2, 380, 400)],
};

describe('Sonda nativa do CustomWorkout — specs de referencia', () => {
  it('os 3 specs embutidos no app sao identicos a saida real do tradutor Apple (continuo, intervalado, misto)', () => {
    expect(CUSTOM_WORKOUT_PROBE_CASES.map((c) => c.key)).toEqual(['continuo', 'intervalado', 'misto']);
    for (const probe of CUSTOM_WORKOUT_PROBE_CASES) {
      const structure = service.runPrescription(50, 'corrida', { parts: REFERENCE[probe.key] });
      const translated = translateToAppleCustomWorkout(buildCanonicalWorkout({ id: `sonda-${probe.key}`, modality: 'corrida', structure }));
      if (!translated.ok) throw new Error(`recusado: ${JSON.stringify(translated.refusals)}`);
      expect(probe.spec).toEqual(translated.spec);
    }
  });

  it('as formas pedidas: 1x[work 8000], 6x[work 400, recovery 200], 1x[2000] -> 5x[1000, 400] -> 1x[2000]', () => {
    const blocks = Object.fromEntries(CUSTOM_WORKOUT_PROBE_CASES.map((c) => [c.key, c.spec.blocks]));
    expect(blocks.continuo).toEqual([{ iterations: 1, steps: [{ purpose: 'work', goal: { type: 'distance', meters: 8000 } }] }]);
    expect(blocks.intervalado).toEqual([{ iterations: 6, steps: [{ purpose: 'work', goal: { type: 'distance', meters: 400 } }, { purpose: 'recovery', goal: { type: 'distance', meters: 200 } }] }]);
    expect(blocks.misto).toHaveLength(3);
    expect((blocks.misto as Array<{ iterations: number }>).map((b) => b.iterations)).toEqual([1, 5, 1]);
  });

  it('a tela executa os specs pela MESMA ponte (validateAppleSpecOnDevice) e mostra o veredito e os erros nativos sem generalizar', () => {
    const calls: string[] = [];
    const native = {
      isSupported: true,
      validateCustomWorkoutSpec: (json: string) => {
        calls.push(json);
        return { valid: false, errors: [{ code: 'E_WORKOUTKIT_DATA_REPRESENTATION_FAILED', message: 'falhou', path: '' }] };
      },
    };
    const results = CUSTOM_WORKOUT_PROBE_CASES.map((probe) => validateAppleSpecOnDevice(native, probe.spec));
    expect(calls).toEqual(CUSTOM_WORKOUT_PROBE_CASES.map((probe) => JSON.stringify(probe.spec)));
    expect(results.every((r) => !r.ok && r.reason === 'native_rejected' && r.errors[0].code === 'E_WORKOUTKIT_DATA_REPRESENTATION_FAILED')).toBe(true);
  });

  it('contrato da tela: usa a ponte, mostra VALIDO/INVALIDO, code/message/path e a razao; nao agenda, nao pede autorizacao, nao usa o botao real nem o WorkoutDelivery', () => {
    const card = readFileSync(join(__dirname, '..', '..', 'mobile', 'src', 'appleWatchDelivery', 'CustomWorkoutProbeCard.tsx'), 'utf8');
    expect(card).toContain('validateAppleSpecOnDevice');
    expect(card).toContain('validateCustomWorkoutSpec');
    expect(card).toContain("'VÁLIDO' : 'INVÁLIDO'");
    for (const field of ['code:', 'message:', 'path:', 'outcome.reason']) expect(card).toContain(field);
    const code = card.split(/\r?\n/).filter((line) => !line.trim().startsWith('//')).join(' '); // so' o codigo, sem os comentarios
    expect(code).not.toMatch(/requestWorkoutAuthorization|scheduleRunWorkout|listScheduledWorkouts|WorkoutScheduler|sendSessionToAppleWatch|AppleWatchSendButton|\/me\/apple-watch|fetch\(/);
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain('<CustomWorkoutProbeCard />');
  });
});
