// Paleta unica das modalidades nos graficos de treino do painel (28/10/2026). Fonte unica: nenhum componente define cor de modalidade por conta propria.
// Roxo = indicador realmente agregado (ex.: total semanal de todas as modalidades). Numa visao agregada em que cada coluna e' uma sessao, a coluna usa a cor da modalidade da sessao.
// A cor nunca e' o unico identificador: tooltip, rotulo de acessibilidade e a chave de cores (ModalityKey) trazem o nome da modalidade em texto.
import { MODALITY_LABELS, groupOfModality } from './explorer-data';

export const MODALITY_COLORS = {
  agregada: '#8B5CF6', corrida: '#16A34A', forca: '#2563EB', esportes: '#F59E0B', outras_aerobicas: '#06B6D4', desconhecida: '#94A3B8',
} as const;
export type ModalityColorKey = keyof typeof MODALITY_COLORS;
export const MODALITY_COLOR_LABELS: Record<ModalityColorKey, string> = {
  agregada: 'Agregada', corrida: 'Corrida', forca: 'Força', esportes: 'Esportes', outras_aerobicas: 'Outras aeróbicas', desconhecida: 'Não identificada',
};

// Sem modalidade (ou 'global') = indicador agregado. Modalidade informada mas fora do vocabulario do sistema = nao identificada.
export function modalityColorKey(modality: string | null | undefined): ModalityColorKey {
  if (!modality || modality === 'global') return 'agregada';
  const group = groupOfModality(modality);
  return group && group !== 'agregada' ? group : 'desconhecida';
}
export const modalityNameOf = (modality: string | null | undefined): string => (modality ? MODALITY_LABELS[modality] ?? modality : MODALITY_COLOR_LABELS.agregada);
