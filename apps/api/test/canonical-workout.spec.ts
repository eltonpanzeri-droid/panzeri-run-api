import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { buildCanonicalWorkout, CanonicalRepeat, CanonicalStep } from '../src/training-plans/canonical-workout';

// CanonicalWorkout: TrainingSession.structure (REAL, gerada por TrainingPlansService.runPrescription, ou editada no Admin) -> representacao
// canonica independente de provider. Esta camada so' traduz o que ja' foi decidido; nao decide treino, nao altera a TrainingSession.
const noop = {} as never;
const service = new TrainingPlansService(noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop) as unknown as {
  runPrescription: (durationMin: number, modality: string, decision: { parts: unknown[] }) => Record<string, unknown>;
};
const generate = (parts: unknown[]) => service.runPrescription(50, 'corrida', { parts });
const continua = (distanceKm: number, min: number, max = min) => ({ kind: 'continua', distanceKm, paceSecondsPerKmMin: min, paceSecondsPerKmMax: max });
const intervalada = (repeatCount: number, stimulus: [string, number, number], recovery: [string, number, number]) => ({
  kind: 'intervalada', repeatCount,
  stimulusLabel: stimulus[0], stimulusStepKm: stimulus[1], stimulusPaceSecondsPerKm: stimulus[2],
  recoveryLabel: recovery[0], recoveryStepKm: recovery[1], recoveryPaceSecondsPerKm: recovery[2],
});
const convert = (structure: unknown, id = 's1') => buildCanonicalWorkout({ id, modality: 'corrida', structure });
const step = (item: unknown) => item as CanonicalStep;
const repeat = (item: unknown) => item as CanonicalRepeat;

describe('CanonicalWorkout — sessoes reais geradas pelo Panzeri Run', () => {
  it('corrida continua unica: um passo principal em metros, pace prescrito como valor unico', () => {
    const workout = convert(generate([continua(5, 360)]));
    expect(workout).toMatchObject({ schema: 'panzeri.canonical-workout', schemaVersion: 1, trainingSessionId: 's1', modality: 'corrida', complete: true });
    expect(workout.items).toHaveLength(1);
    expect(step(workout.items[0])).toMatchObject({
      kind: 'step', role: 'main', roleBasis: 'single_part', activity: 'unknown', activityBasis: 'not_specified',
      goal: { type: 'distance', meters: 5000 },
      pace: { prescribed: { fastSecPerKm: 360, slowSecPerKm: 360 }, derivedToleranceBand: null },
    });
    expect(workout.derived).toEqual({ totalDistanceMeters: 5000, totalPrescribedSeconds: 0, stepCount: 1 });
  });

  it('varias partes continuas: ordem e distancia de cada parte preservadas (distancia fracionada em km vira metros exatos)', () => {
    const workout = convert(generate([continua(2, 345), continua(6.35, 330, 345), continua(1, 420)]));
    expect(workout.items.map((item) => (step(item).goal as { meters: number }).meters)).toEqual([2000, 6350, 1000]);
    expect(workout.items.map((item) => step(item).label)).toEqual(['Parte 1', 'Parte 2', 'Parte 3']);
    // faixa prescrita (min != max) fica como faixa; valor unico fica como valor unico
    expect(step(workout.items[1]).pace?.prescribed).toEqual({ fastSecPerKm: 330, slowSecPerKm: 345 });
    expect(step(workout.items[0]).pace?.prescribed).toEqual({ fastSecPerKm: 345, slowSecPerKm: 345 });
    expect(workout.derived.totalDistanceMeters).toBe(9350);
  });

  it('intervalado N x estimulo + recuperacao: repeatCount, ordem e distancias preservados; banda de +-20 s e DERIVADA, o prescrito e o valor unico', () => {
    const workout = convert(generate([intervalada(6, ['Correr forte', 0.4, 240], ['Trotar', 0.2, 420])]));
    expect(workout.items).toHaveLength(1);
    const block = repeat(workout.items[0]);
    expect(block).toMatchObject({ kind: 'repeat', repeatCount: 6 });
    expect(block.steps.map((s) => [s.role, s.roleBasis, s.label])).toEqual([
      ['work', 'position_in_interval', 'Correr forte'],
      ['recovery', 'position_in_interval', 'Trotar'],
    ]);
    expect(block.steps.map((s) => (s.goal as { meters: number }).meters)).toEqual([400, 200]);
    expect(block.steps[0].pace).toEqual({
      prescribed: { fastSecPerKm: 240, slowSecPerKm: 240 }, // o que foi decidido
      derivedToleranceBand: { fastSecPerKm: 220, slowSecPerKm: 260, toleranceSec: 20 }, // o que o sistema derivou
    });
    expect(block.steps[1].pace?.prescribed).toEqual({ fastSecPerKm: 420, slowSecPerKm: 420 });
    expect(workout.warnings.filter((w) => w.code === 'derived_tolerance_band')).toHaveLength(2);
    expect(workout.derived).toMatchObject({ totalDistanceMeters: 6 * 600, stepCount: 12 });
  });

  it('treino misto continuo + intervalado + continuo: ordem preservada e totais derivados corretos', () => {
    const workout = convert(generate([continua(2, 360), intervalada(5, ['Forte', 1, 300], ['Leve', 0.4, 420]), continua(2, 380, 400)]));
    expect(workout.items.map((item) => item.kind)).toEqual(['step', 'repeat', 'step']);
    expect(repeat(workout.items[1]).repeatCount).toBe(5);
    expect(step(workout.items[0]).goal).toEqual({ type: 'distance', meters: 2000 });
    expect(step(workout.items[2]).goal).toEqual({ type: 'distance', meters: 2000 });
    expect(workout.derived.totalDistanceMeters).toBe(2000 + 5 * 1400 + 2000);
    expect(workout.complete).toBe(true);
  });

  it('a duracao DERIVADA (durationRange / durationMin de passo por distancia) nao vira meta de tempo e a sessao nao e alterada', () => {
    const structure = generate([continua(5, 360)]);
    const snapshot = JSON.stringify(structure);
    const workout = convert(structure);
    expect(workout.items.every((item) => step(item).goal.type === 'distance')).toBe(true);
    expect(workout.derived.totalPrescribedSeconds).toBe(0);
    expect(workout.warnings.map((w) => w.code)).toContain('duration_range_ignored_derived');
    expect(JSON.stringify(structure)).toBe(snapshot); // entrada intacta
  });
});

describe('CanonicalWorkout — estruturas editadas no Admin', () => {
  it('distancia em metros (texto) e passo por tempo ja existente; unidade canonica = metros / segundos', () => {
    const workout = convert({
      type: 'run',
      blocks: [
        { blockKind: 'continuous', label: 'Aquecimento', durationType: 'time', durationMin: 10, intensityMode: 'pace', paceRange: '7:00/km a 7:00/km', activityType: 'caminhada' },
        { blockKind: 'repeat', label: 'Tiros', repeatCount: 4, steps: [
          { label: 'Tiro', durationType: 'distance', distanceValue: '400', distanceUnit: 'm', intensityMode: 'pace', activityType: 'corrida', paceRange: '4:00/km a 4:10/km' },
          { pausaType: 'ativa', label: 'Recuperacao', durationType: 'distance', distanceValue: '200', distanceUnit: 'm', activityType: 'caminhada' },
        ] },
        { blockKind: 'continuous', label: 'Soltar', durationType: 'distance', distanceValue: 1.5, distanceUnit: 'km' },
      ],
    });
    expect(workout.complete).toBe(true);
    expect(step(workout.items[0]).goal).toEqual({ type: 'time', seconds: 600 });
    const tiros = repeat(workout.items[1]);
    expect(tiros.repeatCount).toBe(4);
    expect(tiros.steps.map((s) => (s.goal as { meters: number }).meters)).toEqual([400, 200]);
    expect(step(workout.items[2]).goal).toEqual({ type: 'distance', meters: 1500 });
    expect(workout.derived).toEqual({ totalDistanceMeters: 1500 + 4 * 600, totalPrescribedSeconds: 600, stepCount: 1 + 8 + 1 });
  });

  it('corrida/caminhada com activityType EXPLICITO sao respeitadas; pausa ativa x passiva distinguidas; pausa passiva nao tem pace', () => {
    const workout = convert({
      type: 'run',
      blocks: [{ blockKind: 'repeat', repeatCount: 3, steps: [
        { label: 'Correr', durationType: 'distance', distanceValue: 500, distanceUnit: 'm', activityType: 'corrida', paceRange: '5:00/km a 5:00/km' },
        { pausaType: 'passiva', label: 'Parado', durationType: 'time', durationMin: 1, observacao: 'respirar', paceRange: '9:00/km a 9:00/km' },
      ] }],
    });
    const [work, rest] = repeat(workout.items[0]).steps;
    expect(work).toMatchObject({ role: 'work', activity: 'run', activityBasis: 'explicit_activity_type' });
    expect(rest).toMatchObject({ role: 'recovery', roleBasis: 'explicit_pause_type', recoveryKind: 'passive', goal: { type: 'time', seconds: 60 }, pace: null, notes: 'respirar' });
    const active = convert({ type: 'run', blocks: [{ repeatCount: 2, steps: [
      { label: 'Forte', durationType: 'distance', distanceValue: 300, distanceUnit: 'm' },
      { pausaType: 'ativa', label: 'Andar', durationType: 'distance', distanceValue: 100, distanceUnit: 'm', activityType: 'caminhada' },
    ] }] });
    expect(repeat(active.items[0]).steps[1]).toMatchObject({ role: 'recovery', recoveryKind: 'active', activity: 'walk' });
  });

  it('texto livre NAO e promovido a activityType: "Caminhar" sem activityType fica unknown, com aviso', () => {
    const workout = convert(generate([intervalada(4, ['Correr', 0.5, 330], ['Caminhar', 0.2, 600])]));
    const [run, walk] = repeat(workout.items[0]).steps;
    expect(run.activity).toBe('unknown');
    expect(walk).toMatchObject({ activity: 'unknown', activityBasis: 'not_specified', label: 'Caminhar' });
    expect(workout.warnings.map((w) => w.code)).toContain('label_suggests_walking_not_promoted');
    // um pace muito lento tambem NAO vira "caminhada": so' activityType explicito promove
    expect(walk.pace?.prescribed.slowSecPerKm).toBe(600);
  });

  it('banda editada pelo treinador NAO e confundida com a tolerancia derivada: faixa de 40 s sem a marca do gerador continua sendo faixa prescrita', () => {
    const workout = convert({ type: 'run', blocks: [{ repeatCount: 3, steps: [
      { label: 'Forte', durationType: 'distance', distanceValue: 400, distanceUnit: 'm', paceRange: '4:00/km a 4:40/km' },
      { pausaType: 'ativa', label: 'Leve', durationType: 'distance', distanceValue: 200, distanceUnit: 'm', paceRange: '6:00/km a 6:00/km' },
    ] }] });
    expect(repeat(workout.items[0]).steps[0].pace).toEqual({ prescribed: { fastSecPerKm: 240, slowSecPerKm: 280 }, derivedToleranceBand: null });
    expect(workout.warnings.map((w) => w.code)).not.toContain('derived_tolerance_band');
  });

  it('zona e RPE ficam preservados como intensidade prescrita (sem virar pace)', () => {
    const workout = convert({ type: 'run', blocks: [{ label: 'Principal', durationType: 'time', durationMin: 30, intensityMode: 'rpe', rpe: 'moderado', zone: 'Z2' }] });
    expect(step(workout.items[0])).toMatchObject({ goal: { type: 'time', seconds: 1800 }, pace: null, intensity: { mode: 'rpe', rpe: 'moderado', zone: 'Z2' } });
  });
});

describe('CanonicalWorkout — perdas e avisos explicitos (nada silencioso)', () => {
  it('estrutura que nao e corrida estruturada: perda declarada, sem itens, nao completa', () => {
    const workout = convert({ type: 'strength', exercises: [] });
    expect(workout).toMatchObject({ complete: false, items: [] });
    expect(workout.losses.map((l) => l.code)).toContain('structure_not_run');
  });

  it('meta invalida (distancia ausente, repeatCount invalido) vira perda e a sessao nao e "completa"', () => {
    const noDistance = convert({ type: 'run', blocks: [{ label: 'x', durationType: 'distance' }] });
    expect(noDistance.complete).toBe(false);
    expect(noDistance.losses.map((l) => l.code)).toContain('goal_distance_invalid');
    const badRepeat = convert({ type: 'run', blocks: [{ repeatCount: 0, steps: [{ distanceValue: 1, distanceUnit: 'km' }] }] });
    expect(badRepeat.losses.map((l) => l.code)).toContain('repeat_count_invalid');
  });

  it('sessao legada sem blocks: passo principal implicito pela distancia da sessao, com aviso', () => {
    const workout = convert({ type: 'run', distanceKm: 8, paceRange: '6:00/km a 6:00/km' });
    expect(workout.complete).toBe(true);
    expect(step(workout.items[0])).toMatchObject({ goal: { type: 'distance', meters: 8000 }, pace: { prescribed: { fastSecPerKm: 360, slowSecPerKm: 360 } } });
    expect(workout.warnings.map((w) => w.code)).toContain('implicit_single_block');
  });

  it('entrada nula/ilegivel nunca lanca erro: devolve perda', () => {
    expect(buildCanonicalWorkout({ id: null, modality: null, structure: null })).toMatchObject({ complete: false, items: [], modality: null });
    expect(buildCanonicalWorkout({ id: 'x', modality: 'RUNNING', structure: { type: 'run', blocks: [null] } }).losses.map((l) => l.code)).toContain('block_unreadable');
    expect(buildCanonicalWorkout({ id: 'x', modality: 'RUNNING', structure: { type: 'run', blocks: [] } }).modality).toBe('corrida'); // modalidade canonica
  });

  it('a conversao e deterministica (mesma entrada, mesma saida)', () => {
    const structure = generate([continua(2, 360), intervalada(3, ['Forte', 0.5, 300], ['Leve', 0.3, 420])]);
    expect(JSON.stringify(convert(structure))).toBe(JSON.stringify(convert(structure)));
  });
});
