// Textos (pt-BR) mostrados ao aluno para cada transicao de uma conquista. So' traduz codigos ja gravados (nunca inventa causa).

const BY_REASON: Record<string, string> = {
  criterio_nao_atendido: 'Depois de uma correção nas suas atividades, o critério desta conquista deixou de ser atendido.',
  criterio_voltou_a_ser_atendido: 'Depois de uma nova correção, o critério desta conquista voltou a ser atendido.',
  periodo_ou_valor_diferente: 'A conquista continua válida: o período ou o valor que a comprova foi atualizado depois de uma correção.',
  conquista_comprovada_nao_registrada: 'Conquista concedida: o critério foi comprovado pelos seus registros.',
  volume_reconciliation_retracted: 'Revisão de volume: o cálculo anterior contava a mesma atividade mais de uma vez e o limiar não foi comprovado.',
};

const BY_TYPE: Record<string, string> = {
  granted: 'Conquistada',
  revoked: 'Revogada',
  reactivated: 'Reativada',
  adjusted: 'Atualizada',
};

export const transitionTypeLabel = (type: string): string => BY_TYPE[type] ?? type;

export function transitionReasonText(type: string, reason: string | null): string {
  if (reason && BY_REASON[reason]) return BY_REASON[reason];
  if (type === 'revoked') return 'O critério desta conquista deixou de ser atendido depois de uma correção.';
  if (type === 'reactivated') return 'O critério desta conquista voltou a ser atendido.';
  if (type === 'adjusted') return 'A conquista continua válida; a evidência foi atualizada depois de uma correção.';
  return 'Conquista concedida.';
}
