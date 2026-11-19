import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from '../PtText';
import { PRColors } from '../../theme/tokens';

// Preferencias de notificacao (19/11/2026, ordem de Elton): a aluna escolhe quais temas quer receber, quantos por dia em cada tema (1 a 2, 3 a 4 ou 5 a 6), o maximo geral por dia e o horario.
// O servidor e' a fonte dos temas, das faixas e do padrao (GET /me/notification-preferences); esta tela so' mostra e envia a escolha.
interface Category { id: string; label: string }
interface Band { id: string; label: string }
interface CategoryPref { enabled: boolean; band: string }
interface Prefs { dailyCap: number; windowStartHour: number; windowEndHour: number; categories: Record<string, CategoryPref> }
interface ScreenData { preferences: Prefs; categories: Category[]; bands: Band[]; defaults: Prefs }

const CAP_OPTIONS = [0, 5, 10, 20];
const START_OPTIONS = [5, 6, 7, 8, 9];
const END_OPTIONS = [18, 19, 20, 21, 22];
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function NotificationPreferencesScreen({ apiUrl, accessToken }: { apiUrl: string; accessToken: string }) {
  const [data, setData] = useState<ScreenData | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/me/notification-preferences`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('status');
      const body = (await response.json()) as ScreenData;
      setData(body);
      setPrefs(body.preferences);
    } catch {
      setNote({ ok: false, text: 'Não consegui carregar suas preferências agora. Tente de novo em instantes.' });
    }
  }, [apiUrl, accessToken]);
  useEffect(() => { void load(); }, [load]);

  async function save(next: Prefs) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(`${apiUrl}/me/notification-preferences`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error('status');
      const body = (await response.json()) as ScreenData;
      setData(body);
      setPrefs(body.preferences);
      setNote({ ok: true, text: 'Preferências salvas.' });
    } catch {
      setNote({ ok: false, text: 'Não consegui salvar agora. Suas escolhas continuam na tela; toque em salvar de novo.' });
    } finally {
      setBusy(false);
    }
  }

  if (!data || !prefs) {
    return <View style={styles.box}>{note ? <Text style={[styles.hint, { color: '#b91c1c' }]}>{note.text}</Text> : <ActivityIndicator />}</View>;
  }

  const setCategory = (id: string, patch: Partial<CategoryPref>) => setPrefs({ ...prefs, categories: { ...prefs.categories, [id]: { ...prefs.categories[id], ...patch } } });

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Notificações</Text>
      <Text style={styles.hint}>Escolha o que você quer receber do Panzeri Run. O máximo por dia é um teto: não significa que vamos enviar tudo isso.</Text>

      <Text style={styles.section}>Temas</Text>
      {data.categories.map((category) => {
        const pref = prefs.categories[category.id] ?? data.defaults.categories[category.id];
        return (
          <View key={category.id} style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.rowLabel}>{category.label}</Text>
              <Switch value={pref.enabled} onValueChange={(value) => setCategory(category.id, { enabled: value })} />
            </View>
            {pref.enabled ? (
              <View style={styles.chips}>
                {data.bands.map((band) => <Chip key={band.id} label={band.label} active={pref.band === band.id} onPress={() => setCategory(category.id, { band: band.id })} />)}
              </View>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.section}>Máximo de avisos por dia</Text>
      <View style={styles.chips}>
        {CAP_OPTIONS.map((cap) => <Chip key={cap} label={cap === 0 ? 'Pausar todos' : String(cap)} active={prefs.dailyCap === cap} onPress={() => setPrefs({ ...prefs, dailyCap: cap })} />)}
      </View>

      <Text style={styles.section}>Receber a partir das</Text>
      <View style={styles.chips}>
        {START_OPTIONS.map((hour) => <Chip key={hour} label={hourLabel(hour)} active={prefs.windowStartHour === hour} onPress={() => setPrefs({ ...prefs, windowStartHour: hour })} />)}
      </View>
      <Text style={styles.section}>Receber até as</Text>
      <View style={styles.chips}>
        {END_OPTIONS.map((hour) => <Chip key={hour} label={hourLabel(hour)} active={prefs.windowEndHour === hour} onPress={() => setPrefs({ ...prefs, windowEndHour: hour })} />)}
      </View>

      {note ? <Text style={[styles.hint, { color: note.ok ? '#166534' : '#b91c1c', marginTop: 8 }]}>{note.text}</Text> : null}
      <View style={styles.actions}>
        <Pressable onPress={() => void save(prefs)} disabled={busy} accessibilityRole="button" style={[styles.save, busy && { opacity: 0.6 }]}>
          <Text style={styles.saveText}>{busy ? 'Salvando…' : 'Salvar preferências'}</Text>
        </Pressable>
        <Pressable onPress={() => setPrefs(data.defaults)} disabled={busy} accessibilityRole="button" style={styles.reset}>
          <Text style={styles.resetText}>Voltar ao padrão</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10, padding: 16, borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0' },
  title: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  hint: { fontSize: 13, color: '#475569' },
  section: { marginTop: 8, fontSize: 13, fontWeight: '800', color: '#0f172a' },
  row: { gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0f172a' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: PRColors.ocean },
  chipActive: { backgroundColor: PRColors.ocean },
  chipText: { fontSize: 13, fontWeight: '600', color: PRColors.ocean },
  chipTextActive: { color: '#ffffff' },
  actions: { gap: 8, marginTop: 8 },
  save: { paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: PRColors.ocean },
  saveText: { color: '#ffffff', fontWeight: '800' },
  reset: { paddingVertical: 10, alignItems: 'center' },
  resetText: { color: PRColors.ocean, fontWeight: '600' },
});
