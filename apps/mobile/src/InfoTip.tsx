import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './PtText';
import { Ionicons } from '@expo/vector-icons';

// Pequeno ícone circular de informação: ao tocar, abre uma explicação curta logo abaixo (e fecha ao tocar de novo). Use só onde a explicação ajuda o aluno a entender uma informação ou decisão.
export function InfoTip({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setOpen((value) => !value)} accessibilityRole="button" accessibilityLabel={`Entenda: ${label}`} accessibilityState={{ expanded: open }} hitSlop={8} style={styles.row}>
        <Ionicons name="information-circle-outline" size={18} color="#246F91" />
        <Text style={styles.label}>{label}</Text>
      </Pressable>
      {open ? <Text style={styles.body}>{children}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 13, color: '#246F91', fontWeight: '600' },
  body: { fontSize: 12, color: '#4a5560', lineHeight: 17 },
});
