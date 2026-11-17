import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../PtText';

// Cartao "Relógio Wear OS" (17/11/2026, fase 1 do Wear OS; liberado para todas as alunas, com aviso de funcionalidade nova na tela). A aluna digita o codigo que aparece no relogio e o conecta; ve os relogios conectados e pode retirar cada um. O relogio recebe
// uma credencial propria, so' para LER os treinos dela. Nenhuma senha e' digitada no relogio. Fica na tela Samsung / Galaxy Watch.

interface WearDeviceView { id: string; name: string; pairedAt: string | null; lastSeenAt: string | null }

const formatCode = (raw: string) => {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
};
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

async function errorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string | string[] };
    return Array.isArray(data.message) ? data.message.join(' ') : data.message || 'Tente de novo.';
  } catch {
    return 'Tente de novo.';
  }
}

export function WearOsPairingCard({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [devices, setDevices] = useState<WearDeviceView[] | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/me/wear/devices`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.ok) setDevices((await response.json()) as WearDeviceView[]);
    } catch {
      // sem a lista, a conexao por codigo continua valendo
    }
  }, [accessToken, apiUrl]);
  useEffect(() => { void load(); }, [load]);

  const connect = useCallback(async () => {
    if (busy || code.replace('-', '').length < 8) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${apiUrl}/me/wear/pairing/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) { setMessage(await errorMessage(response)); return; }
      setCode('');
      setMessage('Relógio conectado. Em instantes ele mostra os seus treinos.');
      await load();
    } catch {
      setMessage('Não consegui conectar agora. Verifique a internet e tente de novo.');
    } finally {
      setBusy(false);
    }
  }, [accessToken, apiUrl, busy, code, load]);

  const remove = useCallback(async (id: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${apiUrl}/me/wear/devices/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
      setMessage(response.ok ? 'Relógio retirado. Ele não recebe mais os seus treinos.' : await errorMessage(response));
      await load();
    } catch {
      setMessage('Não consegui retirar agora. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }, [accessToken, apiUrl, busy, load]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Relógio Wear OS</Text>
      <Text style={styles.text}>Para ver os seus treinos direto no Galaxy Watch (ou outro relógio Wear OS), abra o aplicativo Panzeri Run no relógio, anote o código que ele mostra e digite aqui. Você não digita senha no relógio e pode retirar o relógio quando quiser.</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(value) => setCode(formatCode(value))}
        placeholder="Código do relógio (ex.: AB3K-7MPQ)"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={9}
        accessibilityLabel="Código do relógio"
      />
      <Pressable style={[styles.button, (busy || code.replace('-', '').length < 8) && styles.buttonDisabled]} disabled={busy || code.replace('-', '').length < 8} onPress={() => void connect()} accessibilityRole="button">
        {busy ? <ActivityIndicator size="small" color="#0B3D5C" /> : null}
        <Text style={styles.buttonText}>Conectar relógio</Text>
      </Pressable>
      {message ? <Text style={styles.hint}>{message}</Text> : null}
      {devices && devices.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.subtitle}>Relógios conectados</Text>
          {devices.map((device) => (
            <View key={device.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{device.name}</Text>
                <Text style={styles.hint}>{device.lastSeenAt ? `Visto em ${dmy(device.lastSeenAt)}` : 'Ainda não consultou os treinos'}</Text>
              </View>
              <Pressable style={[styles.removeButton, busy && styles.buttonDisabled]} disabled={busy} onPress={() => void remove(device.id)} accessibilityRole="button">
                <Text style={styles.removeText}>Retirar</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14, gap: 10, backgroundColor: '#FFFFFF', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  subtitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  text: { fontSize: 13, color: '#475569' },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 16, letterSpacing: 2, color: '#0F172A' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#0B3D5C', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#0B3D5C', fontWeight: '700', fontSize: 14 },
  hint: { fontSize: 12, color: '#475569' },
  list: { gap: 8, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowText: { flex: 1 },
  rowName: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  removeButton: { borderWidth: 1, borderColor: '#B42318', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  removeText: { color: '#B42318', fontWeight: '700', fontSize: 13 },
});
