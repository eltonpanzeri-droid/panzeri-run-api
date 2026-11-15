import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { HomeRadius } from './homeTheme';
import { modalityName, modalityTint } from './chartData';

// Seletor de modalidade dos gráficos (15/11/2026, pedido de Elton): fica em destaque, cada modalidade tem a sua cor e uma faixa diz o que está sendo mostrado. Os números e os textos sob o gráfico
// acompanham a modalidade escolhida (a leitura vem do servidor, separada por modalidade). null = todas as modalidades juntas.
export function ModalityPicker({ modalities, selected, onSelect }: { modalities: string[]; selected: string | null; onSelect: (modality: string | null) => void }) {
  const tint = modalityTint(selected);
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.title}>Escolha a modalidade</Text>
      <View style={styles.chips}>
        {[null, ...modalities].map((m) => {
          const active = selected === m;
          const color = modalityTint(m);
          return (
            <Pressable key={m ?? 'todas'} onPress={() => onSelect(m)} accessibilityRole="button" accessibilityState={{ selected: active }}
              style={[styles.chip, { borderColor: color }, active && { backgroundColor: color }]}>
              <Text style={[styles.chipText, { color }, active && { color: '#FFFFFF' }]}>{m ? modalityName(m) : 'Todas'}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.banner, { borderLeftColor: tint, backgroundColor: tint + '14' }]}>
        <Text style={[styles.bannerTitle, { color: tint }]}>{selected ? `Você está vendo: ${modalityName(selected)}` : 'Você está vendo: todas as modalidades juntas'}</Text>
        <Text style={styles.bannerText}>{selected ? 'O gráfico, os números e os textos abaixo mostram só esta modalidade.' : 'O gráfico, os números e os textos abaixo somam todas as modalidades. Escolha uma para ver cada uma separada.'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 13, fontWeight: '800', color: '#0B2A4A' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 2, backgroundColor: '#FFFFFF' },
  chipText: { fontSize: 13, fontWeight: '800' },
  banner: { borderLeftWidth: 6, borderRadius: HomeRadius.small, paddingVertical: 8, paddingHorizontal: 12, gap: 2 },
  bannerTitle: { fontSize: 14, fontWeight: '800' },
  bannerText: { fontSize: 12, lineHeight: 17, color: '#475569' },
});
