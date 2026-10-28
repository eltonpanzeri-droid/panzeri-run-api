// Tipos e adaptadores da exploracao de indicadores (Evolucao do aluno). So' apresentacao: nenhuma estatistica e' calculada aqui —
// referencias, medias moveis e faixa habitual vem do backend (campo `reference` do snapshot).
import type { Observation, Snapshot, Variable } from './data';

export type ExplorerCategoryId = 'treinos' | 'sono' | 'recuperacao' | 'atividade_diaria' | 'bem_estar' | 'saude';
export type ExplorerInfo = {
  category: ExplorerCategoryId; evidenceKind: string; evidenceLabel: string; source: string; periodicity: string; periodicityLabel: string;
  windowUnit: string; versionComparability: 'comparable_across_versions' | 'not_comparable_across_versions'; crossSourceComparability: 'comparable' | 'not_comparable'; notes: string | null;
};
export type ExplorerVariable = Variable & { info?: ExplorerInfo };

export type ReferenceWindowKey = 'mm7' | 'mm21' | 'mm60' | 'mm200';
export type ReferenceSignal = 'above' | 'below' | 'within' | 'no_reference';
export type ReferencePoint = {
  timestamp: string; value: number; priorN: number;
  historicalMean: { value: number | null; n: number };
  movingAverages: Record<ReferenceWindowKey, { value: number | null; n: number; isPartialWindow: boolean }>;
  band: { lower: number | null; upper: number | null; median: number | null; n: number; basis: 'individual' | 'limited' | 'none'; isPartialWindow: boolean };
  signal: ReferenceSignal; outsideBy: number | null;
};
export type ReferenceSeries = {
  version: 1; method: 'prior_observations_only'; unit: string; windowKind: 'calendar_days' | 'observation_count';
  windows: Array<{ key: ReferenceWindowKey; size: number; label: string }>;
  bandPolicy: { method: string; windowSize: number; individualMin: number; limitedMin: number };
  points: ReferencePoint[];
};
export type ExplorerSnapshot = Snapshot & {
  reference?: ReferenceSeries | null;
  availableSources?: Array<{ key: string; n: number; lastObservationAt: string | null }>; mainSource?: string | null; selectedSource?: string | null;
};
export type Availability = { id: string; n: number; firstObservationAt: string | null; lastObservationAt: string | null; mathApplicable: boolean };

export const CATEGORIES: Array<{ id: ExplorerCategoryId | 'contexto'; label: string }> = [
  { id: 'treinos', label: 'Treinos' }, { id: 'sono', label: 'Sono' }, { id: 'recuperacao', label: 'Recuperação' }, { id: 'atividade_diaria', label: 'Atividade diária' },
  { id: 'bem_estar', label: 'Bem-estar' }, { id: 'saude', label: 'Saúde' }, { id: 'contexto', label: 'Contexto' },
];

// Vocabulario de modalidades do sistema (canonical-modality.ts) agrupado nas cinco categorias de apresentacao. "Agregada" = todas as atividades elegiveis (a serie global da API).
export type ModalityGroupId = 'agregada' | 'corrida' | 'forca' | 'outras_aerobicas' | 'esportes';
export const MODALITY_GROUPS: Array<{ id: ModalityGroupId; label: string; members: string[] }> = [
  { id: 'agregada', label: 'Agregada', members: [] },
  { id: 'corrida', label: 'Corrida', members: ['corrida', 'esteira'] },
  { id: 'forca', label: 'Força', members: ['forca', 'fortalecimento_corredores', 'funcional'] },
  { id: 'outras_aerobicas', label: 'Outras aeróbicas', members: ['bike', 'natacao', 'caminhada'] },
  { id: 'esportes', label: 'Esportes', members: ['outra'] },
];
export const MODALITY_LABELS: Record<string, string> = { corrida: 'Corrida', esteira: 'Esteira', forca: 'Musculação', fortalecimento_corredores: 'Fortalecimento', funcional: 'Funcional', bike: 'Bike', natacao: 'Natação', caminhada: 'Caminhada', outra: 'Outra', global: 'Agregada' };
export function groupOfModality(modality: string): ModalityGroupId | null {
  if (modality === 'global') return 'agregada';
  return MODALITY_GROUPS.find((group) => group.members.includes(modality))?.id ?? null;
}
// Grupos que tem dado nesta variavel (modalidades disponiveis da API). Agregada sempre existe; modalidade desconhecida do vocabulario nao e' escondida: cai em "Esportes" apenas se for 'outra'.
export function availableGroups(available: string[] | undefined): Array<{ id: ModalityGroupId; label: string; members: string[] }> {
  const present = new Set((available ?? []).map(groupOfModality).filter((id): id is ModalityGroupId => id !== null));
  return MODALITY_GROUPS.filter((group) => group.id === 'agregada' || present.has(group.id));
}
export function modalitiesQueryOf(group: ModalityGroupId, available: string[] | undefined): string {
  if (group === 'agregada') return '';
  const members = MODALITY_GROUPS.find((candidate) => candidate.id === group)?.members ?? [];
  return (available ?? []).filter((modality) => members.includes(modality)).join(',');
}

export type IndicatorStatus = { kind: 'available' | 'insufficient' | 'not_collected' | 'categorical' | 'not_applicable'; label: string };
export const MIN_RECORDS_FOR_REFERENCE = 4; // mesma base minima da faixa habitual do backend (limitedMin)
export function statusOf(variable: ExplorerVariable, availability: Availability | undefined, studentIsFemale: boolean | null): IndicatorStatus {
  if (variable.id.startsWith('cycle.') && studentIsFemale === false) return { kind: 'not_applicable', label: 'Não aplicável' };
  if (!availability) return { kind: 'available', label: '' };
  if (availability.n === 0) return { kind: 'not_collected', label: 'Não coletado' };
  if (!availability.mathApplicable) return { kind: 'categorical', label: `${availability.n} registros · categórico` };
  if (availability.n < MIN_RECORDS_FOR_REFERENCE) return { kind: 'insufficient', label: `Histórico insuficiente (${availability.n})` };
  return { kind: 'available', label: `${availability.n} registros` };
}

export const SIGNAL_LABEL: Record<ReferenceSignal, string> = {
  above: 'Acima da faixa habitual', below: 'Abaixo da faixa habitual', within: 'Dentro da faixa habitual', no_reference: 'Sem referência suficiente',
};

// Alinha cada observacao numerica a sua referencia anterior (a API gera uma por observacao, na mesma ordem).
export function referenceFor(snapshot: ExplorerSnapshot, observation: Observation, index: number): ReferencePoint | null {
  const points = snapshot.reference?.points;
  if (!points || typeof observation.value !== 'number') return null;
  const candidate = points[index];
  if (candidate && candidate.timestamp === observation.timestamp && candidate.value === observation.value) return candidate;
  return points.find((point) => point.timestamp === observation.timestamp && point.value === observation.value) ?? null;
}

export const ucFirst = (text: string) => (text ? text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1) : text);
export const STEP_LABEL: Record<string, string> = { registros: 'registros', dias: 'dias', noites: 'noites', semanas: 'semanas', ciclos: 'ciclos' };
export function layerLabelOf(reference: ReferenceSeries | null | undefined, key: ReferenceWindowKey) {
  return reference?.windows.find((window) => window.key === key)?.label ?? key.toUpperCase();
}
