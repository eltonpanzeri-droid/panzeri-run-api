import { applyPoints, clockMs, currentZone, finishRun, pauseRun, resumeAfterInterruption, resumeRun, snapshotOf, startRun, timerMs, type RecordedPoint, type RunState } from '../../mobile/src/run/engine';
import { buildRunUploadBody, RUN_PAYLOAD_LIMITS } from '../../mobile/src/run/payload';
import { RunStorage, RUN_STORAGE, type KeyValueStore } from '../../mobile/src/run/storage';
import { compileWorkout } from '../../mobile/src/run/workout';
import { prescriptionToWorkout } from '../../mobile/src/run/prescription';
import type { TrackPoint } from '../../mobile/src/run/activity';
import { normalizeRunActivity } from '../src/run-recording/run-activity';

// 21/11/2026 — motor do Iniciar treino, armazenamento local e corpo enviado ao servidor. Simula corridas com pontos de GPS sinteticos; nenhum aparelho e' usado. O corpo gerado passa pela MESMA validacao do servidor.
const T0 = Date.parse('2026-11-21T09:00:00Z');
const M_PER_DEG = 111_320;
// pontos em linha reta para o norte, a `paceSec` s/km, um a cada `everySec` segundos, a partir do instante `fromSec` (distancia ja' percorrida `fromM`)
function line(fromSec: number, count: number, paceSec: number, opts: { everySec?: number; fromM?: number; accuracy?: number } = {}): TrackPoint[] {
  const every = opts.everySec ?? 4;
  const speed = 1000 / paceSec;
  return Array.from({ length: count }, (_, i) => {
    const sec = fromSec + i * every;
    const meters = (opts.fromM ?? 0) + i * every * speed;
    return { latitude: -19.93 + meters / M_PER_DEG, longitude: -44.05, altitude: 800, accuracy: opts.accuracy ?? 5, speed, timestamp: T0 + sec * 1000 };
  });
}

const program = (parts: unknown[]) => compileWorkout(prescriptionToWorkout({ id: 'sess1', title: 't', parts })!);
const rich = program([
  { kind: 'continua', distanceKm: 0.5, paceSecondsPerKmMin: 330, paceSecondsPerKmMax: 360 },
  { kind: 'intervalada', repeatCount: 2, stimulusLabel: 'Forte', stimulusStepKm: 0.2, stimulusPaceSecondsPerKmMin: 270, stimulusPaceSecondsPerKmMax: 290, recoveryLabel: 'Leve', recoveryStepKm: 0.1, recoveryPaceSecondsPerKmMin: 400, recoveryPaceSecondsPerKmMax: 450 },
]);

describe('motor do treino: distancia, tempos e pausa', () => {
  it('soma a distancia dos pontos aceitos, conta o tempo em movimento e devolve os pontos com a distancia acumulada', () => {
    let s = startRun({ runId: 'r1', now: T0 });
    const pts = line(0, 60, 360); // 4 min a 6:00/km = ~667 m
    const r = applyPoints(s, pts, T0 + 236_000);
    s = r.state;
    expect(s.distanceM).toBeGreaterThan(640);
    expect(s.distanceM).toBeLessThan(680);
    expect(r.accepted).toHaveLength(60);
    expect(r.accepted[59].dist).toBeCloseTo(s.distanceM, 0);
    expect(s.movingMs).toBeGreaterThan(230_000 - 4_000);
    const snap = snapshotOf(s, T0 + 240_000);
    expect(snap.avgPaceSecPerKm).toBeGreaterThan(350);
    expect(snap.avgPaceSecPerKm).toBeLessThan(370);
  });

  it('descarta ponto impreciso, salto impossivel e ponto fora de ordem sem somar nada', () => {
    const s = startRun({ runId: 'r1', now: T0 });
    const good = line(0, 5, 360);
    const noisy: TrackPoint = { ...good[2], timestamp: T0 + 9_000, accuracy: 90 };
    const jump: TrackPoint = { ...good[3], latitude: good[3].latitude + 0.01, timestamp: T0 + 13_000 };
    const r = applyPoints(s, [good[0], good[1], noisy, jump, good[2], good[3], good[4]], T0 + 17_000);
    expect(r.state.rejectedPoints).toBe(2);
    expect(r.state.acceptedPoints).toBe(5);
    expect(r.state.distanceM).toBeLessThan(60);
  });

  it('pontos antes do inicio sao descartados; durante a pausa e depois de encerrar nada e somado', () => {
    let s = startRun({ runId: 'r1', now: T0 + 10_000 });
    expect(applyPoints(s, line(0, 2, 360), T0 + 12_000).accepted).toHaveLength(0);
    s = applyPoints(s, line(10, 10, 360), T0 + 46_000).state;
    const before = s.distanceM;
    s = pauseRun(s, T0 + 50_000);
    expect(applyPoints(s, line(50, 10, 360, { fromM: before }), T0 + 86_000).accepted).toHaveLength(0);
    const done = finishRun(resumeRun(s, T0 + 100_000), T0 + 110_000).state;
    expect(applyPoints(done, line(110, 5, 360), T0 + 130_000).accepted).toHaveLength(0);
  });

  it('pausa manual sai do cronometro mas nao do tempo da atividade; retomar corta o segmento (nao soma o deslocamento da pausa)', () => {
    let s = startRun({ runId: 'r1', now: T0 });
    s = applyPoints(s, line(0, 15, 360), T0 + 56_000).state; // 60 s correndo
    s = pauseRun(s, T0 + 60_000);
    expect(timerMs(s, T0 + 90_000)).toBe(60_000); // parado: o cronometro nao anda
    expect(clockMs(s, T0 + 90_000)).toBe(90_000);
    s = resumeRun(s, T0 + 120_000);
    expect(s.pausedMs).toBe(60_000);
    const distanceBefore = s.distanceM;
    // ela andou 500 m de carro/onibus durante a pausa: o primeiro ponto novo esta longe do ultimo, mas nao pode somar
    const after = applyPoints(s, line(124, 3, 360, { fromM: 500 }), T0 + 132_000);
    const gained = after.state.distanceM - distanceBefore; // so' o que ela correu de fato depois de retomar (3 pontos, ~22 m), nunca os ~500 m da pausa
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThan(40);
  });

  it('encerrar com a pausa aberta fecha a pausa no instante do fim; encerrar duas vezes e idempotente', () => {
    let s = startRun({ runId: 'r1', now: T0 });
    s = pauseRun(applyPoints(s, line(0, 10, 360), T0 + 36_000).state, T0 + 40_000);
    const f1 = finishRun(s, T0 + 100_000);
    expect(f1.state.phase).toBe('finished');
    expect(f1.state.pausedMs).toBe(60_000);
    expect(timerMs(f1.state, T0 + 999_000)).toBe(40_000);
    expect(finishRun(f1.state, T0 + 200_000).state).toBe(f1.state);
  });
});

describe('etapas da prescricao e avisos', () => {
  it('termina cada etapa pela distancia, avisa a transicao e termina o programa', () => {
    let s = startRun({ runId: 'r2', now: T0, prescribedSessionId: 'sess1', program: rich });
    const texts: string[] = [];
    let t = 0;
    let meters = 0;
    for (let i = 0; i < 400 && !snapshotOf(s, T0 + t * 1000).finishedProgram; i++) {
      const pts = line(t, 1, 345, { fromM: meters });
      const r = applyPoints(s, pts, T0 + t * 1000);
      s = r.state; texts.push(...r.announcements.filter((a) => a.kind === 'transition').map((a) => a.text));
      t += 4; meters += 4 * (1000 / 345);
    }
    expect(snapshotOf(s, T0 + t * 1000).finishedProgram).toBe(true);
    expect(texts).toEqual(['Iniciar série 1 de 2.', 'Iniciar pausa ativa, 100 metros.', 'Iniciar série 2 de 2.', 'Iniciar pausa ativa, 100 metros.', 'Treino estruturado concluído.']);
    expect(s.distanceM).toBeGreaterThan(900); // 0,5 + 2 x (0,2 + 0,1) km
  });

  it('avisa "Reduza o ritmo" / "Acelere o ritmo" fora da faixa e respeita o intervalo entre avisos; dentro da faixa fica quieto', () => {
    const s0 = startRun({ runId: 'r3', now: T0, program: rich });
    const fast = applyPoints(s0, line(0, 6, 290), T0 + 20_000); // 4:50/km, a faixa e 5:30-6:00
    expect(fast.announcements.map((a) => a.text)).toContain('Reduza o ritmo.');
    expect(currentZone(fast.state, T0 + 20_000)).toBe('too-fast');
    const again = applyPoints(fast.state, line(24, 2, 290, { fromM: fast.state.distanceM }), T0 + 29_000);
    expect(again.announcements.filter((a) => a.kind === 'zone')).toHaveLength(0); // intervalo de 30 s
    const slow = applyPoints(startRun({ runId: 'r3', now: T0, program: rich }), line(0, 6, 420), T0 + 20_000);
    expect(slow.announcements.map((a) => a.text)).toContain('Acelere o ritmo.');
    const inZone = applyPoints(startRun({ runId: 'r3', now: T0, program: rich }), line(0, 6, 345), T0 + 20_000);
    expect(inZone.announcements.filter((a) => a.kind === 'zone')).toHaveLength(0);
  });

  it('etapa sem meta de ritmo (prescricao sem faixa) nunca gera aviso de ritmo; treino livre tambem nao', () => {
    const noTarget = program([{ kind: 'continua', distanceKm: 5, paceSecondsPerKmMin: 400, paceSecondsPerKmMax: 300 }]); // faixa invertida = sem meta
    expect(noTarget[0].targets).toEqual([]);
    const r = applyPoints(startRun({ runId: 'r4', now: T0, program: noTarget }), line(0, 6, 240), T0 + 20_000);
    expect(r.announcements.filter((a) => a.kind === 'zone')).toHaveLength(0);
    const free = applyPoints(startRun({ runId: 'r5', now: T0 }), line(0, 6, 240), T0 + 20_000);
    expect(free.announcements).toEqual([]);
    expect(snapshotOf(free.state, T0 + 20_000).step).toBeNull();
  });
});

describe('treino interrompido (aplicativo fechado) e corpo enviado ao servidor', () => {
  it('retomar depois de interrompido: o tempo sem pontos conta como pausa, o segmento e cortado e o treino fica marcado', () => {
    let s = startRun({ runId: 'r6', now: T0 });
    s = applyPoints(s, line(0, 15, 360), T0 + 56_000).state;
    const resumed = resumeAfterInterruption(s, T0 + 356_000); // 5 min depois
    expect(resumed.interrupted).toBe(true);
    expect(resumed.lastPoint).toBeNull();
    expect(resumed.phase).toBe('recording');
    expect(timerMs(resumed, T0 + 356_000)).toBeLessThanOrEqual(60_000 + 1_000);
  });

  function finished(): { state: RunState; points: RecordedPoint[] } {
    let s = startRun({ runId: '731d8bb5-de0d-4a90-92ba-09c52ce71b9e', now: T0, prescribedSessionId: 'sess1', program: rich });
    const points: RecordedPoint[] = [];
    let t = 0; let meters = 0;
    for (let i = 0; i < 120; i++) {
      const r = applyPoints(s, line(t, 1, 345, { fromM: meters }), T0 + t * 1000);
      s = r.state; points.push(...r.accepted);
      t += 4; meters += 4 * (1000 / 345);
    }
    return { state: finishRun(pauseRun(resumeRun(pauseRun(s, T0 + t * 1000), T0 + (t + 30) * 1000), T0 + (t + 40) * 1000), T0 + (t + 60) * 1000).state, points };
  }

  it('o corpo gerado passa na MESMA validacao do servidor e respeita os tempos (movimento <= cronometro <= atividade)', () => {
    const { state, points } = finished();
    const body = buildRunUploadBody(state, points, -180);
    const server = normalizeRunActivity(body, new Date(T0 + 3_600_000));
    expect(server.clientId).toBe('731d8bb5-de0d-4a90-92ba-09c52ce71b9e');
    expect(server.sessionId).toBe('sess1');
    expect(body.movingSec).toBeLessThanOrEqual(body.durationSec);
    expect(body.durationSec).toBeLessThanOrEqual(body.elapsedSec);
    expect(body.elapsedSec - body.durationSec).toBeGreaterThanOrEqual(50); // as duas pausas manuais (30 s + 20 s)
    expect(body.distanceMeters).toBeCloseTo(state.distanceM, 0);
    expect(server.points.length).toBe(body.points.length);
    for (let i = 1; i < body.points.length; i++) {
      expect(body.points[i].t).toBeGreaterThan(body.points[i - 1].t);
      expect(body.points[i].dist).toBeGreaterThanOrEqual(body.points[i - 1].dist);
    }
    expect(JSON.stringify(body)).not.toMatch(/hr|heart|avgHr/i); // o celular nao envia frequencia cardiaca
  });

  it('percurso enorme e reduzido ao limite do servidor sem perder o ultimo ponto; ponto com coordenada invalida e descartado', () => {
    const { state } = finished();
    const many: RecordedPoint[] = Array.from({ length: RUN_PAYLOAD_LIMITS.maxPoints * 2 + 10 }, (_, i) => ({
      latitude: -19.93 + i * 1e-6, longitude: -44.05, altitude: null, accuracy: 5, speed: 3, timestamp: T0 + i * 2_000, dist: i * 2,
    }));
    const body = buildRunUploadBody({ ...state, startedAt: T0, endedAt: T0 + (many.length * 2 + 10) * 1000 }, [{ ...many[0], latitude: Number.NaN }, ...many], 0);
    expect(body.points.length).toBeLessThanOrEqual(RUN_PAYLOAD_LIMITS.maxPoints);
    expect(body.points[body.points.length - 1].dist).toBe(many[many.length - 1].dist);
  });
});

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  async getItem(key: string) { return this.data.get(key) ?? null; }
  async setItem(key: string, value: string) { this.data.set(key, value); }
  async removeItem(key: string) { this.data.delete(key); }
}

describe('armazenamento local do treino (sobrevive ao fechamento do aplicativo)', () => {
  const pts = (n: number, from = 0): RecordedPoint[] => Array.from({ length: n }, (_, i) => ({ latitude: -19.93, longitude: -44.05, altitude: null, accuracy: 5, speed: 3, timestamp: T0 + (from + i) * 4_000, dist: (from + i) * 12 }));

  it('grava em blocos e devolve todos os pontos na ordem, mesmo apos varios lotes', async () => {
    const storage = new RunStorage(new MemoryStore());
    await storage.appendPoints('r1', pts(50));
    await storage.appendPoints('r1', pts(130, 50));
    await storage.appendPoints('r1', []);
    const loaded = await storage.loadPoints('r1');
    expect(loaded).toHaveLength(180);
    expect(loaded.map((p) => p.dist)).toEqual(pts(180).map((p) => p.dist));
  });

  it('nenhum bloco passa do tamanho maximo (cada gravacao reescreve so um bloco pequeno)', async () => {
    const store = new MemoryStore();
    await new RunStorage(store).appendPoints('r1', pts(200));
    const chunks = [...store.data.entries()].filter(([key]) => key.includes(':chunk:'));
    expect(chunks.length).toBe(Math.ceil(200 / RUN_STORAGE.chunkSize));
    for (const [, value] of chunks) expect(JSON.parse(value).length).toBeLessThanOrEqual(RUN_STORAGE.chunkSize);
  });

  it('estado e treino ativo sobrevivem: ao reabrir encontra o treino em andamento e retoma de onde parou', async () => {
    const storage = new RunStorage(new MemoryStore());
    let s = startRun({ runId: 'r7', now: T0, program: rich });
    const r = applyPoints(s, line(0, 20, 345), T0 + 76_000);
    s = r.state;
    await storage.setActive('r7'); await storage.saveState(s); await storage.appendPoints('r7', r.accepted);
    const reopened = new RunStorage((storage as unknown as { store: KeyValueStore }).store);
    expect(await reopened.getActive()).toBe('r7');
    const state = await reopened.loadState('r7');
    expect(state?.distanceM).toBeCloseTo(s.distanceM, 5);
    expect(state?.stepIndex).toBe(s.stepIndex);
    expect(await reopened.loadPoints('r7')).toHaveLength(r.accepted.length);
    expect(await reopened.loadState('outro')).toBeNull();
  });

  it('estado corrompido ou de outra versao nao quebra: volta nulo; treinos pendentes nao duplicam; limpar apaga tudo', async () => {
    const store = new MemoryStore();
    const storage = new RunStorage(store);
    store.data.set('panzeri-run:run:rx:state', '{ nao e json');
    expect(await storage.loadState('rx')).toBeNull();
    store.data.set('panzeri-run:run:ry:state', JSON.stringify({ schemaVersion: 99, runId: 'ry' }));
    expect(await storage.loadState('ry')).toBeNull();
    await storage.addPending('r1'); await storage.addPending('r1'); await storage.addPending('r2');
    expect(await storage.listPending()).toEqual(['r1', 'r2']);
    await storage.appendPoints('r1', pts(70)); await storage.saveState(startRun({ runId: 'r1', now: T0 })); await storage.setActive('r1');
    await storage.clear('r1');
    expect(await storage.loadPoints('r1')).toEqual([]);
    expect(await storage.loadState('r1')).toBeNull();
    expect(await storage.listPending()).toEqual(['r2']);
    expect(await storage.getActive()).toBeNull();
    expect([...store.data.keys()].some((key) => key.includes(':r1:'))).toBe(false);
  });
});
