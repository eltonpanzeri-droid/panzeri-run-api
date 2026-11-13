import React from 'react';
import { meaningOf } from './indicatorMeanings';
import { useIndicatorReading } from './evolutionReading';
import { GuideAccordion, GuideSection, NumberRows, Paragraphs } from './GuideAccordion';

// Sob CADA gráfico (14/11/2026, desenho de Elton): cinco botões grandes que abrem e fecham — "O que é?" (aberto), "Como interpretar?", "Quais são os seus números?" (média, tendência de longo prazo,
// tendência de curto prazo e último registro), "Como você está?" (explicação detalhada deste indicador) e "Limitações desse dado" (o ÚNICO lugar com os avisos). O conteúdo vem do servidor
// (GET /me/evolution/summary, por regra). Gráfico sem leitura do servidor (ex.: dor, cadência) mostra só "O que é?" (texto fixo) e as limitações gerais. Sem nenhum texto, não mostra nada.
const GENERIC_LIMITATIONS = [
  'Isto não é diagnóstico e não substitui a avaliação de um médico.',
  'Um dado sozinho não define o seu estado: aqui olhamos tendências, sempre junto com os demais dados.',
  'Ainda não calculamos a leitura detalhada deste dado; mostramos o gráfico e a explicação geral.',
];

export function IndicatorMeaning({ id }: { id: string | undefined | null }) {
  const reading = useIndicatorReading(id);
  const fixed = meaningOf(id);
  if (!reading && !fixed) return null;

  const sections: GuideSection[] = reading
    ? [
        { id: 'what', title: 'O que é?', defaultOpen: true, content: <Paragraphs lines={[reading.guide.whatIs]} /> },
        { id: 'how', title: 'Como interpretar?', content: <Paragraphs lines={[reading.guide.howToRead, ...(fixed ? [fixed] : [])]} /> },
        { id: 'numbers', title: 'Quais são os seus números?', content: <NumberRows rows={reading.guide.numbers} /> },
        { id: 'you', title: 'Como você está?', content: <Paragraphs lines={reading.guide.howYouAre} /> },
        { id: 'limits', title: 'Limitações desse dado', content: <Paragraphs lines={reading.guide.limitations} /> },
      ]
    : [
        { id: 'what', title: 'O que é?', defaultOpen: true, content: <Paragraphs lines={[fixed as string]} /> },
        { id: 'limits', title: 'Limitações desse dado', content: <Paragraphs lines={GENERIC_LIMITATIONS} /> },
      ];
  return <GuideAccordion sections={sections} />;
}
