import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AiRunDaySchema } from '../src/training-plans/prescription-agent.service';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { buildCanonicalWorkout } from '../src/training-plans/canonical-workout';
import { translateToGarminWorkout } from '../src/garmin/garmin-workout-spec';
import { traceStub } from './helpers/trace-stub';

// 18/11/2026 (Elton, caso Juliana/Garmin): a IA prescreve TODO ritmo em faixa (min < max). O esquema tem os campos, o gerador usa a faixa da IA, e decisoes antigas (sem faixa) continuam com a banda de +-20 s.
const noop = {} as never;
const service = new TrainingPlansService(noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, traceStub()) as unknown as {
  runPrescription: (durationMin: number, modality: string, decision: { parts: unknown[] }) => Record<string, any>;
};
const withRange = { kind: 'intervalada', repeatCount: 5, stimulusLabel: 'Correr forte', stimulusStepKm: 1, stimulusPaceSecondsPerKm: 255, stimulusPaceSecondsPerKmMin: 245, stimulusPaceSecondsPerKmMax: 265, recoveryLabel: 'Trotar', recoveryStepKm: 0.4, recoveryPaceSecondsPerKm: 390, recoveryPaceSecondsPerKmMin: 370, recoveryPaceSecondsPerKmMax: 410 };
const oldStyle = { kind: 'intervalada', repeatCount: 5, stimulusLabel: 'Correr forte', stimulusStepKm: 1, stimulusPaceSecondsPerKm: 255, recoveryLabel: 'Trotar', recoveryStepKm: 0.4, recoveryPaceSecondsPerKm: 390 };

describe('IA prescreve ritmo sempre em faixa', () => {
  it('esquema da IA: o intervalado tem os campos Min/Max de estimulo e recuperacao, e o formato estruturado continua valido', () => {
    expect(() => zodOutputFormat(AiRunDaySchema)).not.toThrow();
    expect(AiRunDaySchema.safeParse({ parts: [withRange], reasoning: null }).success).toBe(true);
    // sem a faixa o esquema recusa (a IA e' obrigada a mandar), em vez de aceitar um ritmo unico
    expect(AiRunDaySchema.safeParse({ parts: [oldStyle], reasoning: null }).success).toBe(false);
  });

  it('gerador: a faixa da IA vale (245 a 265 / 370 a 410), nao a banda de +-20 s ao redor do centro', () => {
    const session = service.runPrescription(50, 'corrida', { parts: [withRange] });
    const steps = session.blocks[0].steps;
    expect(steps[0].paceRange).toBe('4:05/km a 4:25/km');
    expect(steps[1].paceRange).toBe('6:10/km a 6:50/km');
  });

  it('decisao antiga sem faixa continua com a banda de +-20 s (nada quebra)', () => {
    const session = service.runPrescription(50, 'corrida', { parts: [oldStyle] });
    expect(session.blocks[0].steps[0].paceRange).toBe('3:55/km a 4:35/km');
  });

  it('faixa invertida e faixa de limites iguais nao geram faixa invalida', () => {
    const inverted = service.runPrescription(50, 'corrida', { parts: [{ ...withRange, stimulusPaceSecondsPerKmMin: 265, stimulusPaceSecondsPerKmMax: 245 }] });
    expect(inverted.blocks[0].steps[0].paceRange).toBe('4:05/km a 4:25/km');
    const equal = service.runPrescription(50, 'corrida', { parts: [{ ...withRange, stimulusPaceSecondsPerKmMin: 255, stimulusPaceSecondsPerKmMax: 255 }] });
    expect(equal.blocks[0].steps[0].paceRange).toBe('3:55/km a 4:35/km'); // cai na banda antiga: nunca limites iguais
  });

  it('ponta a ponta: a faixa da IA chega ao Garmin (m/s, baixo < alto)', () => {
    const canonical = buildCanonicalWorkout({ id: 's1', modality: 'corrida', structure: service.runPrescription(50, 'corrida', { parts: [withRange] }) });
    const result = translateToGarminWorkout(canonical, { scheduledDate: '2026-11-18', distanceKm: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repeat = result.workout.segments[0].steps[0] as { steps: Array<{ targetValueLow: number; targetValueHigh: number }> };
    expect(repeat.steps[0].targetValueHigh).toBeCloseTo(1000 / 245, 2);
    expect(repeat.steps[0].targetValueLow).toBeCloseTo(1000 / 265, 2);
  });

  it('o prompt manda prescrever SEMPRE em faixa, nos dois pontos de entrada (semana inteira e um dia)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'training-plans', 'prescription-agent.service.ts'), 'utf8');
    expect(source.match(/REGRA DE FAIXA/g)?.length).toBe(2);
    expect(source).not.toContain('use o mesmo numero nos dois quando o ritmo for constante');
    expect(source).not.toContain('mesmo numero nos dois quando o ritmo for constante');
  });
});
