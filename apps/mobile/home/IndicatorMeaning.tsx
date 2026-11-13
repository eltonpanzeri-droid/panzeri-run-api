import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../src/PtText';
import { HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { MEANING_FOOTER, MEANING_TITLE, meaningOf } from './indicatorMeanings';
import { useIndicatorReading } from './evolutionReading';

// Sob cada gráfico (14/11/2026, pedido de Elton): (1) "O seu caso" = a leitura DESTA aluna para ESTE gráfico (padrão, tendência e o que indica), curta e sempre visível, vinda do servidor; (2) "O que isso
// representa" = explicação geral, longa, RECOLHIDA por padrão para não empurrar o resto da tela. Fora do EvolutionHub (sem leitura) só aparece a explicação geral. Sem texto para o id, não mostra nada.
export function IndicatorReadingText({ id }: { id: string | undefined | null }) {
  const reading = useIndicatorReading(id);
  if (!reading) return null;
  const pattern = `${reading.texts.habitual}${reading.texts.trend ? ` ${reading.texts.trend}` : ''}`;
  return (
    <View style={styles.personal}>
      <Text style={styles.personalLabel}>O seu caso</Text>
      <Text style={styles.personalText}>{pattern}</Text>
      {reading.texts.meaning ? <Text style={styles.personalText}>{reading.texts.meaning}</Text> : null}
    </View>
  );
}

export function IndicatorMeaning({ id, showReading = true }: { id: string | undefined | null; showReading?: boolean }) {
  const [open, setOpen] = useState(false);
  const text = meaningOf(id);
  return (
    <View style={{ gap: HomeSpace.related }}>
      {showReading ? <IndicatorReadingText id={id} /> : null}
      {text ? (
        <View style={styles.box}>
          <Pressable onPress={() => setOpen((v) => !v)} style={styles.head} accessibilityRole="button" accessibilityLabel={`${MEANING_TITLE}: ${open ? 'recolher' : 'expandir'}`}>
            <Text style={styles.title}>{MEANING_TITLE}</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={HomeColors.textTertiary} />
          </Pressable>
          {open ? (
            <>
              <Text style={styles.text}>{text}</Text>
              <Text style={styles.footer}>{MEANING_FOOTER}</Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.small, padding: HomeSpace.related, gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...HomeTypography.label, color: HomeColors.panzeriPrimary },
  text: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 21 },
  footer: { ...HomeTypography.tertiary, color: HomeColors.textTertiary },
  personal: { gap: 4, paddingHorizontal: 2 },
  personalLabel: { ...HomeTypography.label, color: HomeColors.textSecondary },
  personalText: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 20 },
});
