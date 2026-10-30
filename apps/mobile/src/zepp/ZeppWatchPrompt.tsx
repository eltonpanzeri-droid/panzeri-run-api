import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import { PRColors } from '../../theme/tokens';

// Convite na tela de Treinos (30/10/2026): a aluna que JA' conectou a Zepp mas ainda nao autorizou o envio de treinos ao relogio ve um aviso com o caminho para a tela de
// autorizacao (a autorizacao em si continua sendo a tela propria `watch_delivery`, com texto, versao e hash registrados pelo servidor; este componente nao concede nada).
// So' aparece quando: a integracao esta disponivel para a aluna, a conta esta conectada e o envio ainda nao foi autorizado. Qualquer falha => nada aparece.
// "Agora nao" esconde so' ate' o app recarregar (nada e' guardado), para o convite voltar a aparecer enquanto a autorizacao nao existir.
interface PermissionsShape { connected?: boolean; purposes?: Array<{ id: string; granted: boolean; available?: boolean }> }

export function ZeppWatchPrompt({ accessToken, apiUrl, onOpen }: { accessToken: string; apiUrl: string; onOpen: () => void }) {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(`${apiUrl}/zepp/permissions`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!response.ok) return;
        const permissions = (await response.json()) as PermissionsShape;
        const watch = permissions.purposes?.find((purpose) => purpose.id === 'watch_delivery');
        if (alive && permissions.connected === true && watch && !watch.granted && watch.available !== false) setShow(true);
      } catch {
        /* sem o estado, o convite simplesmente nao aparece */
      }
    })();
    return () => { alive = false; };
  }, [accessToken, apiUrl]);

  if (!show || dismissed) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Receba seus treinos no relógio</Text>
      <Text style={styles.body}>Sua conta Zepp está conectada, mas o envio dos treinos ao seu Amazfit ainda não foi autorizado. A autorização é opcional, tem tela própria e você pode retirá-la quando quiser.</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={onOpen} style={styles.primary}><Text style={styles.primaryText}>Ver e autorizar</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setDismissed(true)} style={styles.secondary}><Text style={styles.secondaryText}>Agora não</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderWidth: 1, borderColor: PRColors.ocean, borderRadius: 10, gap: 8, backgroundColor: '#fff' },
  title: { fontSize: 15, fontWeight: '800', color: PRColors.ocean },
  body: { fontSize: 13, color: PRColors.slate },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  primary: { backgroundColor: PRColors.ocean, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  secondary: { paddingVertical: 10, paddingHorizontal: 8 },
  secondaryText: { color: PRColors.slate, fontWeight: '600', fontSize: 13 },
});
