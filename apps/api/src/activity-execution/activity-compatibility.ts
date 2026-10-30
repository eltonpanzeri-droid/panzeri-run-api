import { canonicalModality } from './canonical-modality';
import { FORCE_SESSION_MODALITIES, WEAK_FORCE_ACTIVITY } from './activity-modality-map';

// Compatibilidade entre treino prescrito e atividade importada (Conciliacao, 30/10/2026). Funcoes PURAS, compartilhadas por todas as fontes de atividades (sem nada especifico de provedor):
// so' trabalham com a modalidade canonica e os numeros ja' normalizados.
//
// Dois usos diferentes, nunca misturados:
//   1. Vinculo AUTOMATICO e sugestoes: so' modalidades compativeis (modalitiesCompatible / weakForceCompatible). Caminhada continua separada de corrida.
//   2. Vinculo MANUAL do aluno: qualquer treino pode ser escolhido. assessCompatibility() so' DIZ se os dados parecem compativeis; quando nao parecem, o aluno
//      recebe um aviso e CONFIRMA. O aviso nunca impede o vinculo (ela pode ter marcado a modalidade errada no relogio, ou ter feito so' parte do treino).

// Grupos de modalidade considerados equivalentes pra correspondencia prescricao x execucao. 'outra' nunca e' compativel com nada.
const MODALITY_COMPATIBILITY: Record<string, string[]> = {
  corrida: ['corrida', 'esteira'],
  esteira: ['corrida', 'esteira'],
  forca: ['forca', 'fortalecimento_corredores'],
  fortalecimento_corredores: ['forca', 'fortalecimento_corredores'],
  bike: ['bike'],
};

// Compara SEMPRE a modalidade canonica (ActivityLog legado pode guardar o enum bruto do provider, ex.: 'RUNNING'); valor desconhecido continua nao-compativel.
export function modalitiesCompatible(sessionModality: string, rawActivitySport: string | null): boolean {
  const activitySport = canonicalModality(rawActivitySport);
  if (!activitySport || activitySport === 'outra') return false;
  const sessionCanonical = canonicalModality(sessionModality) ?? sessionModality;
  const group = MODALITY_COMPATIBILITY[sessionCanonical];
  return group ? group.includes(activitySport) : sessionCanonical === activitySport;
}

// 'funcional' (treino funcional, cross training, HIIT, circuito) so' e' candidato a uma musculacao/fortalecimento PRESCRITOS.
export function weakForceCompatible(sessionModality: string, rawActivitySport: string | null): boolean {
  return canonicalModality(rawActivitySport) === WEAK_FORCE_ACTIVITY && FORCE_SESSION_MODALITIES.includes(canonicalModality(sessionModality) ?? sessionModality);
}

// Diferenca (em proporcao do prescrito) a partir da qual duracao OU distancia sao "muito diferentes" para o AVISO do vinculo manual. So' avisa; nunca veta,
// e NAO afeta o vinculo automatico (correspondencia nao exige execucao parecida com a prescrita).
export const VERY_DIFFERENT_RATIO = 0.5;

export interface CompatibilityAssessment {
  // 'compatible' = nada a avisar; 'attention' = os dados parecem diferentes e o aluno precisa confirmar que e' o mesmo treino.
  level: 'compatible' | 'attention';
  needsConfirmation: boolean;
  reasons: string[];
}

const SPORT_LABEL: Record<string, string> = { corrida: 'corrida', esteira: 'corrida na esteira', forca: 'musculação', funcional: 'treino funcional', bike: 'bicicleta', natacao: 'natação', caminhada: 'caminhada', outra: 'outra atividade' };
const SESSION_LABEL: Record<string, string> = { corrida: 'corrida', esteira: 'corrida na esteira', forca: 'musculação', fortalecimento_corredores: 'fortalecimento', bike: 'bicicleta' };

function farApart(prescribed: number | null | undefined, observed: number | null | undefined): boolean {
  if (prescribed == null || observed == null || prescribed <= 0) return false; // dado ausente nunca e' divergencia
  return Math.abs(observed - prescribed) > prescribed * VERY_DIFFERENT_RATIO;
}

export function assessCompatibility(
  session: { modality: string; distanceKm: number | null; durationMin: number | null },
  activity: { sport: string | null; distanceMeters: number | null; durationSec: number | null },
): CompatibilityAssessment {
  const reasons: string[] = [];
  if (!modalitiesCompatible(session.modality, activity.sport) && !weakForceCompatible(session.modality, activity.sport)) {
    const sport = canonicalModality(activity.sport) ?? 'outra';
    const sessionKind = canonicalModality(session.modality) ?? session.modality;
    reasons.push(`A atividade foi registrada como ${SPORT_LABEL[sport] ?? sport} e o treino é de ${SESSION_LABEL[sessionKind] ?? sessionKind}.`);
  }
  const observedKm = activity.distanceMeters != null ? activity.distanceMeters / 1000 : null;
  const observedMin = activity.durationSec != null ? activity.durationSec / 60 : null;
  if (farApart(session.durationMin, observedMin)) reasons.push(`A duração é bem diferente: treino de ${Math.round(session.durationMin as number)} min e atividade de ${Math.round(observedMin as number)} min.`);
  if (farApart(session.distanceKm, observedKm)) reasons.push(`A distância é bem diferente: treino de ${(session.distanceKm as number).toFixed(1).replace('.', ',')} km e atividade de ${(observedKm as number).toFixed(1).replace('.', ',')} km.`);
  return { level: reasons.length > 0 ? 'attention' : 'compatible', needsConfirmation: reasons.length > 0, reasons };
}
