import React from 'react';
import { Platform, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppUpdate } from './useAppUpdate';

// Faixa discreta no topo, so' na web e so' quando ha versao nova e o app nao pode recarregar sozinho (aluna digitando ou ja recarregou para esta versao).
export function AppUpdateBanner() {
  const { updateAvailable, applyUpdate } = useAppUpdate();
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'web' || !updateAvailable) return null;
  return (
    <Pressable
      onPress={applyUpdate}
      accessibilityRole="button"
      accessibilityLabel="Nova versão disponível. Atualizar"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9999, paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 12, backgroundColor: '#0F172A', alignItems: 'center' }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>Nova versão disponível, Atualizar</Text>
    </Pressable>
  );
}
