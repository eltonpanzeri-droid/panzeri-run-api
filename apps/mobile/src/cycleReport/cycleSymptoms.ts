// Sintomas do registro do dia (19/11/2026). MESMA lista do servidor (apps/api/src/menstrual-cycle/cycle-symptoms.ts); ha' teste que confere as duas. O id e' o que o servidor guarda.
export const CYCLE_SYMPTOM_OPTIONS = [
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
export const CYCLE_NOTES_MAX_CHARS = 500;
