import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { buildCanonicalWorkout } from '../src/training-plans/canonical-workout';
import { translateToAppleCustomWorkout, AppleCustomWorkoutSpec } from '../src/workout-delivery/apple-custom-workout-spec';

// CanonicalWorkout -> AppleCustomWorkoutSpec (intermediaria, sem agendar nada). Preserva ordem, distancia, repeatCount e papel work/recovery;
// nao envia pace; nao usa a banda derivada; recusa com motivo o que exigiria inventar informacao.
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
// TrainingSession real (gerada) -> CanonicalWorkout -> tradutor Apple
const fromGenerated = (parts: unknown[], modality = 'corrida') => {
  const structure = service.runPrescription(50, modality, { parts });
  const canonical = buildCanonicalWorkout({ id: 'sessao-1', modality, structure });
  return { structure, canonical, result: translateToAppleCustomWorkout(canonical) };
};
const fromStructure = (structure: unknown, modality = 'corrida') => translateToAppleCustomWorkout(buildCanonicalWorkout({ id: 'sessao-1', modality, structure }));
const okSpec = (result: ReturnType<typeof translateToAppleCustomWorkout>): AppleCustomWorkoutSpec => {
  if (!result.ok) throw new Error(`recusado: ${JSON.stringify(result.refusals)}`);
  return result.spec;
};
const work = (meters: number) => ({ purpose: 'work', goal: { type: 'distance', meters } });
const recovery = (meters: number) => ({ purpose: 'recovery', goal: { type: 'distance', meters } });

describe('Tradutor Apple — os tres casos reais (TrainingSession -> CanonicalWorkout -> AppleCustomWorkoutSpec)', () => {
  it('1. continuo: um bloco de uma iteracao com um passo work por distancia', () => {
    const spec = okSpec(fromGenerated([continua(8, 345, 360)]).result);
    expect(spec).toMatchObject({ specVersion: 1, translatorVersion: 1, activity: 'running', location: 'outdoor', warmup: null, cooldown: null });
    expect(spec.blocks).toEqual([{ iterations: 1, steps: [work(8000)] }]);
    expect(spec.source).toEqual({ canonicalSchemaVersion: 1, trainingSessionId: 'sessao-1' });
  });

  it('2. intervalado 6 x (400 m forte + 200 m recuperacao): repeatCount, ordem e papeis preservados', () => {
    const spec = okSpec(fromGenerated([intervalada(6, ['Correr forte', 0.4, 240], ['Trotar', 0.2, 420])]).result);
    expect(spec.blocks).toEqual([{ iterations: 6, steps: [work(400), recovery(200)] }]);
  });

  it('3. misto continuo + 5 x (1 km + 400 m) + continuo: ordem e repeticao preservadas', () => {
    const { result, canonical } = fromGenerated([continua(2, 360), intervalada(5, ['Forte', 1, 300], ['Caminhar', 0.4, 600]), continua(2, 380, 400)]);
    const spec = okSpec(result);
    expect(spec.blocks).toEqual([
      { iterations: 1, steps: [work(2000)] },
      { iterations: 5, steps: [work(1000), recovery(400)] },
      { iterations: 1, steps: [work(2000)] },
    ]);
    // a distancia total do que sera enviado bate com a do CanonicalWorkout
    const sent = spec.blocks.reduce((sum, b) => sum + b.iterations * b.steps.reduce((s, st) => s + st.goal.meters, 0), 0);
    expect(sent).toBe(canonical.derived.totalDistanceMeters);
  });
});

describe('Tradutor Apple — o que NAO deve ser enviado', () => {
  it('nenhum alerta/pace/velocidade no spec; a banda derivada de +-20 s nunca e usada (nem como numero)', () => {
    const { result } = fromGenerated([intervalada(4, ['Forte', 0.5, 300], ['Leve', 0.3, 420])]);
    const json = JSON.stringify(okSpec(result));
    expect(json).not.toMatch(/pace|alert|speed|velocidade|tolerance|band/i);
    for (const derived of ['280', '320', '400', '440']) expect(json).not.toContain(`"${derived}"`);
    if (result.ok) {
      expect(result.losses.filter((l) => l.code === 'pace_not_sent').length).toBe(2);
      expect(result.canonicalWarningCodes).toContain('derived_tolerance_band');
    }
  });

  it('atividade unknown nao impede a traducao de uma corrida', () => {
    const { canonical, result } = fromGenerated([continua(5, 360)]);
    expect(canonical.items[0]).toMatchObject({ activity: 'unknown' });
    expect(result.ok).toBe(true);
  });

  it('caminhada EXPLICITA: traduzida como passo de corrida, com a perda semantica registrada', () => {
    const result = fromStructure({ type: 'run', blocks: [{ repeatCount: 3, steps: [
      { label: 'Correr', durationType: 'distance', distanceValue: 400, distanceUnit: 'm', activityType: 'corrida' },
      { pausaType: 'ativa', label: 'Andar', durationType: 'distance', distanceValue: 200, distanceUnit: 'm', activityType: 'caminhada' },
    ] }] });
    expect(okSpec(result).blocks).toEqual([{ iterations: 3, steps: [work(400), recovery(200)] }]);
    if (result.ok) expect(result.losses.map((l) => l.code)).toContain('walk_explicit_sent_as_running');
  });

  it('caminhada SUGERIDA por texto livre: a perda fica registrada e o texto nao e promovido', () => {
    const { result, canonical } = fromGenerated([intervalada(4, ['Correr', 0.5, 330], ['Caminhar', 0.2, 600])]);
    expect(JSON.stringify(canonical.items)).not.toContain('"activity":"walk"');
    if (!result.ok) throw new Error('deveria traduzir');
    expect(result.losses.map((l) => l.code)).toContain('walk_suggested_by_label');
    expect(result.losses.map((l) => l.code)).not.toContain('walk_explicit_sent_as_running');
  });

  it('zona/RPE e rotulos/orientacoes: omissao registrada, nada enviado', () => {
    const result = fromStructure({ type: 'run', blocks: [{ label: 'Principal', guidance: 'solto', durationType: 'distance', distanceValue: 5, distanceUnit: 'km', intensityMode: 'rpe', rpe: 'moderado' }] });
    if (!result.ok) throw new Error('deveria traduzir');
    expect(result.losses.map((l) => l.code).sort()).toEqual(['intensity_not_sent', 'label_and_notes_not_sent']);
    expect(JSON.stringify(result.spec)).not.toMatch(/moderado|solto|Principal/);
  });
});

describe('Tradutor Apple — recusas explicitas (nunca inventar informacao)', () => {
  const refusalCodes = (structure: unknown, modality = 'corrida') => {
    const result = fromStructure(structure, modality);
    return result.ok ? [] : result.refusals.map((r) => r.code);
  };

  it('passo por tempo, pausa passiva e meta aberta sao recusados com motivo', () => {
    expect(refusalCodes({ type: 'run', blocks: [{ durationType: 'time', durationMin: 30 }] })).toContain('goal_time_not_supported_yet');
    expect(refusalCodes({ type: 'run', blocks: [{ repeatCount: 3, steps: [
      { durationType: 'distance', distanceValue: 400, distanceUnit: 'm' },
      { pausaType: 'passiva', durationType: 'time', durationMin: 1 },
    ] }] })).toContain('goal_time_not_supported_yet');
    expect(refusalCodes({ type: 'run', blocks: [{ durationType: 'distance' }] })).toContain('canonical_goal_distance_invalid');
  });

  it('pausa passiva por distancia tambem e recusada (nao existe "parado" por distancia)', () => {
    expect(refusalCodes({ type: 'run', blocks: [{ repeatCount: 2, steps: [
      { durationType: 'distance', distanceValue: 400, distanceUnit: 'm' },
      { pausaType: 'passiva', durationType: 'distance', distanceValue: 50, distanceUnit: 'm' },
    ] }] })).toContain('passive_recovery_not_supported_yet');
  });

  it('modalidade que nao e corrida ao ar livre: esteira e outras sao recusadas', () => {
    const structure = { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 5, distanceUnit: 'km' }] };
    expect(refusalCodes(structure, 'esteira')).toContain('indoor_not_supported_yet');
    expect(refusalCodes(structure, 'bike')).toContain('modality_not_running');
    expect(refusalCodes({ type: 'strength', exercises: [] }, 'forca')).toEqual(expect.arrayContaining(['modality_not_running', 'canonical_structure_not_run']));
  });

  it('CanonicalWorkout incompleto (perdas) e distancia acima do limite sao recusados', () => {
    expect(refusalCodes({ type: 'run', blocks: [{ repeatCount: 0, steps: [{ distanceValue: 1, distanceUnit: 'km' }] }] })).toContain('canonical_repeat_count_invalid');
    expect(refusalCodes({ type: 'run', blocks: [{ durationType: 'distance', distanceValue: 120, distanceUnit: 'km' }] })).toContain('distance_out_of_range');
  });

  it('uma recusa em qualquer passo recusa o treino inteiro (nao envia parte dele)', () => {
    const result = fromStructure({ type: 'run', blocks: [
      { durationType: 'distance', distanceValue: 2, distanceUnit: 'km' },
      { durationType: 'time', durationMin: 10 },
      { durationType: 'distance', distanceValue: 2, distanceUnit: 'km' },
    ] });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('spec');
  });
});

describe('Tradutor Apple — determinismo e hash', () => {
  it('mesma prescricao -> mesmo spec e mesmo hash; prescricao diferente -> hash diferente; entrada nao e alterada', () => {
    const a = fromGenerated([continua(2, 360), intervalada(3, ['Forte', 0.5, 300], ['Leve', 0.3, 420])]);
    const b = fromGenerated([continua(2, 360), intervalada(3, ['Forte', 0.5, 300], ['Leve', 0.3, 420])]);
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
    const changed = fromGenerated([continua(2, 360), intervalada(4, ['Forte', 0.5, 300], ['Leve', 0.3, 420])]);
    expect(okSpec(changed.result).specHash).not.toBe(okSpec(a.result).specHash);
    const snapshot = JSON.stringify(a.canonical);
    translateToAppleCustomWorkout(a.canonical);
    expect(JSON.stringify(a.canonical)).toBe(snapshot);
  });

  it('o hash cobre so o conteudo enviado: mudar so o pace (nao enviado) nao muda o spec', () => {
    const slow = okSpec(fromGenerated([continua(5, 400)]).result);
    const fast = okSpec(fromGenerated([continua(5, 300)]).result);
    expect(slow.specHash).toBe(fast.specHash);
  });

  it('sinaliza o que so um aparelho confirma (bloco com um unico passo work)', () => {
    const result = fromGenerated([continua(5, 360)]).result;
    if (!result.ok) throw new Error('deveria traduzir');
    expect(result.unverifiedOnDevice).toEqual(['interval_block_with_single_work_step']);
  });
});
