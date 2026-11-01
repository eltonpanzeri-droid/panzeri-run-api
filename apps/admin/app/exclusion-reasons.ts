// Motivos aceitos pela API para ignorar/excluir uma atividade do relogio (mesmos codigos de apps/api/src/activity-execution/activity-exclusion.ts). Fonte unica das telas do painel.
export const EXCLUSION_REASONS: Array<[string, string]> = [
  ['same_workout_registered', 'É o mesmo treino que já está registrado'],
  ['not_mine_or_error', 'Não é da aluna ou o relógio errou'],
  ['dont_count', 'A aluna não quer que conte'],
  ['other', 'Outro motivo'],
];

export const EXCLUSION_REASON_LABEL: Record<string, string> = Object.fromEntries(EXCLUSION_REASONS);
