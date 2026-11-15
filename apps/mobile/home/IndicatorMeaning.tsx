import React from 'react';
import { meaningOf } from './indicatorMeanings';
import { ActivityIndicator } from 'react-native';
import { useIndicatorReadingState } from './evolutionReading';
import { modalityTint } from './chartData';
import { GuideAccordion, GuideSection, NumberRows, Paragraphs } from './GuideAccordion';

// Sob CADA gráfico (14/11/2026, desenho de Elton): cinco botões grandes que abrem e fecham — "O que é?" (aberto), "Como interpretar?", "Quais são os seus números?" (média, tendência de longo prazo,
// tendência de curto prazo e último registro), "Como você está?" (explicação detalhada deste indicador) e "Limitações desse dado" (o ÚNICO lugar com os avisos). O conteúdo vem do servidor
// (GET /me/evolution/summary, por regra). Gráfico sem leitura do servidor (ex.: dor, cadência) mostra só "O que é?" (texto fixo) e as limitações gerais. Sem nenhum texto, não mostra nada.
const GENERIC_LIMITATIONS = [
  'Este não é o único dado que olhamos: aqui analisamos tendências, sempre junto com os demais dados.',
  'Ainda não calculamos a leitura detalhada deste dado; mostramos o gráfico e a explicação geral.',
];

export function IndicatorMeaning({ id, modality }: { id: string | undefined | null; modality?: string | null }) {
  const { reading, loading } = useIndicatorReadingState(id, modality);
  if (loading) return <ActivityIndicator size="small" style={{ marginVertical: 8 }} />;
  const fixed = meaningOf(id);

  const sections: GuideSection[] = reading
    ? [
        { id: 'numbers', title: 'Quais são os seus números?', content: <NumberRows rows={reading.guide.numbers} note={reading.guide.numbersNote} /> },
        { id: 'what', title: 'O que é?', content: <Paragraphs lines={[reading.guide.whatIs]} /> },
        { id: 'how', title: 'Como interpretar?', content: <Paragraphs lines={[reading.guide.howToRead, ...(fixed ? [fixed] : [])]} /> },
        { id: 'you', title: 'Como você está?', content: <Paragraphs lines={reading.guide.howYouAre} /> },
        { id: 'limits', title: 'Limitações desse dado', content: <Paragraphs lines={reading.guide.limitations} /> },
      ]
    : [
        { id: 'numbers', title: 'Quais são os seus números?', content: <Paragraphs lines={['Ainda não há registros suficientes para calcular a sua média e as suas tendências deste dado.']} /> },
        { id: 'what', title: 'O que é?', content: <Paragraphs lines={[fixed ?? 'Este gráfico mostra a evolução deste dado ao longo do tempo, a partir dos seus registros.']} /> },
        { id: 'how', title: 'Como interpretar?', content: <Paragraphs lines={['Observe para onde a linha caminha ao longo das semanas: subindo, descendo ou estável. O que importa é a direção e a sua faixa habitual, não um ponto isolado.']} /> },
        { id: 'you', title: 'Como você está?', content: <Paragraphs lines={['Ainda não há leitura detalhada deste dado. Conforme você registrar mais treinos, ela passa a aparecer aqui.']} /> },
        { id: 'limits', title: 'Limitações desse dado', content: <Paragraphs lines={GENERIC_LIMITATIONS} /> },
      ];
  // Com modalidade escolhida, a cor dos botões é a dela (a aluna vê que os textos mudam por modalidade); sem escolha, a cor de sempre.
  return <GuideAccordion key={modality ?? 'todas'} sections={sections} accent={modality ? modalityTint(modality) : undefined} />;
}
