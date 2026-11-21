// Treino gravado -> corpo enviado ao servidor (POST /me/run/activities). Funcao pura (21/11/2026). O formato e' o que o servidor valida (run-activity.ts, apps/api): tempos coerentes (em movimento <= cronometro <=
// atividade), um ponto por segundo no maximo, deslocamento em segundos inteiros desde o inicio, distancia acumulada por ponto. O celular nao envia frequencia cardiaca. Nada aqui altera o que foi medido: so'
// organiza e limita (maximo de pontos) para caber no limite do servidor.
import { RecordedPoint, RunState, clockMs, timerMs } from './engine';

export const RUN_PAYLOAD_LIMITS = { maxPoints: 30_000, minPointSpacingSec: 2 } as const;

export type RunUploadPoint = { t: number; lat: number; lon: number; alt: number | null; dist: number; speed: number | null };
export type RunUploadBody = {
  clientId: string;
  sessionId: string | null;
  startedAt: string;
  endedAt: string;
  utcOffsetMinutes: number;
  durationSec: number;
  elapsedSec: number;
  movingSec: number;
  distanceMeters: number;
  interrupted: boolean;
  points: RunUploadPoint[];
};

const sec = (ms: number) => Math.max(0, Math.round(ms / 1000));

// utcOffsetMinutes: fuso do aparelho no momento do inicio, no sinal do servidor (leste positivo): -new Date().getTimezoneOffset().
export function buildRunUploadBody(state: RunState, points: RecordedPoint[], utcOffsetMinutes: number): RunUploadBody {
  const endedAt = state.endedAt ?? state.startedAt;
  const elapsedSec = sec(clockMs(state, endedAt));
  const durationSec = Math.min(sec(timerMs(state, endedAt)), elapsedSec);
  const movingSec = Math.min(sec(state.movingMs), durationSec);
  const upload: RunUploadPoint[] = [];
  let lastT = -RUN_PAYLOAD_LIMITS.minPointSpacingSec;
  for (const point of [...points].sort((a, b) => a.timestamp - b.timestamp)) {
    const t = Math.max(0, Math.round((point.timestamp - state.startedAt) / 1000));
    if (t > 2 * 24 * 3600 || t - lastT < RUN_PAYLOAD_LIMITS.minPointSpacingSec) continue;
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
    upload.push({
      t, lat: point.latitude, lon: point.longitude,
      alt: point.altitude !== null && Number.isFinite(point.altitude) ? Math.round(point.altitude * 10) / 10 : null,
      dist: Math.round(point.dist * 10) / 10,
      speed: point.speed !== null && Number.isFinite(point.speed) && point.speed >= 0 && point.speed <= 15 ? Math.round(point.speed * 100) / 100 : null,
    });
    lastT = t;
  }
  return {
    clientId: state.runId,
    sessionId: state.prescribedSessionId,
    startedAt: new Date(state.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    utcOffsetMinutes,
    durationSec, elapsedSec, movingSec,
    distanceMeters: Math.round(state.distanceM * 10) / 10,
    interrupted: state.interrupted,
    points: reduceTo(upload, RUN_PAYLOAD_LIMITS.maxPoints),
  };
}

// Mais pontos que o limite do servidor: mantem o primeiro e o ultimo e distribui o resto por igual (percurso nunca perde o fim).
function reduceTo(points: RunUploadPoint[], max: number): RunUploadPoint[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const reduced: RunUploadPoint[] = [];
  for (let i = 0; i < max; i += 1) reduced.push(points[Math.floor(i * step)]);
  reduced[reduced.length - 1] = points[points.length - 1];
  return reduced;
}
