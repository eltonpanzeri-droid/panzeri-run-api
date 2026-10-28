// Apresentacao do catalogo na Evolucao do painel (27/10/2026): categoria de cada indicador e a "ficha" do botao (i).
// So' leitura do VariableRegistry (fonte unica de significado): nada aqui cria indicador, valor ou formula.

import { evidenceKindOf, type EvidenceKind, type VariableDefinition } from './variable-registry';
import { referenceUnitOf, type ReferenceUnit } from './reference-series';

export type ExplorerCategory = 'treinos' | 'sono' | 'recuperacao' | 'atividade_diaria' | 'bem_estar' | 'saude';

// Categoria visual. Contexto nao tem variaveis: sao acontecimentos (ContextEvent), tratados a parte pela interface.
export function explorerCategoryOf(definition: Pick<VariableDefinition, 'variableId' | 'domain'>): ExplorerCategory {
  const id = definition.variableId;
  if (id === 'wearable.dailySteps' || id === 'wearable.dailyActiveKcal') return 'atividade_diaria'; // passos e calorias ativas do dia (relogio): rotina diaria, nao recuperacao
  if (id.startsWith('wearable.')) return /sleep|nap/i.test(id) ? 'sono' : 'recuperacao';
  if (id === 'workout.postPhysicalFatigue') return 'bem_estar';
  switch (definition.domain) {
    case 'sleep': return 'sono';
    case 'physical_state':
    case 'psychological_state': return 'bem_estar';
    case 'pain_health':
    case 'menstrual_cycle': return 'saude';
    default: return 'treinos';
  }
}

const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  self_report: 'Relato ou percepção da aluna',
  device_measurement: 'Medição do aparelho',
  device_estimate: 'Estimativa do algoritmo do aparelho',
  manufacturer_score: 'Pontuação calculada pelo fabricante',
  system_calculation: 'Cálculo do Panzeri Run a partir de prescrição e execução',
};

const FREQUENCY_LABEL: Record<VariableDefinition['expectedFrequency'], string> = {
  per_workout: 'Uma observação por treino/atividade',
  per_week: 'Uma observação por semana',
  per_day: 'Uma observação por dia',
  per_night: 'Uma observação por noite',
  per_cycle: 'Uma observação por ciclo',
};

export interface ExplorerVariableInfo {
  category: ExplorerCategory;
  evidenceKind: EvidenceKind;
  evidenceLabel: string;
  source: string;
  periodicity: VariableDefinition['expectedFrequency'];
  periodicityLabel: string;
  windowUnit: ReferenceUnit;
  versionComparability: VariableDefinition['versionComparability'];
  crossSourceComparability: 'comparable' | 'not_comparable';
  notes: string | null;
}

export function explorerInfoOf(definition: VariableDefinition): ExplorerVariableInfo {
  const kind = evidenceKindOf(definition);
  return {
    category: explorerCategoryOf(definition),
    evidenceKind: kind,
    evidenceLabel: EVIDENCE_LABEL[kind],
    source: definition.source,
    periodicity: definition.expectedFrequency,
    periodicityLabel: FREQUENCY_LABEL[definition.expectedFrequency],
    windowUnit: referenceUnitOf(definition),
    versionComparability: definition.versionComparability,
    crossSourceComparability: definition.crossSourceComparability ?? 'comparable',
    notes: definition.notes ?? null,
  };
}
