import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { HomeSpace, HomeTypography, HomeColors } from './homeTheme';
import { ReadingAreaId, useEvolutionSummary } from './evolutionReading';
import { GuideAccordion, NumberRows, Paragraphs } from './GuideAccordion';

export type { ReadingAreaId } from './evolutionReading';

// Card ÚNICO de cada grande área da Evolução (14/11/2026, desenho de Elton; substitui o carrossel de cards que rolava para os lados). Cinco botões: "O que é?" (aberto), "Como interpretar?",
// "Quais são os seus números?", "Como você está?" (análise detalhada e cruzada dos indicadores) e "Limitações". Todo o texto vem do servidor (GET /me/evolution/summary, por regra, sem IA).
export function AreaGuideCard({ accessToken, area }: { accessToken: string; area: ReadingAreaId }) {
  const summary = useEvolutionSummary(accessToken);
  const data = summary === undefined ? undefined : (summary?.areas.find((a) => a.id === area) ?? null);
  if (data === undefined) return <ActivityIndicator style={{ marginVertical: HomeSpace.component }} />;
  if (!data) return null; // sem leitura (erro): as telas e os gráficos de sempre continuam

  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.heading}>{data.title}</Text>
      <GuideAccordion
        sections={[
          { id: 'what', title: 'O que é?', defaultOpen: true, content: <Paragraphs lines={data.guide.whatIs} /> },
          { id: 'how', title: 'Como interpretar?', content: <Paragraphs lines={[data.guide.howToRead]} /> },
          { id: 'numbers', title: 'Quais são os seus números?', content: <NumberRows rows={data.guide.numbers} /> },
          { id: 'you', title: 'Como você está?', content: <Paragraphs lines={data.guide.howYouAre} /> },
          { id: 'limits', title: 'Limitações', content: <Paragraphs lines={data.guide.limitations} /> },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { ...HomeTypography.bodyMedium, fontSize: 18, fontWeight: '800', color: HomeColors.textPrimary },
});
