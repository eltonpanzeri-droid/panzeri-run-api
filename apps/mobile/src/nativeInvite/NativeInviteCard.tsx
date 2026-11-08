import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import { PRColors } from '../../theme/tokens';
import { detectInvitePlatform, NATIVE_INVITE_DISMISS_KEY, nativeInviteStores, shouldShowNativeInvite } from './nativeInviteLogic';

// Aviso "Baixe o Panzeri Run na loja" (08/11/2026). Só aparece no navegador/PWA e some por 7 dias quando dispensado. Falha de armazenamento nunca esconde nem quebra a tela.
function readDismissedAt(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(NATIVE_INVITE_DISMISS_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
}

export function NativeInviteCard({ apiUrl }: { apiUrl: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    setVisible(shouldShowNativeInvite(readDismissedAt(), Date.now()));
  }, []);
  if (Platform.OS !== 'web' || !visible) return null;

  const platform = detectInvitePlatform(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const stores = nativeInviteStores(apiUrl, platform);
  const dismiss = () => {
    try { globalThis.localStorage?.setItem(NATIVE_INVITE_DISMISS_KEY, String(Date.now())); } catch { /* sem armazenamento: some só nesta visita */ }
    setVisible(false);
  };
  const open = (url: string) => { try { window.open(url, '_blank'); } catch { window.location.href = url; } };

  return (
    <View style={styles.card} accessibilityRole="summary">
      <Text style={styles.title}>Baixe o Panzeri Run na loja do seu celular</Text>
      <Text style={styles.body}>Atualizações automáticas, sem reinstalar o ícone; sincronização dos treinos do seu relógio (Apple Saúde ou Health Connect); e avisos no celular quando o seu programa de treino da semana ficar pronto. Entre com o mesmo e-mail e a mesma senha.</Text>
      <View style={styles.actions}>
        {stores.map((store) => (
          <Pressable key={store.key} accessibilityRole="link" style={styles.primary} onPress={() => open(store.url)}>
            <Text style={styles.primaryText}>{store.label}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={dismiss}>
          <Text style={styles.secondaryText}>Agora não</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: PRColors.ocean, borderRadius: 8, backgroundColor: '#ffffff', padding: 16, marginBottom: 12, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: PRColors.mineral },
  body: { fontSize: 14, lineHeight: 20, color: PRColors.mineral },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  primary: { minHeight: 44, paddingHorizontal: 16, borderRadius: 8, backgroundColor: PRColors.ocean, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  secondary: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: PRColors.ocean, fontWeight: '600', fontSize: 14 },
});
