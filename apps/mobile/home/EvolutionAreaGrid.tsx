import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { Ionicons } from '@expo/vector-icons';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';

// As seis áreas da Evolução (02/11/2026, ordem de Elton: ficam na tela principal, em grade de duas colunas). Uma lista só: a Home e a aba "Evolução" usam esta mesma.

export type EvolutionAreaId = 'training' | 'load' | 'sleep' | 'wellbeing' | 'pain' | 'adherence';

export const EVOLUTION_AREAS: Array<{ id: EvolutionAreaId; title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'training', title: 'Evolução do treinamento', subtitle: 'Volume, ritmo e execução', icon: 'stats-chart-outline' },
  { id: 'load', title: 'Resposta à carga', subtitle: 'Esforço e resposta cardiovascular', icon: 'pulse-outline' },
  { id: 'sleep', title: 'Sono e recuperação', subtitle: 'Sono e variabilidade cardíaca', icon: 'moon-outline' },
  { id: 'wellbeing', title: 'Bem-estar', subtitle: 'Fadiga, estresse e motivação', icon: 'heart-outline' },
  { id: 'pain', title: 'Dor', subtitle: 'Ocorrências e evolução', icon: 'shield-outline' },
  { id: 'adherence', title: 'Aderência', subtitle: 'Consistência e participação', icon: 'checkbox-outline' },
];

export function EvolutionAreaGrid({ onOpenArea }: { onOpenArea: (area: EvolutionAreaId) => void }) {
  return (
    <View style={styles.grid}>
      {EVOLUTION_AREAS.map((a) => (
        <Pressable key={a.id} onPress={() => onOpenArea(a.id)} style={[styles.cell, HomeBorder.card]}>
          <Ionicons name={a.icon} size={20} color={HomeColors.textSecondary} />
          <View>
            <Text style={styles.title}>{a.title}</Text>
            <Text style={styles.subtitle}>{a.subtitle}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: HomeSpace.related },
  cell: { width: '48%', flexGrow: 1, minHeight: 104, justifyContent: 'space-between', gap: 14, backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component },
  title: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  subtitle: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, marginTop: 4, lineHeight: 16 },
});
