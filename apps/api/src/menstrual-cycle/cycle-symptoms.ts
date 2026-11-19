// Sintomas que a aluna pode marcar no registro do dia (19/11/2026). Lista fixa e curta: o id e' o que se guarda; o rotulo e' o que ela le. Alem da lista ha' um relato livre (notes), para algo especifico.
export const CYCLE_SYMPTOMS = [
  { id: 'dor_de_cabeca', label: 'Dor de cabeça' },
  { id: 'inchaco', label: 'Inchaço' },
  { id: 'dor_nas_costas', label: 'Dor nas costas' },
  { id: 'dor_nas_pernas', label: 'Dor ou peso nas pernas' },
  { id: 'sensibilidade_mamas', label: 'Sensibilidade nas mamas' },
  { id: 'nausea', label: 'Enjoo' },
  { id: 'tontura', label: 'Tontura' },
  { id: 'cansaco', label: 'Cansaço fora do normal' },
  { id: 'sono_ruim', label: 'Sono ruim' },
  { id: 'irritabilidade', label: 'Irritabilidade' },
  { id: 'ansiedade', label: 'Ansiedade' },
  { id: 'vontade_doce', label: 'Vontade de doce' },
  { id: 'acne', label: 'Acne' },
  { id: 'sangramento_fora_periodo', label: 'Sangramento fora do período' },
] as const;
export type CycleSymptomId = (typeof CYCLE_SYMPTOMS)[number]['id'];
export const CYCLE_SYMPTOM_IDS: readonly string[] = CYCLE_SYMPTOMS.map((item) => item.id);
export const CYCLE_NOTES_MAX_CHARS = 500;
export const cycleSymptomLabel = (id: string) => CYCLE_SYMPTOMS.find((item) => item.id === id)?.label ?? id;

// Aceita o que vier do aplicativo e devolve so' ids validos, sem repeticao.
export function normalizeSymptoms(raw: unknown): CycleSymptomId[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((item): item is CycleSymptomId => typeof item === 'string' && CYCLE_SYMPTOM_IDS.includes(item)))];
}
