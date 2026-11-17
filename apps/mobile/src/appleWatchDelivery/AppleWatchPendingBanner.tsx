import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '../PtText';
import { isAppleHealthSupported } from '../../modules/panzeri-apple-health/src';
import { AUTO_SEND_STORAGE_KEY, syncSummaryMessage } from './autoSendWeekToAppleWatch';
import { makeWatchCall, syncWeekToAppleWatch } from './syncWeekNow';

// Aviso na tela da semana (16/11/2026, caso Volnei): quem ja' autorizou o envio ao Apple Watch ve quantos treinos dos proximos 7 dias AINDA NAO estao no relogio e envia com um toque. So' aparece no
// iPhone nativo, so' para quem autorizou, e some quando tudo ja' foi enviado. O envio so' acontece com o Panzeri Run aberto, por isso o aviso fica aqui, onde a aluna ja' esta.
export function AppleWatchPendingBanner({ accessToken, apiUrl, refreshKey }: { accessToken: string; apiUrl: string; refreshKey?: unknown }) {
  const [status, setStatus] = useState<{ upcoming: number; sent: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAppleHealthSupported) return;
    try {
      if ((await AsyncStorage.getItem(AUTO_SEND_STORAGE_KEY)) !== '1') { setStatus(null); return; }
      const call = makeWatchCall(apiUrl, accessToken);
      const data = (await call('GET', '/me/apple-watch/upcoming-status')) as { upcoming?: number; sent?: number };
      if (typeof data.upcoming === 'number' && typeof data.sent === 'number') setStatus({ upcoming: data.upcoming, sent: data.sent });
    } catch {
      // melhor esforco: sem o aviso, o cartao de Apple Watch continua valendo
    }
  }, [accessToken, apiUrl]);

  // espera um pouco: o envio automatico ao abrir o app roda primeiro, e o aviso so' fica se sobrar treino
  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 6000);
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  const onSend = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const summary = await syncWeekToAppleWatch(makeWatchCall(apiUrl, accessToken));
      setMessage(syncSummaryMessage(summary));
      await load();
    } catch {
      setMessage('Não foi possível enviar agora. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }, [accessToken, apiUrl, busy, load]);

  if (!isAppleHealthSupported || !status || status.upcoming === 0 || status.sent >= status.upcoming) return null;
  const missing = status.upcoming - status.sent;
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{missing === 1 ? '1 treino ainda não está no seu Apple Watch' : `${missing} treinos ainda não estão no seu Apple Watch`}</Text>
      <Pressable style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={() => void onSend()} accessibilityRole="button">
        {busy ? <ActivityIndicator size="small" color="#0B3D5C" /> : null}
        <Text style={styles.buttonText}>Enviar ao relógio agora</Text>
      </Pressable>
      {message ? <Text style={styles.hint}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 12, gap: 8, backgroundColor: '#FFFFFF', marginBottom: 12 },
  title: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#0B3D5C', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#0B3D5C', fontWeight: '700', fontSize: 14 },
  hint: { fontSize: 12, color: '#475569' },
});
