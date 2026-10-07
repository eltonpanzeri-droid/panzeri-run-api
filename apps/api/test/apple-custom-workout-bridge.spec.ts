import { readFileSync } from 'fs';
import { join } from 'path';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { buildCanonicalWorkout } from '../src/training-plans/canonical-workout';
import { translateToAppleCustomWorkout } from '../src/workout-delivery/apple-custom-workout-spec';
import { validateAppleSpecOnDevice, AppleCustomWorkoutSpecJson, NativeCustomWorkoutValidation } from '../../mobile/src/appleWatchDelivery/customWorkoutBridge';

// Ponte AppleCustomWorkoutSpec -> Swift -> WorkoutKit CustomWorkout. IMPORTANTE: o Swift NAO roda neste ambiente (Windows/jest). Aqui se valida:
//  (1) a ponte JS (o spec segue como JSON identico ao do tradutor e o resultado nativo e' conferido contra ele, com erros nativos preservados);
//  (2) um contrato ESTATICO do codigo Swift (campos lidos, mapeamento mecanico, ausencia de alertas/agendamento/inferencia). Nao e' compilacao:
//      a construcao real do CustomWorkout so' e' provada em um build iOS no aparelho.
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
const specFor = (parts: unknown[]): AppleCustomWorkoutSpecJson => {
  const structure = service.runPrescription(50, 'corrida', { parts });
  const result = translateToAppleCustomWorkout(buildCanonicalWorkout({ id: 'sessao-1', modality: 'corrida', structure }));
  if (!result.ok) throw new Error(`recusado: ${JSON.stringify(result.refusals)}`);
  return result.spec as unknown as AppleCustomWorkoutSpecJson;
};

// Nativo SIMULADO: aplica a MESMA traducao mecanica descrita no Swift (bloco->IntervalBlock, iterations, work/recovery, metros) e devolve o eco.
function fakeNative(overrides: Partial<{ isSupported: boolean; behavior: (json: string) => NativeCustomWorkoutValidation }> = {}) {
  const calls: string[] = [];
  const native = {
    isSupported: overrides.isSupported ?? true,
    validateCustomWorkoutSpec: (json: string): NativeCustomWorkoutValidation => {
      calls.push(json);
      if (overrides.behavior) return overrides.behavior(json);
      const spec = JSON.parse(json) as AppleCustomWorkoutSpecJson;
      const blocks = spec.blocks.map((b) => ({ iterations: b.iterations, steps: b.steps.map((s) => ({ purpose: s.purpose as string, meters: s.goal.meters })) }));
      return {
        valid: true,
        errors: [],
        summary: { activity: 'running', location: 'outdoor', blocks, totalMeters: blocks.reduce((t, b) => t + b.iterations * b.steps.reduce((x, s) => x + s.meters, 0), 0), serializedBytes: 128 },
      };
    },
  };
  return { native, calls };
}

describe('Ponte JS — o spec do tradutor chega inalterado ao nativo e o eco e conferido', () => {
  it.each([
    ['1. continuo 1 x [work 8000 m]', [continua(8, 345, 360)], [{ iterations: 1, steps: [{ purpose: 'work', meters: 8000 }] }], 8000],
    ['2. intervalado 6 x [work 400 m, recovery 200 m]', [intervalada(6, ['Correr forte', 0.4, 240], ['Trotar', 0.2, 420])], [{ iterations: 6, steps: [{ purpose: 'work', meters: 400 }, { purpose: 'recovery', meters: 200 }] }], 3600],
    ['3. misto 1x[2000] -> 5x[1000, 400] -> 1x[2000]', [continua(2, 360), intervalada(5, ['Forte', 1, 300], ['Caminhar', 0.4, 600]), continua(2, 380, 400)], [
      { iterations: 1, steps: [{ purpose: 'work', meters: 2000 }] },
      { iterations: 5, steps: [{ purpose: 'work', meters: 1000 }, { purpose: 'recovery', meters: 400 }] },
      { iterations: 1, steps: [{ purpose: 'work', meters: 2000 }] },
    ], 11000],
  ])('%s', (_name, parts, expectedBlocks, totalMeters) => {
    const spec = specFor(parts as unknown[]);
    const { native, calls } = fakeNative();
    const result = validateAppleSpecOnDevice(native, spec);
    expect(calls).toEqual([JSON.stringify(spec)]); // o JSON enviado e' exatamente o do tradutor (sem reinterpretar)
    expect(result).toMatchObject({ ok: true, summary: { activity: 'running', location: 'outdoor', blocks: expectedBlocks, totalMeters } });
  });

  it('o spec nao carrega alerta/pace/banda derivada e warmup/cooldown sao null (o que o Swift exige)', () => {
    const spec = specFor([intervalada(4, ['Forte', 0.5, 300], ['Leve', 0.3, 420])]);
    expect(spec.warmup).toBeNull();
    expect(spec.cooldown).toBeNull();
    expect(JSON.stringify(spec)).not.toMatch(/pace|alert|speed|tolerance|band/i);
  });
});

describe('Ponte JS — erros explicitos e identificaveis (nunca uma mensagem generica)', () => {
  it('spec invalido/nao suportado recusado pelo nativo: codigo, caminho e mensagem nativos preservados', () => {
    const spec = specFor([continua(5, 360)]);
    const errors = [
      { code: 'E_SPEC_UNSUPPORTED_GOAL', message: 'Meta "time" nao suportada (apenas distance).', path: 'blocks[0].steps[0].goal.type' },
      { code: 'E_WORKOUTKIT_GOAL_UNSUPPORTED', message: 'O sistema nao suporta a meta de 5000 m para corrida ao ar livre.', path: 'blocks[0].steps[0].goal' },
    ];
    const { native } = fakeNative({ behavior: () => ({ valid: false, errors }) });
    expect(validateAppleSpecOnDevice(native, spec)).toEqual({ ok: false, reason: 'native_rejected', errors });
  });

  it('o nativo recusa sem detalhar: vira um erro identificavel, nao um sucesso', () => {
    const { native } = fakeNative({ behavior: () => ({ valid: false, errors: [] }) });
    const result = validateAppleSpecOnDevice(native, specFor([continua(5, 360)]));
    expect(result).toMatchObject({ ok: false, reason: 'native_rejected', errors: [{ code: 'E_NATIVE_UNKNOWN' }] });
  });

  it('o nativo aceita mas constroi algo diferente do spec: echo_mismatch (a traducao precisa ser mecanica e exata)', () => {
    const spec = specFor([intervalada(6, ['Forte', 0.4, 240], ['Leve', 0.2, 420])]);
    const { native } = fakeNative({
      behavior: () => ({ valid: true, errors: [], summary: { activity: 'running', location: 'outdoor', blocks: [{ iterations: 5, steps: [{ purpose: 'work', meters: 400 }, { purpose: 'recovery', meters: 200 }] }], totalMeters: 3000, serializedBytes: 1 } }),
    });
    expect(validateAppleSpecOnDevice(native, spec)).toMatchObject({ ok: false, reason: 'echo_mismatch', errors: [{ code: 'E_ECHO_MISMATCH' }] });
  });

  it('excecao nativa inesperada: mensagem e codigo reais preservados; fora do app nativo: nao suportado', () => {
    const boom = Object.assign(new Error('WorkoutKit exploded'), { code: 'E_WK' });
    const failing = fakeNative({ behavior: () => { throw boom; } });
    expect(validateAppleSpecOnDevice(failing.native, specFor([continua(5, 360)]))).toEqual({ ok: false, reason: 'native_error', errors: [{ code: 'E_WK', message: 'WorkoutKit exploded', path: '' }] });
    const unsupported = fakeNative({ isSupported: false });
    expect(validateAppleSpecOnDevice(unsupported.native, specFor([continua(5, 360)]))).toMatchObject({ ok: false, reason: 'not_supported' });
    expect(unsupported.calls).toHaveLength(0);
  });
});

describe('Contrato estatico do codigo Swift (nao e compilacao)', () => {
  const MODULE_DIR = join(__dirname, '..', '..', 'mobile', 'modules', 'panzeri-apple-health', 'ios');
  const builder = readFileSync(join(MODULE_DIR, 'CustomWorkoutSpecBuilder.swift'), 'utf8');
  const moduleSource = readFileSync(join(MODULE_DIR, 'PanzeriAppleHealthModule.swift'), 'utf8');

  it('le exatamente os campos do spec do tradutor Apple', () => {
    for (const key of ['specVersion', 'activity', 'location', 'warmup', 'cooldown', 'blocks', 'iterations', 'steps', 'purpose', 'goal', 'type', 'meters']) {
      expect(builder).toMatch(new RegExp(`let ${key}: `));
    }
    const spec = specFor([continua(5, 360)]);
    expect(Object.keys(spec)).toEqual(expect.arrayContaining(['specVersion', 'activity', 'location', 'warmup', 'cooldown', 'blocks']));
    expect(spec.specVersion).toBe(1); // o Swift aceita a versao 1
    expect(builder).toContain('supportedSpecVersion = 1');
  });

  it('traducao mecanica: corrida, outdoor, IntervalBlock com iterations, work/recovery, distancia em metros; warmup/cooldown nil', () => {
    expect(builder).toContain('case "work": purpose = .work');
    expect(builder).toContain('case "recovery": purpose = .recovery');
    expect(builder).toContain('WorkoutGoal.distance(step.goal.meters, .meters)');
    expect(builder).toContain('IntervalStep(purpose, goal: goal, alert: nil)');
    expect(builder).toContain('IntervalBlock(steps: steps, iterations: block.iterations)');
    expect(builder).toContain('CustomWorkout(activity: .running, location: .outdoor, displayName: nil, warmup: nil, blocks: blocks, cooldown: nil)');
  });

  it('usa as verificacoes oficiais (suporte da atividade e da meta) e a serializacao do plano antes de aceitar', () => {
    expect(builder).toContain('CustomWorkout.supportsActivity(.running)');
    expect(builder).toContain('CustomWorkout.supportsGoal(goal, activity: .running, location: .outdoor)');
    expect(builder).toContain('plan.dataRepresentation');
  });

  it('nao ha alertas, agendamento, caminhada inventada nem banda derivada no builder', () => {
    expect(builder).not.toMatch(/SpeedRangeAlert|SpeedThresholdAlert|HeartRate|Cadence|WorkoutAlert|\.speed\(|schedule\(|WorkoutScheduler|walking|caminhada|tolerance|derived/i);
  });

  it('erros nativos tem codigos distintos e identificaveis', () => {
    for (const code of [
      'E_SPEC_INVALID_JSON', 'E_SPEC_UNSUPPORTED_VERSION', 'E_SPEC_UNSUPPORTED_ACTIVITY', 'E_SPEC_UNSUPPORTED_LOCATION', 'E_SPEC_WARMUP_COOLDOWN_NOT_SUPPORTED',
      'E_SPEC_EMPTY_BLOCKS', 'E_SPEC_INVALID_ITERATIONS', 'E_SPEC_EMPTY_STEPS', 'E_SPEC_INVALID_PURPOSE', 'E_SPEC_UNSUPPORTED_GOAL', 'E_SPEC_INVALID_DISTANCE',
      'E_WORKOUTKIT_ACTIVITY_UNSUPPORTED', 'E_WORKOUTKIT_GOAL_UNSUPPORTED', 'E_WORKOUTKIT_DATA_REPRESENTATION_FAILED',
    ]) {
      expect(builder).toContain(`"${code}"`);
    }
  });

  it('o modulo expoe a funcao, sem ligar ao envio: nenhum agendamento novo e o fluxo SingleGoalWorkout atual segue intacto', () => {
    expect(moduleSource).toContain('Function("validateCustomWorkoutSpec")');
    expect(moduleSource).toContain('CustomWorkoutSpecBuilder.validate(specJson: specJson)');
    expect(moduleSource).toContain('SingleGoalWorkout(');
    expect(moduleSource.match(/WorkoutScheduler\.shared\.schedule\(/g)?.length).toBe(1); // so' o agendamento simples ja existente
  });
});
