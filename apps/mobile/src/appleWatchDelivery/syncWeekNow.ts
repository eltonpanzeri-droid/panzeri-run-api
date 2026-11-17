import {
  isAppleHealthSupported,
  listScheduledWorkouts,
  requestWorkoutAuthorization,
  scheduleCustomWorkoutSpec,
  validateCustomWorkoutSpec,
} from '../../modules/panzeri-apple-health/src';
import { AutoSendSession, AutoSendSummary, autoSendWeekToAppleWatch } from './autoSendWeekToAppleWatch';
import { AppleEligibility, AppleWatchApi, ApplePrepare } from './sendSessionToAppleWatch';

// Sincronizacao MANUAL dos treinos dos proximos 7 dias com o Apple Watch (16/11/2026): usada pelo botao do cartao de Apple Watch e pelo aviso "treinos ainda nao estao no relogio". Tenta tudo de novo
// (sem a lista de "ja tentadas" da abertura do app). A API decide o que e' elegivel; nada e' reenviado se ja foi enviado.
export type WatchCall = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;

export function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function makeWatchCall(apiUrl: string, accessToken: string): WatchCall {
  return async (method, path, body) => {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
}

export async function syncWeekToAppleWatch(call: WatchCall): Promise<AutoSendSummary> {
  const plan = (await call('GET', '/training-plans/current')) as { sessions?: AutoSendSession[] } | null;
  const api: AppleWatchApi = {
    prepare: (id) => call('POST', `/me/apple-watch/sessions/${id}/deliveries`) as Promise<ApplePrepare>,
    confirmSent: (deliveryId) => call('POST', `/me/apple-watch/deliveries/${deliveryId}/sent`) as Promise<never>,
    reportFailure: (deliveryId, failure) => call('POST', `/me/apple-watch/deliveries/${deliveryId}/failed`, { message: failure }) as Promise<never>,
  };
  return autoSendWeekToAppleWatch(plan?.sessions ?? [], {
    api,
    eligibility: (id) => call('GET', `/me/apple-watch/sessions/${id}/eligibility`) as Promise<AppleEligibility>,
    todayIso: localTodayIso(),
    attempted: new Set<string>(),
    native: {
      isSupported: isAppleHealthSupported,
      validateCustomWorkoutSpec,
      requestAuthorization: requestWorkoutAuthorization,
      listScheduled: listScheduledWorkouts,
      scheduleCustomWorkout: (planId, specJson, date) => scheduleCustomWorkoutSpec(planId, specJson, date),
    },
  });
}
