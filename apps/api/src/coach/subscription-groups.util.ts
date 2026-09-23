// 23/09: fonte canonica UNICA para agrupar User.subscriptionStatus em "grupo de pagamento" visivel
// pro treinador (Confirmado / Cortesia / Atrasado / Pendente / Cancelado). Antes existiam 3 versoes
// quase-identicas dessa mesma conta espalhadas (coach.service.ts finance(), dashboard() e
// dataBusinessSummary() cada uma somando "active + grace" como pagante de forma independente) mais
// uma quarta copia no admin (apps/admin/app/page.tsx, ja removida em 23/09 quando o filtro virou
// server-side). Qualquer ajuste futuro no criterio (ex: novo subscriptionStatus) so precisa mudar
// aqui — nenhum outro arquivo deve reimplementar esta logica.
//
// IMPORTANTE: cortesia (manual_active) NUNCA conta como pagamento real em nenhuma metrica financeira
// (receita, MRR, "pagantes"). Isso e' regra de produto confirmada (ver signupFunnel/dashboard), nao
// deducao tecnica.

export type PaymentGroup = 'confirmed' | 'courtesy' | 'overdue' | 'pending' | 'canceled' | 'desconhecido';

export const CONFIRMED_STATUSES = ['active', 'grace'] as const;
export const COURTESY_STATUS = 'manual_active';
export const OVERDUE_STATUS = 'overdue';
export const PENDING_STATUS = 'pending';
export const CANCELED_STATUS = 'canceled';

export function paymentGroupOf(subscriptionStatus: string | null | undefined): PaymentGroup {
  if (subscriptionStatus === 'active' || subscriptionStatus === 'grace') return 'confirmed';
  if (subscriptionStatus === COURTESY_STATUS) return 'courtesy';
  if (subscriptionStatus === OVERDUE_STATUS) return 'overdue';
  if (subscriptionStatus === PENDING_STATUS) return 'pending';
  if (subscriptionStatus === CANCELED_STATUS) return 'canceled';
  return 'desconhecido';
}

export const PAYMENT_GROUP_LABEL: Record<PaymentGroup, string> = {
  confirmed: 'Confirmado',
  courtesy: 'Cortesia / liberação manual',
  overdue: 'Atrasado',
  pending: 'Pendente',
  canceled: 'Cancelado',
  desconhecido: 'Desconhecido',
};

// Preco atual por aluno pagante — unica fonte (ate existir plano com precos diferentes).
export const PRICE_PER_STUDENT_CENTS = 1990;

// "Pagante" = grupo 'confirmed' (subscriptionStatus active/grace). Cortesia NAO entra aqui de
// proposito — consolida a formula que estava duplicada em finance()/dashboard()/dataBusinessSummary().
export function estimatedMrrCents(payingCount: number): number {
  return payingCount * PRICE_PER_STUDENT_CENTS;
}
