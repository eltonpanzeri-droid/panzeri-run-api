import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '../src/PtText';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchJsonAuth } from './homeApi';

// Leitura da Evolução em CARDS que rolam para os lados (13/11/2026, ideia e decisões de Elton): por área, o primeiro card é a SÍNTESE da área ("nesse quesito, 6 dos 10 indicadores…") e os seguintes
// trazem um indicador cada, com quatro informações: o que mede, o seu padrão habitual, a tendência e o que isso indica. Todo o texto vem do servidor (GET /me/evolution/summary, por regra, sem IA);
// aqui só se apresenta. O card seguinte aparece cortado na borda (dica de que há mais) e as bolinhas mostram a posição. Nenhum gráfico existente é removido.
export type ReadingAreaId = 'training' | 'load' | 'sleep' | 'wellbeing' | 'adherence';

interface IndicatorDto {
  variableId: string; name: string; status: 'ok' | 'insufficient'; bucket: 'good' | 'steady' | 'attention' | 'tracked' | 'insufficient';
  texts: { whatItMeasures: string; habitual: string; trend: string | null; meaning: string | null };
}
interface AreaDto { id: ReadingAreaId; title: string; text: string; meaning: string | null; counts: { evaluated: number }; indicators: IndicatorDto[] }
interface SummaryDto { areas: AreaDto[] }

const BUCKET_LABEL: Record<IndicatorDto['bucket'], { text: string; color: string }> = {
  good: { text: 'Melhora ou padrão bom', color: '#187A55' },
  steady: { text: 'Nível intermediário ou estável', color: '#6B7280' },
  attention: { text: 'Merece atenção', color: '#A35C00' },
  tracked: { text: 'Acompanhado', color: '#6B7280' },
  insufficient: { text: 'Poucos registros', color: '#9CA3AF' },
};

const GAP = 12;
const PEEK = 32; // quanto do próximo card aparece cortado na borda

export function EvolutionReadingCards({ accessToken, area }: { accessToken: string; area: ReadingAreaId }) {
  const [data, setData] = useState<AreaDto | null | undefined>(undefined);
  const [page, setPage] = useState(0);
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    let alive = true;
    fetchJsonAuth<SummaryDto>('/me/evolution/summary', accessToken).then((summary) => { if (alive) setData(summary?.areas.find((a) => a.id === area) ?? null); });
    return () => { alive = false; };
  }, [accessToken, area]);

  if (data === undefined) return <ActivityIndicator style={{ marginVertical: HomeSpace.component }} />;
  if (!data) return null; // sem leitura (erro ou area sem indicadores): as telas e graficos de sempre continuam

  const cardWidth = Math.max(240, width - HomeSpace.component * 2 - PEEK);
  const step = cardWidth + GAP;
  const cards = data.indicators.length + 1;

  function onScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setPage(Math.max(0, Math.min(cards - 1, Math.round(event.nativeEvent.contentOffset.x / step))));
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.heading}>Leitura da sua evolução</Text>
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} snapToInterval={step} decelerationRate="fast" onMomentumScrollEnd={onScrollEnd} contentContainerStyle={{ gap: GAP, paddingRight: PEEK }} accessibilityLabel={`Cartões de leitura: ${data.title}`}>
        <View style={[styles.card, HomeBorder.card, { width: cardWidth, backgroundColor: HomeColors.surfaceHighlight }]}>
          <Text style={styles.kicker}>RESUMO · {data.title.toUpperCase()}</Text>
          <Text style={styles.body}>{data.text}</Text>
          {data.meaning ? <Text style={styles.body}>{data.meaning}</Text> : null}
          <Text style={styles.hint}>Deslize para ver cada indicador →</Text>
        </View>
        {data.indicators.map((indicator) => (
          <View key={indicator.variableId} style={[styles.card, HomeBorder.card, { width: cardWidth }]}>
            <Text style={[styles.kicker, { color: BUCKET_LABEL[indicator.bucket].color }]}>{BUCKET_LABEL[indicator.bucket].text.toUpperCase()}</Text>
            <Text style={styles.cardTitle}>{indicator.name}</Text>
            <Text style={styles.label}>O que mede</Text>
            <Text style={styles.body}>{indicator.texts.whatItMeasures}</Text>
            <Text style={styles.label}>O seu padrão</Text>
            <Text style={styles.body}>{indicator.texts.habitual}{indicator.texts.trend ? ` ${indicator.texts.trend}` : ''}</Text>
            {indicator.texts.meaning ? (<><Text style={styles.label}>O que isso indica</Text><Text style={styles.body}>{indicator.texts.meaning}</Text></>) : null}
          </View>
        ))}
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
  card: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 6 },
  kicker: { ...HomeTypography.label, color: HomeColors.panzeriInteraction, letterSpacing: 0.5 },
  cardTitle: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary, fontSize: 17 },
  label: { ...HomeTypography.label, color: HomeColors.textSecondary, marginTop: 4 },
  body: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 21 },
  hint: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, marginTop: 4 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D1D5DB' },
  dotActive: { width: 16, backgroundColor: HomeColors.panzeriInteraction },
  footer: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, lineHeight: 16 },
});
