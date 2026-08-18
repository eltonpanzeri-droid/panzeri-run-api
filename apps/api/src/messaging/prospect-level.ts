// Extraido de CoachService.prospects() (18/08) pra ser reaproveitado tambem pelo motor de
// e-mails automaticos de recuperacao (ProspectNurtureService) — mesmo criterio de "temperatura"
// usado nos dois lugares, nunca duas logicas divergentes calculando a mesma coisa.
export type ProspectLevel = 'quente' | 'morno' | 'frio';

export function computeProspectLevel(input: {
  interviewCurrentStep: number | null | undefined;
  interviewAnswers: unknown;
  interviewCompletedAt: Date | null | undefined;
  hasCheckoutUrl: boolean;
}): { level: ProspectLevel; levelLabel: string } {
  const answerCount = input.interviewAnswers && typeof input.interviewAnswers === 'object'
    ? Object.keys(input.interviewAnswers as Record<string, unknown>).length
    : 0;
  const interviewStarted = Boolean((input.interviewCurrentStep ?? 0) > 0 || answerCount > 0);
  const interviewCompleted = Boolean(input.interviewCompletedAt);

  if (interviewCompleted && input.hasCheckoutUrl) {
    return { level: 'quente', levelLabel: 'Respondeu entrevista, cobranca criada, aguardando 1o pagamento' };
  }
  if (interviewCompleted) {
    return { level: 'morno', levelLabel: 'Entrevista concluida, cobranca ainda nao gerada' };
  }
  if (interviewStarted) {
    return { level: 'morno', levelLabel: 'Entrevista em andamento' };
  }
  return { level: 'frio', levelLabel: 'Nao respondeu nenhuma pergunta ainda' };
}
