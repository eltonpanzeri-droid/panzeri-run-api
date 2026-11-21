// Motor do treino gravado no Panzeri Run (Iniciar treino) — NUCLEO PURO e deterministico: sem React Native, sem rede, sem armazenamento e sem relogio de parede (o horario entra como argumento). 21/11/2026.
// Recebe pontos de GPS e comandos da aluna (iniciar, pausar, retomar, encerrar) e devolve o novo estado, os pontos aceitos (com a distancia acumulada) e os avisos falados que devem soar. Quem chama (a tarefa
// em segundo plano e a tela) so' persiste o estado e fala os avisos. Nao calcula nem altera conteudo de treino: so' mede o que aconteceu e compara o ritmo medido com a faixa prescrita pela IA.
import { TrackPoint } from './activity';
import { currentSpeedMps, distanceBetween, shouldAcceptPoint } from './track';
import { ExecutableStep, PaceZone, completionReached, paceZoneFor } from './workout';
import { transitionAnnouncement } from './announcements';

export type RunPhase = 'recording' | 'paused' | 'finished';

export type RecordedPoint = TrackPoint & { dist: number }; // dist = distancia acumulada (m) ate este ponto

export interface RunState {
  schemaVersion: 1;
  runId: string;
  prescribedSessionId: string | null;
  program: ExecutableStep[]; // vazio = treino livre (sem etapas)
  phase: RunPhase;
  startedAt: number; // ms (toque em "Iniciar treino")
  endedAt: number | null;
  pausedMs: number; // soma das pausas MANUAIS ja encerradas
  pauseStartedAt: number | null;
  lastPoint: TrackPoint | null; // ultimo ponto aceito (null apos retomar: corta o segmento para nao somar o deslocamento da pausa)
  recent: TrackPoint[]; // ultimos pontos aceitos (para o ritmo atual)
  distanceM: number;
  movingMs: number;
  acceptedPoints: number;
  rejectedPoints: number;
  stepIndex: number;
  stepStartDistanceM: number;
  stepStartTimerMs: number;
  lastZoneAnnouncedAt: number;
  interrupted: boolean; // o treino foi retomado depois de o aplicativo ser fechado/interrompido
}

export type Announcement = { kind: 'transition' | 'zone' | 'finished'; text: string };

export const ENGINE = {
  zoneCooldownMs: 30_000, // intervalo minimo entre dois avisos de ritmo
  movingMinSpeedMps: 0.5, // abaixo disso o trecho nao conta como "em movimento"
  maxSegmentGapMs: 15_000, // lacuna maior que isso nao conta como tempo em movimento (sinal perdido)
  recentWindow: 8,
} as const;

export type StartInput = { runId: string; now: number; prescribedSessionId?: string | null; program?: ExecutableStep[] };

export function startRun(input: StartInput): RunState {
  return {
    schemaVersion: 1, runId: input.runId, prescribedSessionId: input.prescribedSessionId ?? null, program: input.program ?? [], phase: 'recording',
    startedAt: input.now, endedAt: null, pausedMs: 0, pauseStartedAt: null, lastPoint: null, recent: [], distanceM: 0, movingMs: 0, acceptedPoints: 0, rejectedPoints: 0,
    stepIndex: 0, stepStartDistanceM: 0, stepStartTimerMs: 0, lastZoneAnnouncedAt: 0, interrupted: false,
  };
}

// Tempo da atividade (relogio de parede desde o inicio) e tempo do cronometro (sem as pausas manuais).
export function clockMs(state: RunState, now: number): number {
  const end = state.endedAt ?? now;
  return Math.max(0, end - state.startedAt);
}
export function timerMs(state: RunState, now: number): number {
  const end = state.endedAt ?? now;
  const openPause = state.pauseStartedAt !== null ? Math.max(0, end - state.pauseStartedAt) : 0;
  return Math.max(0, end - state.startedAt - state.pausedMs - openPause);
}

export type ApplyResult = { state: RunState; accepted: RecordedPoint[]; announcements: Announcement[] };

// Aplica um lote de pontos (do GPS em primeiro plano ou da tarefa em segundo plano). Pontos fora de ordem ou antes do inicio sao descartados; durante pausa ou depois de encerrar nada e' somado.
export function applyPoints(input: RunState, points: TrackPoint[], now: number): ApplyResult {
  let state = input;
  const accepted: RecordedPoint[] = [];
  const announcements: Announcement[] = [];
  if (state.phase !== 'recording') return { state, accepted, announcements };
  const ordered = [...points].filter((p) => p.timestamp >= state.startedAt).sort((a, b) => a.timestamp - b.timestamp);
  for (const point of ordered) {
    if (!shouldAcceptPoint(state.lastPoint ?? undefined, point)) { state = { ...state, rejectedPoints: state.rejectedPoints + 1 }; continue; }
    const previous = state.lastPoint;
    const step = previous ? distanceBetween(previous, point) : 0;
    const dt = previous ? point.timestamp - previous.timestamp : 0;
    const moving = previous && dt > 0 && dt <= ENGINE.maxSegmentGapMs && step / (dt / 1000) >= ENGINE.movingMinSpeedMps ? dt : 0;
    const distanceM = state.distanceM + step;
    const recent = [...state.recent, point].slice(-ENGINE.recentWindow);
    state = { ...state, lastPoint: point, recent, distanceM, movingMs: state.movingMs + moving, acceptedPoints: state.acceptedPoints + 1 };
    accepted.push({ ...point, dist: Math.round(distanceM * 10) / 10 });
    const advanced = advanceSteps(state, point.timestamp);
    state = advanced.state;
    announcements.push(...advanced.announcements);
  }
  const zone = zoneAnnouncement(state, now);
  if (zone) { state = { ...state, lastZoneAnnouncedAt: now }; announcements.push(zone); }
  return { state, accepted, announcements };
}

// Passa para a proxima etapa quando a atual termina (por distancia ou por tempo), carregando a sobra de distancia (como no Panz Fit). Mais de uma etapa pode terminar no mesmo ponto.
function advanceSteps(input: RunState, at: number): { state: RunState; announcements: Announcement[] } {
  let state = input;
  const announcements: Announcement[] = [];
  while (state.stepIndex < state.program.length) {
    const step = state.program[state.stepIndex];
    const progress = { distanceM: Math.max(0, state.distanceM - state.stepStartDistanceM), elapsedMs: Math.max(0, timerMs(state, at) - state.stepStartTimerMs) };
    if (!completionReached(step, progress)) break;
    const nextIndex = state.stepIndex + 1;
    const next = state.program[nextIndex] ?? null;
    state = {
      ...state, stepIndex: nextIndex,
      stepStartDistanceM: step.completion.kind === 'distance' ? state.stepStartDistanceM + step.completion.meters : state.distanceM,
      stepStartTimerMs: step.completion.kind === 'duration' ? state.stepStartTimerMs + step.completion.seconds * 1000 : timerMs(state, at),
    };
    announcements.push({ kind: 'transition', text: transitionAnnouncement(next, next !== null) });
  }
  return { state, announcements };
}

export function currentStep(state: RunState): ExecutableStep | null {
  return state.program[state.stepIndex] ?? null;
}

export function currentPaceSecPerKm(state: RunState, now: number): number | null {
  const speed = currentSpeedMps(state.recent, now);
  if (speed <= 0) return null;
  const pace = 1000 / speed;
  return pace > 3600 ? null : pace;
}

export function currentZone(state: RunState, now: number): PaceZone {
  return paceZoneFor(currentStep(state), currentPaceSecPerKm(state, now));
}

function zoneAnnouncement(state: RunState, now: number): Announcement | null {
  if (state.phase !== 'recording' || now - state.lastZoneAnnouncedAt < ENGINE.zoneCooldownMs) return null;
  const zone = currentZone(state, now);
  if (zone === 'too-fast') return { kind: 'zone', text: 'Reduza o ritmo.' };
  if (zone === 'too-slow') return { kind: 'zone', text: 'Acelere o ritmo.' };
  return null;
}

export function pauseRun(state: RunState, now: number): RunState {
  if (state.phase !== 'recording') return state;
  return { ...state, phase: 'paused', pauseStartedAt: now };
}

// Ao retomar, o vinculo com o ultimo ponto e' cortado: o primeiro ponto novo nao soma o deslocamento feito durante a pausa.
export function resumeRun(state: RunState, now: number): RunState {
  if (state.phase !== 'paused' || state.pauseStartedAt === null) return state;
  return { ...state, phase: 'recording', pausedMs: state.pausedMs + Math.max(0, now - state.pauseStartedAt), pauseStartedAt: null, lastPoint: null, recent: [] };
}

// Encerra: uma pausa aberta e' fechada no momento do fim. Idempotente.
export function finishRun(state: RunState, now: number): { state: RunState; announcements: Announcement[] } {
  if (state.phase === 'finished') return { state, announcements: [] };
  const closed = state.pauseStartedAt !== null ? { ...state, pausedMs: state.pausedMs + Math.max(0, now - state.pauseStartedAt), pauseStartedAt: null } : state;
  return { state: { ...closed, phase: 'finished', endedAt: now }, announcements: [{ kind: 'finished', text: 'Treino encerrado.' }] };
}

// Treino retomado depois de o aplicativo ser fechado/interrompido (a aluna decide retomar): o tempo desde o ultimo ponto conhecido conta como pausa (nao como corrida), o vinculo com o ultimo ponto e' cortado e o
// treino fica marcado como interrompido. Se ja' estava pausado pela propria aluna, apenas retoma.
export function resumeAfterInterruption(state: RunState, now: number): RunState {
  if (state.phase === 'finished') return state;
  const cutAt = state.lastPoint?.timestamp ?? state.startedAt;
  const lostMs = Math.max(0, now - cutAt);
  const base = state.phase === 'paused' && state.pauseStartedAt !== null ? resumeRun(state, now) : { ...state, pausedMs: state.pausedMs + lostMs, lastPoint: null, recent: [] };
  return { ...base, phase: 'recording', interrupted: true };
}

export type RunSnapshot = {
  phase: RunPhase; clockMs: number; timerMs: number; movingMs: number; distanceM: number; avgPaceSecPerKm: number | null; currentPaceSecPerKm: number | null;
  step: ExecutableStep | null; stepIndex: number; stepCount: number; stepRemainingM: number | null; stepRemainingMs: number | null; zone: PaceZone; finishedProgram: boolean;
};

export function snapshotOf(state: RunState, now: number): RunSnapshot {
  const timer = timerMs(state, now);
  const step = currentStep(state);
  const stepDistance = Math.max(0, state.distanceM - state.stepStartDistanceM);
  const stepElapsed = Math.max(0, timer - state.stepStartTimerMs);
  return {
    phase: state.phase, clockMs: clockMs(state, now), timerMs: timer, movingMs: state.movingMs, distanceM: state.distanceM,
    avgPaceSecPerKm: state.distanceM >= 20 && timer > 0 ? timer / 1000 / (state.distanceM / 1000) : null,
    currentPaceSecPerKm: currentPaceSecPerKm(state, now),
    step, stepIndex: state.stepIndex, stepCount: state.program.length,
    stepRemainingM: step?.completion.kind === 'distance' ? Math.max(0, step.completion.meters - stepDistance) : null,
    stepRemainingMs: step?.completion.kind === 'duration' ? Math.max(0, step.completion.seconds * 1000 - stepElapsed) : null,
    zone: currentZone(state, now), finishedProgram: state.program.length > 0 && state.stepIndex >= state.program.length,
  };
}
