// Apresentacao do catalogo na Evolucao do painel (27/10/2026): categoria de cada indicador e a "ficha" do botao (i).
// So' leitura do VariableRegistry (fonte unica de significado): nada aqui cria indicador, valor ou formula.

import { evidenceKindOf, type EvidenceKind, type VariableDefinition } from './variable-registry';
import { referenceUnitOf, type ReferenceUnit } from './reference-series';

export type ExplorerCategory = 'treinos' | 'sono' | 'recuperacao' | 'atividade_diaria' | 'bem_estar' | 'saude';

// Organizacao tematica da categoria "Treinos" (01/11/2026): cinco grupos, cada indicador em UM so'. Estrutura expansivel: novo indicador entra pela tabela abaixo (ou cai no grupo padrao do seu dominio),
// sem tocar na interface. So' apresentacao: nenhum valor, formula ou significado e' criado aqui.
export type TrainingSubgroup = 'volume_consistencia' | 'esforco_carga' | 'intensidade_resposta' | 'mecanica_eficiencia' | 'execucao_experiencia';
export const TRAINING_SUBGROUPS: Array<{ id: TrainingSubgroup; label: string; hint: string }> = [
  { id: 'volume_consistencia', label: 'Volume e consistência', hint: 'o que foi realizado, quanto e com que regularidade' },
  { id: 'esforco_carga', label: 'Esforço percebido e carga interna', hint: 'a exigência que as sessões representaram para a aluna' },
  { id: 'intensidade_resposta', label: 'Intensidade e resposta cardiovascular', hint: 'ritmo, velocidade e frequência cardíaca' },
  { id: 'mecanica_eficiencia', label: 'Mecânica e eficiência da corrida', hint: 'cadência, potência e dinâmica de corrida' },
  { id: 'execucao_experiencia', label: 'Execução e experiência do treinamento', hint: 'como o treino prescrito foi vivido e executado' },
];
const TRAINING_SUBGROUP_BY_ID: Record<string, TrainingSubgroup> = {
  'training.volumePrescribedKm': 'volume_consistencia', 'training.volumeCompletedTotalKm': 'volume_consistencia', 'training.volumeCompletedPrescribedOnlyKm': 'volume_consistencia',
  'training.volumeExtraKm': 'volume_consistencia', 'training.volumeDiffAbsoluteKm': 'volume_consistencia', 'training.volumeRatioCompletedPrescribed': 'volume_consistencia',
  'training.adherencePercent': 'volume_consistencia', 'training.acwr': 'volume_consistencia', 'activity.elevationGainMeters': 'volume_consistencia',
  'workout.perceivedEffort': 'esforco_carga', 'workout.sessionInternalLoad': 'esforco_carga', 'workout.sessionDurationUsedMin': 'esforco_carga', 'checkin.weekDemandVsNormal': 'esforco_carga',
  'activity.avgPaceSecondsKm': 'intensidade_resposta', 'execution.timeInBandPct': 'intensidade_resposta', 'execution.avgHeartRateInBandBpm': 'intensidade_resposta',
  'activity.cadenceAvg': 'mecanica_eficiencia', 'activity.powerAvgWatts': 'mecanica_eficiencia',
};
// Quem nao esta na tabela cai no grupo do seu dominio: carga de treino -> volume; o resto -> execucao e experiencia.
export function trainingSubgroupOf(definition: Pick<VariableDefinition, 'variableId' | 'domain'>): TrainingSubgroup {
  return TRAINING_SUBGROUP_BY_ID[definition.variableId] ?? (definition.domain === 'training_load' ? 'volume_consistencia' : 'execucao_experiencia');
}

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
  /** Grupo tematico dentro de "Treinos"; null nas demais categorias. */
  subgroup: TrainingSubgroup | null;
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
  const category = explorerCategoryOf(definition);
  return {
    category,
    subgroup: category === 'treinos' ? trainingSubgroupOf(definition) : null,
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
