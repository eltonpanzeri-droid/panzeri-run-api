import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../src/PtText';
import { HomeColors, HomeRadius, HomeSpace } from './homeTheme';

// Blocos do desenho de Elton (14/11/2026) para as GRANDES ÁREAS e para cada GRÁFICO: botões grandes e bem destacados que abrem e fecham. O primeiro ("O que é?") começa aberto; os demais, fechados.
// Aberto = botão cheio (azul escuro, texto branco); fechado = contorno azul. Textos maiores que o padrão do Panzeri Run, de propósito. Só apresenta: todo o conteúdo vem do servidor.
export interface GuideSection { id: string; title: string; defaultOpen?: boolean; content: React.ReactNode }

export function GuideAccordion({ sections }: { sections: GuideSection[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(sections.filter((section) => section.defaultOpen).map((section) => [section.id, true])));
  return (
    <View style={styles.list}>
      {sections.map((section) => {
        const isOpen = !!open[section.id];
        return (
          <View key={section.id} style={styles.item}>
            <Pressable
              onPress={() => setOpen((current) => ({ ...current, [section.id]: !current[section.id] }))}
              style={[styles.head, isOpen && styles.headOpen]}
              accessibilityRole="button"
              accessibilityLabel={`${section.title}: ${isOpen ? 'recolher' : 'expandir'}`}
              accessibilityState={{ expanded: isOpen }}
            >
              <Text style={[styles.headText, isOpen && styles.headTextOpen]}>{section.title}</Text>
              <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={22} color={isOpen ? '#FFFFFF' : HomeColors.panzeriInteraction} />
            </Pressable>
            {isOpen ? <View style={styles.body}>{section.content}</View> : null}
          </View>
        );
      })}
    </View>
  );
}

export function Paragraphs({ lines }: { lines: string[] }) {
  return <View style={{ gap: 10 }}>{lines.map((line, index) => <Text key={`${index}-${line.slice(0, 12)}`} style={styles.text}>{line}</Text>)}</View>;
}

export interface NumberRow { label: string; value: string; note?: string }

export function NumberRows({ rows }: { rows: NumberRow[] }) {
  return (
    <View style={{ gap: 12 }}>
      {rows.map((row) => (
        <View key={row.label} style={styles.numberRow}>
          <Text style={styles.numberLabel}>{row.label}</Text>
          <Text style={styles.numberValue}>{row.value}</Text>
          {row.note ? <Text style={styles.numberNote}>{row.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  item: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 54, paddingHorizontal: 16, paddingVertical: 12, borderRadius: HomeRadius.cardLarge, borderWidth: 2, borderColor: HomeColors.panzeriInteraction, backgroundColor: HomeColors.surfaceHighlight },
  headOpen: { backgroundColor: HomeColors.panzeriPrimary, borderColor: HomeColors.panzeriPrimary },
  headText: { flex: 1, fontSize: 17, fontWeight: '800', color: HomeColors.panzeriPrimary, paddingRight: 8 },
  headTextOpen: { color: '#FFFFFF' },
  body: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, borderWidth: 1, borderColor: '#E2E8F0' },
  text: { fontSize: 16, lineHeight: 25, fontWeight: '400', color: HomeColors.textPrimary },
  numberRow: { gap: 2, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#EEF2F7' },
  numberLabel: { fontSize: 15, fontWeight: '700', color: HomeColors.textSecondary },
  numberValue: { fontSize: 24, fontWeight: '800', color: HomeColors.textPrimary },
  numberNote: { fontSize: 13, lineHeight: 18, color: HomeColors.textSecondary },
});
