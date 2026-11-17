import { BadRequestException } from '@nestjs/common';

// Treino gravado no relogio e enviado ao Panzeri Run (17/11/2026). Validacao ESTRUTURAL do que o relogio manda (nunca decide nada do treino): tipos, limites fisicos e tamanho. O que a aluna autorizou e'
// aplicado depois, na gravacao (sem 'activity_route' nao entra coordenada; sem 'activity_sensors' nao entra frequencia cardiaca).

export const WEAR_LIMITS = {
  maxPoints: 30_000, // 8 h a 1 ponto por segundo = 28.800
  maxDurationSec: 24 * 3600,
  maxDistanceMeters: 500_000,
  maxFutureMs: 2 * 3600_000, // relogio adiantado
  minStartedAt: Date.UTC(2020, 0, 1),
  maxOffsetSec: 2 * 24 * 3600,
} as const;

export interface WearPoint {
  t: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
  dist: number | null;
  speed: number | null; // m/s
}

export interface WearActivityInput {
  clientId: string;
  sessionId: string | null;
  startedAt: Date;
  endedAt: Date;
  utcOffsetMinutes: number;
  durationSec: number; // cronometro (sem pausas manuais)
  elapsedSec: number; // da atividade (inicio ao fim)
  movingSec: number; // em movimento
  distanceMeters: number;
  avgHr: number | null;
  maxHr: number | null;
  interrupted: boolean;
  points: WearPoint[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message: string): never => { throw new BadRequestException({ code: 'wear_activity_invalid', message }); };
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const int = (value: unknown, min: number, max: number, name: string): number => {
  const n = num(value);
  if (n === null || !Number.isInteger(n) || n < min || n > max) return fail(`${name} invalido.`);
  return n;
};

export function normalizeWearActivity(body: unknown, now: Date = new Date()): WearActivityInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Corpo invalido.');
  const b = body as Record<string, unknown>;
  const clientId = typeof b.clientId === 'string' && UUID.test(b.clientId) ? b.clientId.toLowerCase() : fail('clientId invalido.');
  const sessionId = b.sessionId === null || b.sessionId === undefined ? null : typeof b.sessionId === 'string' && b.sessionId.length > 0 && b.sessionId.length <= 64 ? b.sessionId : fail('sessionId invalido.');
  const startedAt = typeof b.startedAt === 'string' ? new Date(b.startedAt) : new Date(NaN);
  const endedAt = typeof b.endedAt === 'string' ? new Date(b.endedAt) : new Date(NaN);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return fail('Datas invalidas.');
  if (startedAt.getTime() < WEAR_LIMITS.minStartedAt || startedAt.getTime() > now.getTime() + WEAR_LIMITS.maxFutureMs) return fail('Data de inicio fora do intervalo aceito.');
  if (endedAt.getTime() < startedAt.getTime()) return fail('O fim e anterior ao inicio.');
  const elapsedSec = int(b.elapsedSec, 0, WEAR_LIMITS.maxDurationSec, 'elapsedSec');
  const durationSec = int(b.durationSec, 0, WEAR_LIMITS.maxDurationSec, 'durationSec');
  const movingSec = int(b.movingSec, 0, WEAR_LIMITS.maxDurationSec, 'movingSec');
  // Sempre moving <= timer <= clock (a mesma regra das amostras da Garmin). Uma folga de 2 s absorve arredondamento.
  if (movingSec > durationSec + 2 || durationSec > elapsedSec + 2) return fail('Os tempos do treino sao inconsistentes.');
  const utcOffsetMinutes = int(b.utcOffsetMinutes, -14 * 60, 14 * 60, 'utcOffsetMinutes');
  const distanceMeters = num(b.distanceMeters);
  if (distanceMeters === null || distanceMeters < 0 || distanceMeters > WEAR_LIMITS.maxDistanceMeters) return fail('distanceMeters invalido.');
  const hr = (value: unknown, name: string) => (value === null || value === undefined ? null : int(value, 20, 250, name));
  if (!Array.isArray(b.points)) return fail('points deve ser uma lista.');
  if (b.points.length > WEAR_LIMITS.maxPoints) return fail(`Pontos demais (maximo ${WEAR_LIMITS.maxPoints}).`);
  const points: WearPoint[] = [];
  let lastT = -1;
  for (const raw of b.points) {
    if (!raw || typeof raw !== 'object') return fail('Ponto invalido.');
    const p = raw as Record<string, unknown>;
    const t = int(p.t, 0, WEAR_LIMITS.maxOffsetSec, 't');
    if (t <= lastT) return fail('Pontos fora de ordem ou repetidos.');
    lastT = t;
    const lat = num(p.lat); const lon = num(p.lon);
    if ((lat === null) !== (lon === null)) return fail('Coordenada incompleta.');
    if (lat !== null && (lat < -90 || lat > 90 || lon! < -180 || lon! > 180)) return fail('Coordenada fora do intervalo.');
    const alt = num(p.alt);
    const dist = num(p.dist); const speed = num(p.speed);
    if (dist !== null && (dist < 0 || dist > WEAR_LIMITS.maxDistanceMeters)) return fail('Distancia do ponto invalida.');
    if (speed !== null && (speed < 0 || speed > 15)) return fail('Velocidade do ponto invalida.');
    points.push({ t, lat, lon, alt: alt !== null && alt > -500 && alt < 9000 ? alt : null, hr: p.hr === undefined || p.hr === null ? null : int(p.hr, 20, 250, 'hr'), dist, speed });
  }
  return {
    clientId, sessionId, startedAt, endedAt, utcOffsetMinutes, durationSec, elapsedSec, movingSec, distanceMeters,
    avgHr: hr(b.avgHr, 'avgHr'), maxHr: hr(b.maxHr, 'maxHr'), interrupted: b.interrupted === true, points,
  };
}
