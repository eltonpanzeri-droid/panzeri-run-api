import React, { useRef, useState } from 'react';
import { ActivityIndicator, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../src/PtText';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { IndicatorDto, ReadingAreaId, useEvolutionSummary } from './evolutionReading';

export type { ReadingAreaId } from './evolutionReading';

// Leitura da Evolução em CARDS COMPACTOS que rolam para os lados (13/11/2026, ideia de Elton; compactados em 14/11/2026 porque o card grande escondia o que vinha embaixo). Por área, o primeiro card é a SÍNTESE
// ("nesse quesito, 6 dos 10 indicadores…"); os seguintes trazem um indicador cada: status, nome, o padrão e a tendência da aluna. O texto longo (o que mede e o que isso indica) abre sob demanda em "Ver explicação".
// Todo o texto vem do servidor (por regra, sem IA). O próximo card aparece cortado na borda (dica de que há mais). No navegador o encaixe usa CSS scroll-snap (o snapToInterval do React Native não vale na web).
const BUCKET_LABEL: Record<IndicatorDto['bucket'], { text: string; color: string }> = {
  good: { text: 'Melhora ou padrão bom', color: '#187A55' },
  steady: { text: 'Nível intermediário ou estável', color: '#6B7280' },
  attention: { text: 'Merece atenção', color: '#A35C00' },
  tracked: { text: 'Acompanhado', color: '#6B7280' },
  insufficient: { text: 'Poucos registros', color: '#9CA3AF' },
};

const GAP = 12;
const PEEK = 36; // quanto do próximo card aparece cortado na borda
const IS_WEB = Platform.OS === 'web';
const snapAlign = IS_WEB ? ({ scrollSnapAlign: 'start' } as never) : null;
const snapType = IS_WEB ? ({ scrollSnapType: 'x mandatory' } as never) : null;

function Expander({ open, onPress, label }: { open: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} style={styles.expander} accessibilityRole="button" accessibilityLabel={`${label}: ${open ? 'recolher' : 'expandir'}`}>
      <Text style={styles.expanderText}>{open ? 'Recolher explicação' : label}</Text>
      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={HomeColors.panzeriInteraction} />
    </Pressable>
  );
}

export function EvolutionReadingCards({ accessToken, area }: { accessToken: string; area: ReadingAreaId }) {
  const summary = useEvolutionSummary(accessToken);
  const [page, setPage] = useState(0);
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const data = summary === undefined ? undefined : (summary?.areas.find((a) => a.id === area) ?? null);

  if (data === undefined) return <ActivityIndicator style={{ marginVertical: HomeSpace.component }} />;
  if (!data) return null; // sem leitura (erro ou area sem indicadores): as telas e graficos de sempre continuam

  const cardWidth = Math.max(240, width - HomeSpace.component * 2 - PEEK);
  const step = cardWidth + GAP;
  const cards = data.indicators.length + 1;
  const toggle = (key: string) => setOpenCards((current) => ({ ...current, [key]: !current[key] }));

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.max(0, Math.min(cards - 1, Math.round(event.nativeEvent.contentOffset.x / step)));
    setPage((current) => (current === next ? current : next));
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.heading}>Leitura da sua evolução</Text>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={IS_WEB ? undefined : step}
        decelerationRate="fast"
        scrollEventThrottle={32}
        onScroll={onScroll}
        style={snapType}
        contentContainerStyle={{ gap: GAP, paddingRight: PEEK, alignItems: 'flex-start' }}
        accessibilityLabel={`Cartões de leitura: ${data.title}`}
      >
        <View style={[styles.card, HomeBorder.card, snapAlign, { width: cardWidth, backgroundColor: HomeColors.surfaceHighlight }]}>
          <Text style={styles.kicker}>RESUMO · {data.title.toUpperCase()}</Text>
          <Text style={styles.body}>{data.text}</Text>
          {data.meaning ? (
            <>
              <Expander open={!!openCards.summary} onPress={() => toggle('summary')} label="O que isso significa" />
              {openCards.summary ? <Text style={styles.body}>{data.meaning}</Text> : null}
            </>
          ) : null}
          <Text style={styles.hint}>Deslize para ver cada indicador →</Text>
        </View>
        {data.indicators.map((indicator) => {
          const open = !!openCards[indicator.variableId];
          return (
            <View key={indicator.variableId} style={[styles.card, HomeBorder.card, snapAlign, { width: cardWidth }]}>
              <Text style={[styles.kicker, { color: BUCKET_LABEL[indicator.bucket].color }]}>{BUCKET_LABEL[indicator.bucket].text.toUpperCase()}</Text>
              <Text style={styles.cardTitle}>{indicator.name}</Text>
              <Text style={styles.body}>{indicator.texts.habitual}{indicator.texts.trend ? ` ${indicator.texts.trend}` : ''}</Text>
              <Expander open={open} onPress={() => toggle(indicator.variableId)} label="Ver explicação" />
              {open ? (
                <>
                  <Text style={styles.label}>O que mede</Text>
                  <Text style={styles.body}>{indicator.texts.whatItMeasures}</Text>
                  {indicator.texts.meaning ? (<><Text style={styles.label}>O que isso indica</Text><Text style={styles.body}>{indicator.texts.meaning}</Text></>) : null}
                </>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: cards }, (_, index) => <View key={index} style={[styles.dot, index === page && styles.dotActive]} />)}
      </View>
      <Text style={styles.footer}>Nenhum indicador é analisado sozinho e isto não é diagnóstico médico. A leitura é feita por regras sobre os seus próprios registros, desde 01/08/2026.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  card: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.related, gap: 6 },
  kicker: { ...HomeTypography.label, color: HomeColors.panzeriInteraction, letterSpacing: 0.5 },
  cardTitle: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary, fontSize: 16 },
  label: { ...HomeTypography.label, color: HomeColors.textSecondary, marginTop: 4 },
  body: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 20 },
  expander: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  expanderText: { ...HomeTypography.label, color: HomeColors.panzeriInteraction },
  hint: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D1D5DB' },
  dotActive: { width: 16, backgroundColor: HomeColors.panzeriInteraction },
  footer: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, lineHeight: 16 },
});
