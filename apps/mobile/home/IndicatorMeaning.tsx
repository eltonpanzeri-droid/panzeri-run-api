import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../src/PtText';
import { HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { MEANING_FOOTER, MEANING_TITLE, meaningOf } from './indicatorMeanings';

// Bloco "O que isso representa" sob cada indicador (02/11/2026). Texto fixo e igual para todas as alunas (indicatorMeanings.ts, rascunho em revisao): explica o indicador e o que ele nao
// permite concluir. Abre expandido (como no desenho de Elton) e pode ser recolhido para encurtar a tela. Sem texto escrito para o id, nao mostra nada.
export function IndicatorMeaning({ id }: { id: string | undefined | null }) {
  const [open, setOpen] = useState(true);
  const text = meaningOf(id);
  if (!text) return null;
  return (
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
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.small, padding: HomeSpace.related, gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...HomeTypography.label, color: HomeColors.panzeriPrimary },
  text: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 21 },
  footer: { ...HomeTypography.tertiary, color: HomeColors.textTertiary },
});
