import { Injectable } from '@nestjs/common';
import { GarminWorkout } from './garmin-workout-spec';

// Cliente da Training API V2 da Garmin (08/11/2026; "Training_API V2 2.0.pdf"). So' fala HTTP e devolve resultados tipados; quem decide o que enviar e' o publicador.
//   criar treino:      POST   https://apis.garmin.com/workoutportal/workout/v2            (corpo: o treino; resposta: o treino com workoutId e ownerId)
//   ler/atualizar/apagar treino: GET/PUT/DELETE https://apis.garmin.com/training-api/workout/v2/{workoutId}   (PUT exige o treino COMPLETO, com workoutId e ownerId)
//   agendar:           POST   https://apis.garmin.com/training-api/schedule/               ({ workoutId, date: 'AAAA-MM-DD' })
//   ler/atualizar/apagar agendamento: GET/PUT/DELETE .../training-api/schedule/{scheduleId}; GET .../schedule?startDate=&endDate=
// Codigos: 200/204 ok; 400 pedido invalido; 401 token inexistente; 403 nao permitido; 412 PERMISSAO do usuario (WORKOUT_IMPORT nao concedida); 429 limite (Starter: 100/min por app e 200/dia por aluna).
export const GARMIN_WORKOUT_CREATE_URL = 'https://apis.garmin.com/workoutportal/workout/v2';
export const GARMIN_TRAINING_BASE = 'https://apis.garmin.com/training-api';
const TIMEOUT_MS = 20_000;

export type GarminTrainingErrorKind = 'auth' | 'permission' | 'rate_limit' | 'bad_request' | 'not_found' | 'server' | 'network';
export class GarminTrainingError extends Error {
  constructor(readonly kind: GarminTrainingErrorKind, message: string, readonly httpStatus?: number) { super(message); }
}

function kindOf(status: number): GarminTrainingErrorKind {
  if (status === 401) return 'auth';
  if (status === 403 || status === 412) return 'permission';
  if (status === 429) return 'rate_limit';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  return 'bad_request';
}

@Injectable()
export class GarminTrainingClient {
  private async call(token: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    } catch {
      throw new GarminTrainingError('network', 'Nao foi possivel contatar a Garmin.');
    }
    if (!response.ok) throw new GarminTrainingError(kindOf(response.status), `A Garmin recusou o pedido (HTTP ${response.status}).`, response.status);
    if (response.status === 204) return null;
    try { return await response.json(); } catch { return null; }
  }

  async createWorkout(token: string, workout: GarminWorkout): Promise<{ workoutId: string; ownerId: string | null }> {
    const result = (await this.call(token, 'POST', GARMIN_WORKOUT_CREATE_URL, workout)) as { workoutId?: unknown; ownerId?: unknown } | null;
    const workoutId = typeof result?.workoutId === 'number' || typeof result?.workoutId === 'string' ? String(result.workoutId) : '';
    if (!workoutId) throw new GarminTrainingError('server', 'A Garmin nao devolveu o identificador do treino.');
    return { workoutId, ownerId: typeof result?.ownerId === 'number' || typeof result?.ownerId === 'string' ? String(result.ownerId) : null };
  }

  async updateWorkout(token: string, workoutId: string, ownerId: string | null, workout: GarminWorkout): Promise<void> {
    await this.call(token, 'PUT', `${GARMIN_TRAINING_BASE}/workout/v2/${encodeURIComponent(workoutId)}`, { ...workout, workoutId: Number(workoutId), ...(ownerId ? { ownerId: Number(ownerId) } : {}) });
  }

  async deleteWorkout(token: string, workoutId: string): Promise<void> {
    await this.call(token, 'DELETE', `${GARMIN_TRAINING_BASE}/workout/v2/${encodeURIComponent(workoutId)}`);
  }

  // A resposta da criacao do agendamento nao e' descrita no PDF: se vier sem scheduleId, procura o agendamento pelo treino e pela data (GET por intervalo).
  async createSchedule(token: string, workoutId: string, date: string): Promise<{ scheduleId: string | null }> {
    const result = (await this.call(token, 'POST', `${GARMIN_TRAINING_BASE}/schedule/`, { workoutId: Number(workoutId), date })) as { scheduleId?: unknown } | null;
    if (typeof result?.scheduleId === 'number' || typeof result?.scheduleId === 'string') return { scheduleId: String(result.scheduleId) };
    const found = (await this.call(token, 'GET', `${GARMIN_TRAINING_BASE}/schedule?startDate=${date}&endDate=${date}`)) as unknown;
    const rows = Array.isArray(found) ? (found as Array<{ scheduleId?: unknown; workoutId?: unknown }>) : [];
    const match = rows.find((row) => String(row.workoutId) === workoutId);
    return { scheduleId: match && (typeof match.scheduleId === 'number' || typeof match.scheduleId === 'string') ? String(match.scheduleId) : null };
  }

  async updateSchedule(token: string, scheduleId: string, workoutId: string, date: string): Promise<void> {
    await this.call(token, 'PUT', `${GARMIN_TRAINING_BASE}/schedule/${encodeURIComponent(scheduleId)}`, { scheduleId: Number(scheduleId), workoutId: Number(workoutId), date });
  }

  async deleteSchedule(token: string, scheduleId: string): Promise<void> {
    await this.call(token, 'DELETE', `${GARMIN_TRAINING_BASE}/schedule/${encodeURIComponent(scheduleId)}`);
  }
}
