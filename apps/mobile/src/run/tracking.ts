// Camada NATIVA do Iniciar treino (21/11/2026): GPS, tarefa em segundo plano, voz e vibracao. Toda a logica de medir esta' em engine.ts (pura e testada); aqui so' ligamos o aparelho ao motor.
// REGRAS (decisao de Elton): o GPS so' liga quando a aluna toca em "Iniciar treino" e desliga ao encerrar (ou pausar); nada e' coletado fora do treino. Com a tela bloqueada ou outro aplicativo aberto a gravacao
// continua (tarefa em segundo plano). Um unico caminho grava os pontos (a tarefa), tanto com a tela ligada quanto desligada; as leituras/gravacoes passam por uma fila para nunca se misturarem.
// ATENCAO: esta camada NAO tem teste automatico (depende do aparelho): validar no iPhone pelo TestFlight.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { TrackPoint } from './activity';
import { Announcement, RecordedPoint, RunState, applyPoints, finishRun, pauseRun, resumeAfterInterruption, resumeRun, startRun } from './engine';
import { RunStorage } from './storage';
import { ExecutableStep } from './workout';

export const RUN_LOCATION_TASK = 'PANZERI_RUN_LOCATION';
export const runStorage = new RunStorage(AsyncStorage);

export type RunSettings = { voice: boolean; vibration: boolean };
const SETTINGS_KEY = 'panzeri-run:run:settings';
const DEFAULT_SETTINGS: RunSettings = { voice: true, vibration: true };

export async function loadRunSettings(): Promise<RunSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<RunSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export async function saveRunSettings(settings: RunSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ---- fila: toda leitura-alteracao-gravacao do treino ativo passa por aqui (a tarefa em segundo plano e os botoes da tela podem chegar juntos)
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

// ---- quem acompanha o treino na tela
type Listener = (state: RunState) => void;
const listeners = new Set<Listener>();
export function subscribeRun(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const notify = (state: RunState) => listeners.forEach((listener) => { try { listener(state); } catch { /* um ouvinte com erro nunca derruba a gravacao */ } });

// ---- voz e vibracao (melhor esforco: nunca interrompem a gravacao)
async function announce(items: Announcement[]): Promise<void> {
  if (items.length === 0) return;
  const settings = await loadRunSettings();
  try {
    if (settings.voice) {
      Speech.stop();
      Speech.speak(items.map((item) => item.text).join(' '), { language: 'pt-BR', rate: 1.0, pitch: 1.0 });
    }
    if (settings.vibration) {
      const zone = items.some((item) => item.kind === 'zone');
      await Haptics.notificationAsync(zone ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
    }
  } catch { /* sem voz ou vibracao disponivel */ }
}

const toTrackPoint = (location: Location.LocationObject): TrackPoint => ({
  latitude: location.coords.latitude, longitude: location.coords.longitude, altitude: location.coords.altitude, accuracy: location.coords.accuracy, speed: location.coords.speed, timestamp: location.timestamp,
});

// Unico caminho que grava pontos (tarefa em segundo plano E leitura em primeiro plano da alternativa).
async function processLocations(locations: Location.LocationObject[]): Promise<void> {
  await serial(async () => {
    const runId = await runStorage.getActive();
    if (!runId) return;
    const state = await runStorage.loadState(runId);
    if (!state || state.phase !== 'recording') return;
    const result = applyPoints(state, locations.map(toTrackPoint), Date.now());
    if (result.accepted.length > 0) await runStorage.appendPoints(runId, result.accepted);
    await runStorage.saveState(result.state);
    notify(result.state);
    await announce(result.announcements);
  });
}

// Definida no carregamento do modulo (e o modulo e' importado em index.js): precisa existir tambem quando o sistema acorda o aplicativo em segundo plano.
TaskManager.defineTask(RUN_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
  if (locations.length > 0) await processLocations(locations);
});

// ---- permissao
export type RunPermission = 'background' | 'foreground_only' | 'denied';
export async function requestRunPermission(): Promise<RunPermission> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return 'denied';
  try {
    const background = await Location.requestBackgroundPermissionsAsync();
    return background.status === 'granted' ? 'background' : 'foreground_only';
  } catch {
    return 'foreground_only';
  }
}

// ---- ligar e desligar o GPS (so' durante o treino)
let watchSubscription: Location.LocationSubscription | null = null;
export type TrackingMode = 'background' | 'foreground';

async function startTracking(): Promise<TrackingMode> {
  await stopTracking();
  try {
    await Location.startLocationUpdatesAsync(RUN_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation, activityType: Location.ActivityType.Fitness, distanceInterval: 5, timeInterval: 4000,
      pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: 'Panzeri Run gravando o treino', notificationBody: 'Seu percurso está sendo gravado. Toque para voltar ao treino.' },
    });
    return 'background';
  } catch {
    // sem permissao para segundo plano (ou o sistema recusou): grava so' com a tela ligada, e a tela avisa
    watchSubscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 4000, distanceInterval: 5 },
      (location) => { void processLocations([location]); },
    );
    return 'foreground';
  }
}

export async function stopTracking(): Promise<void> {
  try { watchSubscription?.remove(); } catch { /* ja removida */ }
  watchSubscription = null;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(RUN_LOCATION_TASK);
  } catch { /* nada rodando */ }
}

// ---- comandos da aluna
function newRunId(): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

export async function beginRun(input: { program?: ExecutableStep[]; prescribedSessionId?: string | null }): Promise<{ state: RunState; mode: TrackingMode } | { error: 'permission_denied' | 'already_recording' }> {
  return serial(async () => {
    if (await runStorage.getActive()) return { error: 'already_recording' as const };
    const permission = await requestRunPermission();
    if (permission === 'denied') return { error: 'permission_denied' as const };
    const state = startRun({ runId: newRunId(), now: Date.now(), program: input.program, prescribedSessionId: input.prescribedSessionId ?? null });
    await runStorage.saveState(state);
    await runStorage.setActive(state.runId);
    const mode = await startTracking();
    notify(state);
    await announce([{ kind: 'transition', text: 'Treino iniciado.' }]);
    return { state, mode };
  });
}

async function mutateActive(change: (state: RunState) => RunState): Promise<RunState | null> {
  const runId = await runStorage.getActive();
  if (!runId) return null;
  const state = await runStorage.loadState(runId);
  if (!state) return null;
  const next = change(state);
  await runStorage.saveState(next);
  notify(next);
  return next;
}

// Pausar desliga o GPS (nada e' coletado parado); retomar liga de novo.
export function pauseCurrent(): Promise<RunState | null> {
  return serial(async () => {
    const next = await mutateActive((state) => pauseRun(state, Date.now()));
    if (next?.phase === 'paused') await stopTracking();
    return next;
  });
}
export function resumeCurrent(): Promise<{ state: RunState; mode: TrackingMode } | null> {
  return serial(async () => {
    const next = await mutateActive((state) => resumeRun(state, Date.now()));
    if (!next || next.phase !== 'recording') return null;
    return { state: next, mode: await startTracking() };
  });
}

// Encerra: para o GPS, fecha o treino, tira de "ativo" e poe na fila de envio. Devolve o estado final e todos os pontos para a tela de resumo.
export function finishCurrent(): Promise<{ state: RunState; points: RecordedPoint[] } | null> {
  return serial(async () => {
    const runId = await runStorage.getActive();
    if (!runId) return null;
    const state = await runStorage.loadState(runId);
    if (!state) return null;
    await stopTracking();
    const { state: done, announcements } = finishRun(state, Date.now());
    await runStorage.saveState(done);
    await runStorage.addPending(runId);
    await runStorage.setActive(null);
    notify(done);
    await announce(announcements);
    return { state: done, points: await runStorage.loadPoints(runId) };
  });
}

// ---- treino interrompido (aplicativo fechado, aparelho reiniciado)
export async function findInterruptedRun(): Promise<RunState | null> {
  const runId = await runStorage.getActive();
  if (!runId) return null;
  const state = await runStorage.loadState(runId);
  return state && state.phase !== 'finished' ? state : null;
}

export function resumeInterrupted(): Promise<{ state: RunState; mode: TrackingMode } | null> {
  return serial(async () => {
    const next = await mutateActive((state) => resumeAfterInterruption(state, Date.now()));
    if (!next) return null;
    return { state: next, mode: await startTracking() };
  });
}

// Descarta o treino (nada vai ao servidor e tudo e' apagado do aparelho).
export function discardRun(runId: string): Promise<void> {
  return serial(async () => {
    if ((await runStorage.getActive()) === runId) await stopTracking();
    await runStorage.clear(runId);
  });
}

export const platformSupportsBackground = Platform.OS === 'ios' || Platform.OS === 'android';
