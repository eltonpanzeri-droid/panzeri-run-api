import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  isAppleHealthSupported,
  requestWorkoutAuthorization,
  scheduleCustomWorkoutSpec,
  validateCustomWorkoutSpec,
  listScheduledWorkouts,
} from '../../modules/panzeri-apple-health/src';
import { AppleEligibility, ApplePrepare, AppleWatchApi, appleWatchAvailability, sendResultMessage, sendSessionToAppleWatch } from './sendSessionToAppleWatch';

// "Enviar ao Apple Watch" no card da sessao prescrita. So' no app nativo iOS e SO' quando a API (tradutor Apple) consegue representar a corrida
// sem inventar informacao: continua, varias partes e intervalados por distancia (CustomWorkout). Qualquer outra coisa nao mostra o botao. A
// identidade da entrega e' persistente no servidor (WorkoutDelivery); tocar de novo nao cria outro workout. Agendar no WorkoutKit nao significa
// que o treino foi executado.

export function AppleWatchSendButton({ sessionId, accessToken, apiUrl }: { sessionId: string; accessToken: string; apiUrl: string }) {
  const [eligibility, setEligibility] = useState<AppleEligibility | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false); // trava o duplo toque antes mesmo do estado atualizar

  const call = useCallback(
    async (method: 'GET' | 'POST', path: string, body?: unknown) => {
      const response = await fetch(`${apiUrl}/me/apple-watch/${path}`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    [apiUrl, accessToken],
  );

  const loadEligibility = useCallback(async () => {
    try {
      setEligibility((await call('GET', `sessions/${sessionId}/eligibility`)) as AppleEligibility);
    } catch (error) {
      // Nao esconde a falha em silencio: o card diz que nao conseguiu verificar (com o codigo), em vez de o botao sumir sem explicacao.
      setEligibility({ error: error instanceof Error ? error.message : 'erro' });
    }
  }, [call, sessionId]);

  useEffect(() => {
    if (isAppleHealthSupported) void loadEligibility();
  }, [loadEligibility]);

  if (!isAppleHealthSupported) return null;
  const availability = appleWatchAvailability(eligibility);
  if (availability.show === 'nothing') return null;
  if (availability.show === 'note') return <Text style={styles.hint}>{availability.note}</Text>;
  if (!eligibility || 'error' in eligibility || !eligibility.eligible) return null;

  const status = eligibility.delivery?.status ?? null;
  const alreadySent = status === 'sent' || status === 'delivered_to_device';

  const api: AppleWatchApi = {
    prepare: (id) => call('POST', `sessions/${id}/deliveries`) as Promise<ApplePrepare>,
    confirmSent: (deliveryId) => call('POST', `deliveries/${deliveryId}/sent`),
    reportFailure: (deliveryId, failure) => call('POST', `deliveries/${deliveryId}/failed`, { message: failure }),
  };

  async function onPress() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendSessionToAppleWatch(sessionId, api, {
        isSupported: isAppleHealthSupported,
        validateCustomWorkoutSpec,
        requestAuthorization: requestWorkoutAuthorization,
        listScheduled: listScheduledWorkouts,
        scheduleCustomWorkout: (planId, specJson, date) => scheduleCustomWorkoutSpec(planId, specJson, date),
      });
      setMessage(sendResultMessage(result));
      await loadEligibility();
    } catch {
      setMessage('Não foi possível enviar agora. Tente novamente.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable style={[styles.button, (busy || alreadySent) && styles.buttonDisabled]} disabled={busy || alreadySent} onPress={onPress}>
        {busy ? <ActivityIndicator size="small" color="#0B3D5C" /> : null}
        <Text style={styles.buttonText}>{alreadySent ? 'Enviado ao Apple Watch ✓' : 'Enviar ao Apple Watch'}</Text>
      </Pressable>
      {eligibility.delivery?.outdated && alreadySent ? <Text style={styles.hint}>A prescrição mudou depois do envio.</Text> : null}
      {message ? <Text style={styles.hint}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 6, gap: 4 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#0B3D5C', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#0B3D5C', fontWeight: '700', fontSize: 14 },
  hint: { fontSize: 12, color: '#475569' },
});
