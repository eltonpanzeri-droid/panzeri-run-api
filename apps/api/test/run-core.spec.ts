import { compileWorkout, completionReached, paceZoneFor, validateWorkout, formatMinuteSecond, parseMinuteSecond, RUN_WORKOUT_SCHEMA, type WorkoutDefinition } from '../../mobile/src/run/workout';
import { parsePaceRange, prescriptionToWorkout, structureToWorkout } from '../../mobile/src/run/prescription';
import { transitionAnnouncement, workoutPhaseLabel } from '../../mobile/src/run/announcements';
import { bestEfforts, gpsQuality, kilometerSplits } from '../../mobile/src/run/analysis';
import { bearingBetween, currentSpeedMps, distanceBetween, elevationGain, formatDuration, formatPace, gpsSignal, interpolatePosition, normalizeTrack, shouldAcceptPoint, splitIntoSegments } from '../../mobile/src/run/track';
import type { TrackPoint } from '../../mobile/src/run/activity';

// 21/11/2026 (Elton): Iniciar treino dentro do Panzeri Run. Nucleo puro copiado do Panz Fit + leitura da prescricao da IA. Nada aqui calcula treino: so' converte, executa e compara.
const point = (latitude: number, longitude: number, timestamp: number, accuracy = 5): TrackPoint => ({ latitude, longitude, timestamp, accuracy, altitude: null, speed: null });

describe('treino executavel a partir da prescricao da IA', () => {
  it('parte continua vira UMA etapa com a faixa de ritmo prescrita', () => {
    const w = prescriptionToWorkout({ id: 's1', title: 'Rodagem', parts: [{ kind: 'continua', distanceKm: 6, paceSecondsPerKmMin: 330, paceSecondsPerKmMax: 360 }] })!;
    const steps = compileWorkout(w);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ phase: 'continuous', completion: { kind: 'distance', meters: 6000 }, targets: [{ metric: 'pace', minSecPerKm: 330, maxSecPerKm: 360 }] });
  });

  it('intervalada: cada repeticao tem estimulo + recuperacao, inclusive a ultima (o total bate com o da prescricao)', () => {
    const w = prescriptionToWorkout({
      id: 's2', title: 'Tiros',
      parts: [{ kind: 'intervalada', repeatCount: 4, stimulusLabel: 'Correr forte', stimulusStepKm: 1, stimulusPaceSecondsPerKmMin: 270, stimulusPaceSecondsPerKmMax: 285, recoveryLabel: 'Trotar', recoveryStepKm: 0.4, recoveryPaceSecondsPerKmMin: 400, recoveryPaceSecondsPerKmMax: 440 }],
    })!;
    const steps = compileWorkout(w);
    expect(steps).toHaveLength(8);
    expect(steps.map((s) => s.phase)).toEqual(['work', 'recovery-active', 'work', 'recovery-active', 'work', 'recovery-active', 'work', 'recovery-active']);
    const totalM = steps.reduce((sum, s) => sum + (s.completion.kind === 'distance' ? s.completion.meters : 0), 0);
    expect(totalM).toBe((1 + 0.4) * 4 * 1000); // mesma soma que a prescricao usa: (estimulo + recuperacao) x repeticoes
    expect(steps[0].repeat).toEqual({ repeatId: 'p1', iteration: 1, count: 4 });
    expect(steps[0].name).toBe('Correr forte');
  });

  it('treino misto: aquecimento continuo, bloco intervalado e volta a calma, na ordem da prescricao', () => {
    const w = prescriptionToWorkout({
      id: 's3', title: 'Misto',
      parts: [
        { kind: 'continua', distanceKm: 2, paceSecondsPerKmMin: 400, paceSecondsPerKmMax: 430 },
        { kind: 'intervalada', repeatCount: 3, stimulusLabel: 'Forte', stimulusStepKm: 0.5, stimulusPaceSecondsPerKmMin: 260, stimulusPaceSecondsPerKmMax: 280, recoveryLabel: 'Leve', recoveryStepKm: 0.3, recoveryPaceSecondsPerKmMin: 420, recoveryPaceSecondsPerKmMax: 450 },
        { kind: 'continua', distanceKm: 1, paceSecondsPerKmMin: 420, paceSecondsPerKmMax: 450 },
      ],
    })!;
    expect(compileWorkout(w).map((s) => s.phase)).toEqual(['continuous', 'work', 'recovery-active', 'work', 'recovery-active', 'work', 'recovery-active', 'continuous']);
  });

  it('faixa ausente, invertida ou com limites invalidos = etapa SEM meta de ritmo (nunca inventa faixa)', () => {
    const w = prescriptionToWorkout({
      id: 's4', title: 'Sem faixa',
      parts: [{ kind: 'intervalada', repeatCount: 2, stimulusLabel: 'Forte', stimulusStepKm: 1, recoveryLabel: 'Leve', recoveryStepKm: 0.2, recoveryPaceSecondsPerKmMin: 500, recoveryPaceSecondsPerKmMax: 400 }],
    })!;
    for (const step of compileWorkout(w)) expect(step.targets).toEqual([]);
  });

  it('prescricao que o executor nao suporta nao vira treino guiado (null), sem "consertar" nada', () => {
    expect(prescriptionToWorkout({ id: 'x', title: 'x', parts: [] })).toBeNull();
    expect(prescriptionToWorkout({ id: 'x', title: 'x', parts: undefined })).toBeNull();
    expect(prescriptionToWorkout({ id: 'x', title: 'x', parts: [{ kind: 'caminhada' }] })).toBeNull();
    expect(prescriptionToWorkout({ id: 'x', title: 'x', parts: [{ kind: 'continua', distanceKm: 0, paceSecondsPerKmMin: 300, paceSecondsPerKmMax: 330 }] })).toBeNull();
    expect(prescriptionToWorkout({ id: 'x', title: 'x', parts: [{ kind: 'continua', paceSecondsPerKmMin: 300, paceSecondsPerKmMax: 330 }] })).toBeNull();
    expect(prescriptionToWorkout({ id: 'x', title: 'x', parts: [{ kind: 'intervalada', repeatCount: 0, stimulusStepKm: 1, recoveryStepKm: 0.2, stimulusLabel: 'a', recoveryLabel: 'b' }] })).toBeNull();
    expect(prescriptionToWorkout({ id: 'x', title: 'x', parts: [null] })).toBeNull();
  });
});

describe('execucao das etapas', () => {
  const base = (): WorkoutDefinition => ({ schema: RUN_WORKOUT_SCHEMA, schemaVersion: 1, id: 'w', revision: 1, title: 't', nodes: [{ kind: 'step', id: 'a', name: 'A', phase: 'continuous', completion: { kind: 'distance', meters: 1000 }, targets: [] }] });

  it('etapa termina por distancia ou por duracao, e "manual" nunca termina sozinha', () => {
    const [byDistance] = compileWorkout(base());
    expect(completionReached(byDistance, { distanceM: 999, elapsedMs: 0 })).toBe(false);
    expect(completionReached(byDistance, { distanceM: 1000, elapsedMs: 0 })).toBe(true);
    const timed = compileWorkout({ ...base(), nodes: [{ kind: 'step', id: 'a', name: 'A', phase: 'work', completion: { kind: 'duration', seconds: 30 }, targets: [] }] })[0];
    expect(completionReached(timed, { distanceM: 0, elapsedMs: 29_999 })).toBe(false);
    expect(completionReached(timed, { distanceM: 0, elapsedMs: 30_000 })).toBe(true);
    const manual = compileWorkout({ ...base(), nodes: [{ kind: 'step', id: 'a', name: 'Livre', phase: 'continuous', completion: { kind: 'manual' }, targets: [] }] })[0];
    expect(completionReached(manual, { distanceM: 99_999, elapsedMs: 99_999_999 })).toBe(false);
  });

  it('valida: recuperacao passiva por distancia, faixa invertida e numero de series', () => {
    const w = base();
    w.nodes = [{ kind: 'repeat', id: 'r', name: 'R', count: 0, work: { kind: 'step', id: 'w', name: 'w', phase: 'work', completion: { kind: 'distance', meters: 100 }, targets: [{ metric: 'pace', minSecPerKm: 400, maxSecPerKm: 300 }] }, recovery: { kind: 'step', id: 'c', name: 'c', phase: 'recovery-passive', completion: { kind: 'distance', meters: 100 }, targets: [] } }];
    expect(validateWorkout(w).length).toBeGreaterThanOrEqual(3);
    expect(() => compileWorkout(w)).toThrow();
  });

  it('zona de ritmo so compara o medido com a faixa prescrita', () => {
    const step = compileWorkout(prescriptionToWorkout({ id: 'z', title: 'z', parts: [{ kind: 'continua', distanceKm: 5, paceSecondsPerKmMin: 330, paceSecondsPerKmMax: 360 }] })!)[0];
    expect(paceZoneFor(step, 345)).toBe('in-zone');
    expect(paceZoneFor(step, 330)).toBe('in-zone');
    expect(paceZoneFor(step, 360)).toBe('in-zone');
    expect(paceZoneFor(step, 300)).toBe('too-fast');
    expect(paceZoneFor(step, 400)).toBe('too-slow');
    expect(paceZoneFor(step, null)).toBe('unavailable');
    expect(paceZoneFor(step, 0)).toBe('unavailable');
    expect(paceZoneFor({ targets: [] }, 345)).toBe('unavailable'); // etapa sem meta: nenhum aviso de ritmo
    expect(paceZoneFor(null, 345)).toBe('unavailable');
  });

  it('formata e le minuto:segundo', () => {
    expect(formatMinuteSecond(330)).toBe('05:30');
    expect(parseMinuteSecond('5:30')).toBe(330);
    expect(parseMinuteSecond('5:75')).toBeNull();
    expect(parseMinuteSecond('abc')).toBeNull();
  });

  it('avisos falados de transicao e rotulos', () => {
    const steps = compileWorkout(prescriptionToWorkout({ id: 'a', title: 'a', parts: [{ kind: 'intervalada', repeatCount: 2, stimulusLabel: 'Forte', stimulusStepKm: 1, recoveryLabel: 'Leve', recoveryStepKm: 0.2 }] })!);
    expect(transitionAnnouncement(steps[0], true)).toBe('Iniciar série 1 de 2.');
    expect(transitionAnnouncement(steps[1], true)).toBe('Iniciar pausa ativa, 200 metros.');
    expect(transitionAnnouncement(null, false)).toBe('Treino estruturado concluído.');
    expect(workoutPhaseLabel(steps[0])).toBe('SÉRIE');
  });
});

describe('metricas de GPS (copiadas do Panz Fit)', () => {
  it('distancia plausivel, recusa ponto impreciso e salto impossivel', () => {
    const d = distanceBetween(point(-19.93, -44.05, 0), point(-19.921, -44.05, 1_000));
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1_015);
    expect(shouldAcceptPoint(undefined, point(-19.93, -44.05, 0, 80))).toBe(false);
    expect(shouldAcceptPoint(point(-19.93, -44.05, 0), point(-19.92, -44.05, 1_000))).toBe(false);
  });

  it('formata duracao e ritmo; ritmo de distancia curta e vazio', () => {
    expect(formatDuration(3_661_000)).toBe('01:01:01');
    expect(formatPace(5_000, 1_500_000)).toBe('5:00');
    expect(formatPace(0, 1_000)).toBe('--:--');
  });

  it('normaliza o percurso, descarta ruido e soma distancia', () => {
    const track = normalizeTrack([point(-19.93, -44.05, 0), point(-19.93, -44.05, 500, 90), point(-19.9291, -44.05, 20_000), point(-19.9282, -44.05, 40_000)]);
    expect(track.points).toHaveLength(3);
    expect(track.distanceM).toBeGreaterThan(190);
  });

  it('sinal do GPS, velocidade atual e direcao', () => {
    expect(gpsSignal(7, 1_000, 2_000).level).toBe('excellent');
    expect(gpsSignal(null, undefined, 2_000).level).toBe('waiting');
    expect(currentSpeedMps([], 0)).toBe(0);
    expect(bearingBetween({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(0, 3);
  });

  it('altimetria ignora saltos e leituras imprecisas', () => {
    const p = (altitude: number | null, accuracy: number) => ({ ...point(0, 0, 0, accuracy), altitude });
    expect(elevationGain([p(100, 5), p(103, 5), p(104, 5), p(200, 5), p(90, 40)])).toBe(3); // +3 conta; +1 e' abaixo de 1,5 m; +96 e' salto; leitura com 40 m de erro e' ignorada
  });

  it('lacunas de sinal cortam o trecho e a interpolacao nao inventa deslocamento dentro delas', () => {
    const pts = [point(-19.93, -44.05, 0), point(-19.9295, -44.05, 5_000), point(-19.9, -44.05, 60_000)];
    expect(splitIntoSegments(pts)).toHaveLength(2);
    expect(interpolatePosition(pts, 30_000)).toEqual({ latitude: -19.9295, longitude: -44.05 });
    expect(interpolatePosition([], 1_000)).toBeNull();
  });
});

describe('parciais e melhores trechos', () => {
  // 6,2 km a 5:00/km em linha reta (1 ponto a cada 10 s ~ 33 m)
  const run: TrackPoint[] = Array.from({ length: 1_121 }, (_, i) => point(-19.93 + (i * 10 * (1 / 300)) / 111.32, -44.05, i * 10_000));
  it('parciais por km com ritmo e marca de parcial final incompleta', () => {
    const splits = kilometerSplits(run);
    expect(splits.length).toBeGreaterThanOrEqual(6);
    expect(Math.round(splits[0].paceSecPerKm)).toBeGreaterThanOrEqual(298);
    expect(Math.round(splits[0].paceSecPerKm)).toBeLessThanOrEqual(302);
    expect(splits[0].reliable).toBe(true);
  });
  it('melhores trechos so existem quando a distancia foi percorrida', () => {
    const efforts = bestEfforts(run.slice(0, 40));
    expect(efforts.map((e) => e.label)).toEqual(['400 m', '1 km']);
  });
  it('qualidade do GPS conta lacunas', () => {
    const quality = gpsQuality([point(0, 0, 0), point(0, 0, 60_000), point(0, 0, 61_000)]);
    expect(quality.gaps).toBe(1);
    expect(quality.score).toBeLessThan(100);
  });
});

// O treino da semana chega ao Panzeri Run como `session.structure` (blocos com distancia em km e faixa "m:ss a m:ss"), montado pelo servidor (training-plans.service: runDistanceBlock / intervalStep).
describe('treino da semana (session.structure) -> etapas', () => {
  const continuous = (over: Record<string, unknown> = {}) => ({ label: 'Principal', durationType: 'distance', distanceValue: 6, distanceUnit: 'km', paceRange: '5:30 a 6:00', ...over });
  const interval = (over: Record<string, unknown> = {}) => ({
    label: 'Serie intervalada', repeatCount: 4,
    steps: [
      { label: 'Correr forte', durationType: 'distance', distanceValue: 1, distanceUnit: 'km', paceRange: '4:30 a 4:45' },
      { label: 'Trotar', durationType: 'distance', distanceValue: 0.4, distanceUnit: 'km', paceRange: '6:40 a 7:30' },
    ], ...over,
  });
  const run = (blocks: unknown[], type = 'run') => ({ type, blocks }) as never;

  it('le a faixa de ritmo escrita pelo servidor e recusa qualquer outro formato', () => {
    expect(parsePaceRange('5:30 a 6:00')).toEqual({ minSecPerKm: 330, maxSecPerKm: 360 });
    expect(parsePaceRange('5:05 a 5:05/km')).toEqual({ minSecPerKm: 305, maxSecPerKm: 305 });
    expect(parsePaceRange('6:00 a 5:30')).toBeNull(); // invertida
    expect(parsePaceRange('livre')).toBeNull();
    expect(parsePaceRange(null)).toBeNull();
    expect(parsePaceRange('5:75 a 6:00')).toBeNull();
  });

  it('bloco continuo vira uma etapa; intervalado vira estimulo + recuperacao x repeticoes, com o total da prescricao', () => {
    const w = structureToWorkout({ id: 's1', title: 'Misto', structure: run([continuous({ distanceValue: 2 }), interval()]) })!;
    const steps = compileWorkout(w);
    expect(steps.map((s) => s.phase)).toEqual(['continuous', 'work', 'recovery-active', 'work', 'recovery-active', 'work', 'recovery-active', 'work', 'recovery-active']);
    expect(steps[0]).toMatchObject({ completion: { kind: 'distance', meters: 2000 }, targets: [{ metric: 'pace', minSecPerKm: 330, maxSecPerKm: 360 }] });
    expect(steps[1]).toMatchObject({ name: 'Correr forte', targets: [{ metric: 'pace', minSecPerKm: 270, maxSecPerKm: 285 }] });
    const total = steps.reduce((sum, s) => sum + (s.completion.kind === 'distance' ? s.completion.meters : 0), 0);
    expect(total).toBe(2000 + 4 * (1000 + 400)); // blockDistance do servidor: repeticoes x (estimulo + recuperacao)
  });

  it('distancia em metros ou texto com virgula; faixa ausente = etapa sem meta', () => {
    const w = structureToWorkout({ id: 's', title: 't', structure: run([continuous({ distanceValue: '1,5', paceRange: null }), continuous({ distanceValue: 800, distanceUnit: 'm' })]) })!;
    const steps = compileWorkout(w);
    expect(steps[0]).toMatchObject({ completion: { meters: 1500 }, targets: [] });
    expect(steps[1].completion).toEqual({ kind: 'distance', meters: 800 });
  });

  it('formato que o executor nao entende = treino nao guiado (null), nunca adivinhado', () => {
    expect(structureToWorkout({ id: 's', title: 't', structure: null })).toBeNull();
    expect(structureToWorkout({ id: 's', title: 't', structure: run([], 'run') })).toBeNull();
    expect(structureToWorkout({ id: 's', title: 't', structure: run([continuous()], 'aerobic') })).toBeNull();
    expect(structureToWorkout({ id: 's', title: 't', structure: run([continuous({ durationType: 'time' })]) })).toBeNull();
    expect(structureToWorkout({ id: 's', title: 't', structure: run([continuous({ distanceUnit: 'mi' })]) })).toBeNull();
    expect(structureToWorkout({ id: 's', title: 't', structure: run([continuous({ distanceValue: 0 })]) })).toBeNull();
    expect(structureToWorkout({ id: 's', title: 't', structure: run([interval({ steps: [{ distanceValue: 1, distanceUnit: 'km' }] })]) })).toBeNull();
    expect(structureToWorkout({ id: 's', title: 't', structure: run([null]) })).toBeNull();
  });
});
