import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '../PtText';

// "Qual gravacao vale?" (21/11/2026, Elton). Aparece no treino realizado quando ele foi gravado no Panzeri Run E por um relogio. Por padrao vale o do Panzeri Run (a aluna apertou iniciar nos dois lugares); ela pode
// escolher o do relogio no lugar (a gravacao do Panzeri Run continua guardada) e voltar atras. Os dados vem do servidor (plan.recordingChoices); o texto e' o aprovado por Elton.

export interface RecordingAlternativeView { activityLogId: string; provider: string; label: string; durationMin: number | null; distanceKm: number | null; avgHeartRateBpm: number | null; hasCadence: boolean; hasPower: boolean; hasRoute: boolean; moreData: boolean }
export interface RecordingChoiceView { currentProvider: string; currentIsOwn: boolean; chosenByStudent: boolean; alternatives: RecordingAlternativeView[] }

const DISMISS_PREFIX = 'panzeri-run:recording-choice-dismissed:';

function describe(alt: RecordingAlternativeView): string {
  const parts = [
    alt.durationMin !== null ? `${alt.durationMin} min` : null, alt.distanceKm !== null ? `${String(alt.distanceKm).replace('.', ',')} km` : null,
    alt.avgHeartRateBpm !== null ? `FC média ${alt.avgHeartRateBpm} bpm` : null, alt.hasCadence ? 'cadência' : null, alt.hasPower ? 'potência' : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function RecordingChoiceCard({ apiUrl, accessToken, activityLogId, choice, onChanged }: { apiUrl: string; accessToken: string; activityLogId: string; choice: RecordingChoiceView; onChanged: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { void AsyncStorage.getItem(`${DISMISS_PREFIX}${activityLogId}`).then((value) => setDismissed(value === '1')).catch(() => undefined); }, [activityLogId]);

  const choose = async (targetId: string, value: boolean) => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`${apiUrl}/me/activity-reconciliation/${targetId}/canonical-choice`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ choose: value }),
      });
      if (!response.ok) { setMessage('Não consegui salvar agora. Tente de novo.'); return; }
      onChanged();
    } catch { setMessage('Sem conexão. Tente de novo.'); } finally { setBusy(false); }
  };
  const dismiss = () => { setDismissed(true); void AsyncStorage.setItem(`${DISMISS_PREFIX}${activityLogId}`, '1').catch(() => undefined); };

  if (choice.currentIsOwn) {
    if (dismissed) return null;
    const alt = choice.alternatives[0];
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Este treino também foi gravado pelo relógio</Text>
        <Text style={styles.text}>Você registrou este treino pelo Panzeri Run. Se vincular este do relógio, ele substitui a gravação do Panzeri Run. Recomendamos o do relógio quando ele registra mais dados como frequência cardíaca, potência ou cadência.</Text>
        {choice.alternatives.map((item) => (
          <Text key={item.activityLogId} style={styles.alt}>{item.label}{describe(item) ? ` — ${describe(item)}` : ''}{item.moreData ? ' · tem dados a mais' : ''}</Text>
        ))}
        <Text style={styles.hint}>Enquanto isso, conta a gravação do Panzeri Run. Os treinos do relógio não somam em dobro.</Text>
        <Pressable style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={() => void choose(alt.activityLogId, true)} accessibilityRole="button">
          {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
          <Text style={styles.primaryText}>Usar o do relógio no lugar</Text>
        </Pressable>
        <Pressable style={styles.secondary} disabled={busy} onPress={dismiss} accessibilityRole="button"><Text style={styles.secondaryText}>Manter o do Panzeri Run</Text></Pressable>
        {message ? <Text style={styles.warn}>{message}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Você escolheu o registro do relógio</Text>
      <Text style={styles.text}>Para este treino conta o registro do relógio. A gravação do Panzeri Run continua guardada.</Text>
      <Pressable style={[styles.secondary, busy && styles.disabled]} disabled={busy} onPress={() => void choose(activityLogId, false)} accessibilityRole="button">
        <Text style={styles.secondaryText}>Voltar ao registro do Panzeri Run</Text>
      </Pressable>
      {message ? <Text style={styles.warn}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#BAE6FD', backgroundColor: '#F0F9FF', borderRadius: 12, padding: 12, gap: 8, marginTop: 8 },
  title: { fontSize: 14, fontWeight: '800', color: '#0C4A6E' },
  text: { fontSize: 13, color: '#0F172A' },
  alt: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  hint: { fontSize: 12, color: '#475569' },
  warn: { fontSize: 12, color: '#B42318', fontWeight: '600' },
  primary: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B3D5C', borderRadius: 10, paddingVertical: 11 },
  primaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  secondary: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#0B3D5C', borderRadius: 10, paddingVertical: 10, backgroundColor: '#FFFFFF' },
  secondaryText: { color: '#0B3D5C', fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.5 },
});
