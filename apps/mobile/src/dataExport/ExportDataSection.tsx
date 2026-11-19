import React, { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import { PRColors } from '../../theme/tokens';

// "Baixar meus dados" (19/11/2026, ordem de Elton): a aluna recebe um arquivo com tudo que o Panzeri Run guarda dela, inclusive o que veio de cada integracao (relogios e plataformas). O servidor monta o arquivo
// (GET /me/account/data-export) e NAO inclui senhas nem chaves de acesso. No navegador baixa como arquivo; no aplicativo abre o compartilhamento do celular (salvar em Arquivos, enviar por e-mail etc.).
export function ExportDataSection({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const running = useRef(false); // trava o duplo toque antes do estado atualizar

  async function exportData() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(`${apiUrl}/me/account/data-export`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.status === 429) throw new Error('muitas');
      if (!response.ok) throw new Error('status');
      const text = await response.text();
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'meus-dados-panzeri-run.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } else {
        await Share.share({ title: 'Meus dados do Panzeri Run', message: text });
      }
      setNote({ ok: true, text: 'Pronto. O arquivo tem seus dados e o que veio das suas integrações.' });
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error && error.message === 'muitas' ? 'Você pediu várias vezes seguidas. Aguarde um minuto e tente de novo.' : 'Não consegui gerar o arquivo agora. Tente de novo em instantes.' });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Baixar meus dados</Text>
      <Text style={styles.hint}>Receba um arquivo com tudo que o Panzeri Run guarda de você, inclusive o que veio de relógios e plataformas conectadas. Senhas e chaves de acesso não entram no arquivo.</Text>
      <Pressable onPress={() => void exportData()} disabled={busy} accessibilityRole="button" style={[styles.button, busy && { opacity: 0.6 }]}>
        {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Baixar meus dados</Text>}
      </Pressable>
      {note ? <Text style={[styles.hint, { color: note.ok ? '#166534' : '#b91c1c' }]}>{note.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, padding: 16, borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0' },
  title: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  hint: { fontSize: 13, color: '#475569' },
  button: { paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: PRColors.ocean },
  buttonText: { color: '#ffffff', fontWeight: '800' },
});
