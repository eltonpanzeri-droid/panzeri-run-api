import { Injectable } from '@nestjs/common';
import { ZeppWindowBody } from './zepp-workout-window';

export const ZEPP_WORKOUT_URL = 'https://api-open.zepp.com/users/-/workouts?version=2.0.0';
const REQUEST_TIMEOUT_MS = 20_000;

export type ZeppPublishResult =
  | { ok: true }
  // 'auth' = token invalido/expirado (401/code -2); 'bad_request' = corpo recusado (400/code<0): NAO adianta repetir o mesmo corpo; 'server' = 5xx/-99;
  // 'network' = nao chegou na Zepp. A mensagem nunca contem token nem corpo.
  | { ok: false; kind: 'auth' | 'bad_request' | 'server' | 'network'; httpStatus: number | null; code: number | null; message: string };

// Cliente da Workout API V2. Sucesso = HTTP 200 com `code: 1` (documentacao). NUNCA lanca: o chamador decide pelo resultado. Nao confirma que o relogio recebeu —
// so' que a Zepp aceitou a janela.
@Injectable()
export class ZeppWorkoutClient {
  async publish(accessToken: string, body: ZeppWindowBody): Promise<ZeppPublishResult> {
    let response: Response;
    try {
      response = await fetch(ZEPP_WORKOUT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, kind: 'network', httpStatus: null, code: null, message: 'Nao foi possivel contatar a Zepp.' };
    }
    let payload: { code?: unknown } | null = null;
    try { payload = (await response.json()) as { code?: unknown }; } catch { payload = null; }
    const code = typeof payload?.code === 'number' ? payload.code : null;
    if (response.status === 200 && code === 1) return { ok: true };
    if (response.status === 401 || code === -2) return { ok: false, kind: 'auth', httpStatus: response.status, code, message: 'A Zepp recusou o token de acesso.' };
    if (response.status === 400 || (code !== null && code < 0 && code !== -99)) return { ok: false, kind: 'bad_request', httpStatus: response.status, code, message: 'A Zepp recusou o treino enviado.' };
    return { ok: false, kind: 'server', httpStatus: response.status, code, message: 'A Zepp nao processou o envio agora.' };
  }
}
