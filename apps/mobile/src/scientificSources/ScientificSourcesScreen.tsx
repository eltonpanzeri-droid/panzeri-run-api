import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import { CONTENT_KINDS, SOURCE_THEMES, isReferenceComplete, openSources, referenceUrl, themesById } from './sources';

// "Fontes científicas e metodologia" (Apple 1.4.1). Só leitura: nenhum dado do app é lido, calculado ou alterado aqui.
// Mostra, sempre separados: evidência científica (referências), interpretação/aplicação (o que o app faz) e metodologia própria.

export function ScientificSourcesScreen({ focusThemeIds }: { focusThemeIds?: string[] }) {
  const focused = themesById(focusThemeIds);
  const showingAll = focused.length === SOURCE_THEMES.length;
  const themes = showingAll ? SOURCE_THEMES : focused;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Fontes científicas e metodologia</Text>
      <Text style={styles.lead}>
        O Panzeri Run oferece orientações de treino, recuperação e acompanhamento. Aqui você encontra os estudos que servem de base a esses temas e a explicação de como o app se relaciona com cada um.
        Estas orientações não substituem a avaliação de um profissional de saúde.
      </Text>

      <View style={styles.kindsBox}>
        {CONTENT_KINDS.map((kind) => (
          <View key={kind.id} style={styles.kindRow}>
            <Text style={styles.kindTitle}>{kind.title}</Text>
            <Text style={styles.kindText}>{kind.text}</Text>
          </View>
        ))}
      </View>

      {!showingAll ? (
        <Pressable accessibilityRole="button" onPress={() => openSources([])} style={styles.showAll}>
          <Text style={styles.showAllText}>Ver todos os temas</Text>
        </Pressable>
      ) : null}

      {themes.map((theme) => {
        const complete = theme.references.filter(isReferenceComplete);
        return (
          <View key={theme.id} style={styles.themeCard}>
            <Text style={styles.themeTitle}>{theme.title}</Text>
            <Text style={styles.kindLabel}>Interpretação e aplicação prática</Text>
            <Text style={styles.body}>{theme.appUse}</Text>
            <Text style={styles.kindLabel}>Evidência científica</Text>
            {complete.length === 0 ? (
              <Text style={styles.pending}>As referências deste tema estão em conferência e serão exibidas assim que verificadas.</Text>
            ) : complete.map((reference) => {
              const url = referenceUrl(reference);
              return (
                <View key={`${reference.title}-${reference.year}`} style={styles.reference}>
                  <Text style={styles.refTitle}>{reference.title}</Text>
                  <Text style={styles.refMeta}>{reference.authors} ({reference.year}). {reference.journal}.</Text>
                  {url ? (
                    <Text accessibilityRole="link" style={styles.refLink} onPress={() => void Linking.openURL(url)}>
                      {reference.doi ? `DOI: ${reference.doi}` : `PubMed: ${reference.pubmedId}`}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

/** Link contextual para telas com recomendações de saúde, treino, recuperação, dor e risco de lesão. */
export function SourcesLink({ themeIds, label = 'Fontes científicas e metodologia' }: { themeIds?: string[]; label?: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={() => openSources(themeIds ?? [])} style={styles.contextLink}>
      <Text style={styles.contextLinkText}>{label} ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14 },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  lead: { fontSize: 14, lineHeight: 20, color: '#334155' },
  kindsBox: { gap: 8, backgroundColor: '#f1f5f9', borderRadius: 12, padding: 12 },
  kindRow: { gap: 2 },
  kindTitle: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  kindText: { fontSize: 13, lineHeight: 18, color: '#475569' },
  showAll: { alignSelf: 'flex-start', paddingVertical: 6 },
  showAllText: { fontSize: 14, fontWeight: '700', color: '#0b5ea8' },
  themeCard: { gap: 6, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, backgroundColor: '#fff' },
  themeTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  kindLabel: { marginTop: 6, fontSize: 11, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 },
  body: { fontSize: 14, lineHeight: 20, color: '#334155' },
  pending: { fontSize: 13, lineHeight: 18, color: '#64748b', fontStyle: 'italic' },
  reference: { gap: 2, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  refTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  refMeta: { fontSize: 13, color: '#475569' },
  refLink: { fontSize: 13, color: '#0b5ea8', textDecorationLine: 'underline' },
  contextLink: { alignSelf: 'flex-start', paddingVertical: 6 },
  contextLinkText: { fontSize: 13, fontWeight: '700', color: '#0b5ea8' },
});
