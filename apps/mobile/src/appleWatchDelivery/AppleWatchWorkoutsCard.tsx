import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '../PtText';
import {
  isAppleHealthSupported,
  listScheduledWorkouts,
  requestWorkoutAuthorization,
  scheduleCustomWorkoutSpec,
  validateCustomWorkoutSpec,
} from '../../modules/panzeri-apple-health/src';
import { AUTO_SEND_STORAGE_KEY, autoSendWeekToAppleWatch, AutoSendSession, syncSummaryMessage } from './autoSendWeekToAppleWatch';
import { AppleEligibility, AppleWatchApi, ApplePrepare } from './sendSessionToAppleWatch';

// Cartao "Envio de treinos ao Apple Watch" (06/11/2026, ordem de Elton): fica em Dispositivos e integracoes > Apple Watch. Substitui o botao "Enviar ao Apple Watch" que aparecia no card de cada
// treino (inclusive para quem nao tem Apple Watch). A aluna AUTORIZA uma vez (a folha do iPhone para agendar treinos no relogio) e toca em "Sincronizar envio de treinos ao relogio" quando quiser;
// com a autorizacao marcada, os treinos dos proximos 7 dias tambem seguem sozinhos ao abrir o Panzeri Run (useAppleWatchAutoSend). Desmarcar desliga tudo. So' no iPhone nativo.

function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function AppleWatchWorkoutsCard({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isAppleHealthSupported) return;
    void AsyncStorage.getItem(AUTO_SEND_STORAGE_KEY).then((value) => setAuthorized(value === '1')).catch(() => undefined);
  }, []);

  const call = useCallback(
    async (method: 'GET' | 'POST', path: string, body?: unknown) => {
      const response = await fetch(`${apiUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    [apiUrl, accessToken],
  );

  const onToggle = useCallback(async (next: boolean) => {
    setMessage(null);
    if (!next) {
      try { await AsyncStorage.removeItem(AUTO_SEND_STORAGE_KEY); } catch { /* melhor esforco */ }
      setAuthorized(false);
      return;
    }
    setBusy(true);
    try {
      const state = await requestWorkoutAuthorization();
      if (state !== 'authorized') {
        setMessage('O iPhone não autorizou. Para liberar, vá em Ajustes do iPhone e permita o Panzeri Run.');
        return;
      }
      await AsyncStorage.setItem(AUTO_SEND_STORAGE_KEY, '1');
      setAuthorized(true);
      setMessage('Autorizado. Toque em "Sincronizar envio de treinos ao relógio" para enviar agora.');
    } catch {
      setMessage('Não foi possível autorizar agora. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }, []);

  const onSync = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const plan = (await call('GET', '/training-plans/current')) as { sessions?: AutoSendSession[] } | null;
      const api: AppleWatchApi = {
        prepare: (id) => call('POST', `/me/apple-watch/sessions/${id}/deliveries`) as Promise<ApplePrepare>,
        confirmSent: (deliveryId) => call('POST', `/me/apple-watch/deliveries/${deliveryId}/sent`),
        reportFailure: (deliveryId, failure) => call('POST', `/me/apple-watch/deliveries/${deliveryId}/failed`, { message: failure }),
      };
      const summary = await autoSendWeekToAppleWatch(plan?.sessions ?? [], {
        api,
        eligibility: (id) => call('GET', `/me/apple-watch/sessions/${id}/eligibility`) as Promise<AppleEligibility>,
        todayIso: localTodayIso(),
        attempted: new Set<string>(), // toque manual: tenta tudo de novo
        native: {
          isSupported: isAppleHealthSupported,
          validateCustomWorkoutSpec,
          requestAuthorization: requestWorkoutAuthorization,
          listScheduled: listScheduledWorkouts,
          scheduleCustomWorkout: (planId, specJson, date) => scheduleCustomWorkoutSpec(planId, specJson, date),
        },
      });
      setMessage(syncSummaryMessage(summary));
    } catch {
      setMessage('Não foi possível sincronizar agora. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }, [busy, call]);

  if (!isAppleHealthSupported) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Envio de treinos ao Apple Watch</Text>
      <Text style={styles.text}>Autorize uma vez e os treinos dos próximos 7 dias seguem para o seu relógio quando você abrir o Panzeri Run. Se algum não chegar, toque em sincronizar.</Text>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Autorizo o envio de treinos ao Apple Watch</Text>
        <Switch value={authorized} onValueChange={(value) => void onToggle(value)} disabled={busy} />
      </View>
      {authorized ? (
        <Pressable style={[styles.button, busy && styles.buttonDisabled]} disabled={busy} onPress={() => void onSync()} accessibilityRole="button">
          {busy ? <ActivityIndicator size="small" color="#0B3D5C" /> : null}
          <Text style={styles.buttonText}>Sincronizar envio de treinos ao relógio</Text>
        </Pressable>
      ) : null}
      {message ? <Text style={styles.hint}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14, gap: 10, backgroundColor: '#FFFFFF', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  text: { fontSize: 13, color: '#475569' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { flex: 1, fontSize: 14, color: '#0F172A', fontWeight: '600' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#0B3D5C', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#0B3D5C', fontWeight: '700', fontSize: 14 },
  hint: { fontSize: 12, color: '#475569' },
});
