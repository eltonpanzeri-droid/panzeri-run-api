import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';

// Aviso fixo no alto da tela do relógio Wear OS (17/11/2026, ordem de Elton): a integração está liberada para todas as alunas, mas é uma funcionalidade NOVA que ainda estamos melhorando. Pede que
// erros e sugestões sejam enviados em "Relatar problema" (menu do Panzeri Run). O botão leva direto a essa tela quando o app informa como chegar lá.
export function WearOsNotice({ onOpenProblemReport }: { onOpenProblemReport?: () => void }) {
  return (
    <View style={styles.box} accessibilityRole="summary">
      <Text style={styles.title}>Funcionalidade nova</Text>
      <Text style={styles.text}>
        O aplicativo do Panzeri Run para relógios Wear OS (Galaxy Watch e outros) é uma novidade, e estamos trabalhando para melhorá-lo. Se você notar algum erro ou tiver alguma sugestão, envie em “Relatar problema”.
      </Text>
      {onOpenProblemReport ? (
        <Pressable style={styles.button} onPress={onOpenProblemReport} accessibilityRole="button">
          <Text style={styles.buttonText}>Relatar problema</Text>
        </Pressable>
      ) : (
        <Text style={styles.text}>Você encontra “Relatar problema” no menu do Panzeri Run.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: '#BAE6FD', borderRadius: 12, padding: 14, gap: 8, backgroundColor: '#F0F9FF', marginBottom: 12 },
  title: { fontSize: 15, fontWeight: '700', color: '#0C4A6E' },
  text: { fontSize: 13, color: '#0C4A6E' },
  button: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#0B3D5C', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  buttonText: { color: '#0B3D5C', fontWeight: '700', fontSize: 14 },
});
