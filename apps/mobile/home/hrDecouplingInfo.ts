import type { SnapshotLite } from './insights';

// Desacoplamento da frequência cardíaca — faixas de duração e texto "O que isso representa" (03/11/2026).
//
// RASCUNHO PARA REVISÃO de Elton e do advogado (mesma regra de indicatorMeanings.ts). A matemática, os critérios de elegibilidade e as referências vêm do servidor
// (training-intelligence/hr-decoupling.ts); aqui só ficam os rótulos das cinco faixas, que precisam acompanhar o servidor (teste em hr-decoupling-screen.spec.ts).

export const HR_DECOUPLING_CATEGORIES = [
  { id: 'd30', label: '30 a 60 min' },
  { id: 'd60', label: '60 a 90 min' },
  { id: 'd90', label: '90 a 120 min' },
  { id: 'd120', label: '120 a 150 min' },
  { id: 'd150', label: 'mais de 150 min' },
] as const;

export type HrDecouplingCategoryId = (typeof HR_DECOUPLING_CATEGORIES)[number]['id'];

export const hrDecouplingVariableId = (category: HrDecouplingCategoryId) => `activity.hrDecoupling.${category}`;

/** Menos que isso de corridas anteriores na faixa: a tela não compara com o histórico (a mesma regra vale no contexto da IA). */
export const HR_DECOUPLING_MIN_PRIOR = 5;

export const HR_DECOUPLING_MEANING =
  'O desacoplamento compara a frequência cardíaca da primeira e da segunda metade da corrida, para um ritmo parecido. Quando ela sobe mais na segunda metade, o coração trabalhou mais para sustentar o mesmo ritmo, sinal de que o treino cobrou mais do organismo naquele dia. Valores acima do seu habitual, repetidos em várias corridas da mesma duração, sugerem que a recuperação pode estar menor, o que costuma acompanhar uma queda de prontidão. Calor, hidratação, alimentação, sono e subidas também influenciam. Valor zero ou negativo significa que a frequência não subiu e não quer dizer treino melhor ou pior. Você é comparado só com você, na mesma faixa de duração.';

export const hrDecouplingPct = (v: number) => `${(Math.round(v * 10) / 10).toString().replace('.', ',')}%`;
const pct = hrDecouplingPct;

// Comparação do registro mais recente com o que existia ANTES dele (referências do servidor). Só a partir de 5 corridas anteriores na faixa; médias móveis só com a janela completa.
export function comparisonSentences(snapshot: SnapshotLite | null | undefined): string[] {
  const points = snapshot?.reference?.points ?? [];
  const last = points[points.length - 1];
  if (!last) return [];
  const prior = last.priorN ?? 0;
  if (prior < HR_DECOUPLING_MIN_PRIOR) {
    return [`Há ${prior} ${prior === 1 ? 'corrida anterior' : 'corridas anteriores'} nesta faixa. As comparações com o seu histórico começam com ${HR_DECOUPLING_MIN_PRIOR} corridas anteriores.`];
  }
  const out: string[] = [];
  if (last.historicalMean?.value != null) out.push(`Média de todas as corridas anteriores da faixa: ${pct(last.historicalMean.value)} (${last.historicalMean.n} corridas).`);
  const windows: Array<[string, string]> = [['mm21', 'últimas 21'], ['mm60', 'últimas 60']];
  for (const [key, label] of windows) {
    const w = last.movingAverages?.[key];
    if (w && w.value != null && !w.isPartialWindow) out.push(`Média das ${label} corridas anteriores: ${pct(w.value)}.`);
  }
  const { lower, upper, basis } = last.band;
  if (basis !== 'none' && lower != null && upper != null) {
    const side = last.signal === 'above' ? 'acima' : last.signal === 'below' ? 'abaixo' : 'dentro';
    out.push(`Faixa habitual das corridas anteriores: ${pct(lower)} a ${pct(upper)}${basis === 'limited' ? ' (base pequena)' : ''}. Esta corrida ficou ${side} dela${last.signal === 'within' ? '' : ' (só a posição, sem julgamento)'}.`);
  }
  return out;
}
