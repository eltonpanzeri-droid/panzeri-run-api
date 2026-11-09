// Aviso de feedback nos cartoes de treino (09/11/2026, ordem de Elton): a aluna ve, em cada treino, se o feedback foi enviado ou esta pendente (para ser induzida a completar).
// Mesma definicao do servidor (weekly-checkin.service, pendingFeedbacksForPlan): pendente = treino realizado sem conclusao ou sem esforco percebido (RPE). Treino "nao feito" nao cobra feedback.

export type FeedbackBadgeState = 'done' | 'pending' | null;

export function feedbackBadge(input: {
  hasRealized: boolean;
  isAlternative: boolean;
  completion: { status?: string | null; perceivedEffort?: number | null } | null | undefined;
}): FeedbackBadgeState {
  const status = input.completion?.status ?? null;
  if (status === 'missed') return null; // ela ja disse que nao fez
  if (input.isAlternative) return null; // atividade alternativa tem o proprio texto ("Registrar feedback")
  const performed = input.hasRealized || status === 'done' || status === 'adjusted';
  if (!performed) return null;
  return input.completion?.perceivedEffort != null ? 'done' : 'pending';
}

export const FEEDBACK_BADGE_TEXT: Record<'done' | 'pending', string> = {
  done: '✓ Feedback enviado',
  pending: 'Feedback pendente · toque e responda',
};
