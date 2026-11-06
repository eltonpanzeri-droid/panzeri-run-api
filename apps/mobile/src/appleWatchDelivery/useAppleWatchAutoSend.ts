import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isAppleHealthSupported,
  listScheduledWorkouts,
  requestWorkoutAuthorization,
  scheduleCustomWorkoutSpec,
  validateCustomWorkoutSpec,
} from '../../modules/panzeri-apple-health/src';
import { AUTO_SEND_STORAGE_KEY, AutoSendSession, autoSendWeekToAppleWatch, sessionsToAutoSend } from './autoSendWeekToAppleWatch';
import { AppleEligibility, AppleWatchApi, ApplePrepare } from './sendSessionToAppleWatch';

// Liga o envio automatico (ver autoSendWeekToAppleWatch.ts) a tela da semana: roda uma vez por abertura do Panzeri Run e quando a lista de treinos muda. So' no iPhone nativo e so' depois de a
// aluna ter feito um envio manual com sucesso (flag guardada no aparelho). Melhor esforco: qualquer falha e' ignorada, o botao manual continua valendo.
function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function useAppleWatchAutoSend(sessions: AutoSendSession[] | null | undefined, accessToken: string, apiUrl: string): void {
  const attempted = useRef<Set<string>>(new Set());
  const running = useRef(false);
  const key = sessionsToAutoSend(sessions, localTodayIso()).map((session) => session.id).join(',');

  useEffect(() => {
    if (!isAppleHealthSupported || !key || running.current) return;
    let cancelled = false;
    (async () => {
      running.current = true;
      try {
        if ((await AsyncStorage.getItem(AUTO_SEND_STORAGE_KEY)) !== '1') return;
        const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
          const response = await fetch(`${apiUrl}/me/apple-watch/${path}`, {
            method,
            headers: { Authorization: `Bearer ${accessToken}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
            body: body !== undefined ? JSON.stringify(body) : undefined,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        };
        const api: AppleWatchApi = {
          prepare: (id) => call('POST', `sessions/${id}/deliveries`) as Promise<ApplePrepare>,
          confirmSent: (deliveryId) => call('POST', `deliveries/${deliveryId}/sent`),
          reportFailure: (deliveryId, failure) => call('POST', `deliveries/${deliveryId}/failed`, { message: failure }),
        };
        if (cancelled) return;
        await autoSendWeekToAppleWatch(sessions, {
          api,
          eligibility: (id) => call('GET', `sessions/${id}/eligibility`) as Promise<AppleEligibility>,
          todayIso: localTodayIso(),
          attempted: attempted.current,
          native: {
            isSupported: isAppleHealthSupported,
            validateCustomWorkoutSpec,
            requestAuthorization: requestWorkoutAuthorization,
            listScheduled: listScheduledWorkouts,
            scheduleCustomWorkout: (planId, specJson, date) => scheduleCustomWorkoutSpec(planId, specJson, date),
          },
        });
      } catch {
        // melhor esforco
      } finally {
        running.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [key, accessToken, apiUrl]);
}
