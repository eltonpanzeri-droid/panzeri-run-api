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
// Aluna ATUAL = confirmado + cortesia + atrasado (a mesma definicao do total "Alunos" da Visao geral). Prospecto (pending) e ex-aluno (canceled) nao entram.
export const CURRENT_STUDENT_STATUSES = ['active', 'grace', 'manual_active', 'overdue'] as const;
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

// 15/10/2026 (decisao de Elton, Fase 1 do plano de revitalizacao do admin): TODA metrica de contagem por
// grupo de pagamento (Financeiro, resumo de negocio) usa a mesma populacao da Visao geral — alunas sem
// contas arquivadas. Antes, finance() e dataBusinessSummary() contavam arquivadas tambem e o mesmo grupo
// aparecia com numeros diferentes em telas diferentes (cortesia 9 x 10, atrasadas 10 x 12, prospectos 24 x 26).
// 05/11/2026: cadastros de teste (isTestAccount) ficam fora de TODA contagem; aparecem so' na secao "Cadastros de teste".
export const STUDENT_METRICS_POPULATION = { role: 'student', isTestAccount: false, accountStatus: { not: 'archived' } } as const;

// Preco atual por aluno pagante — unica fonte (ate existir plano com precos diferentes).
export const PRICE_PER_STUDENT_CENTS = 1990;

// Regras de Elton (05/11/2026): (1) PROSPECTO (subscriptionStatus 'pending', nunca pagou nem recebeu cortesia) NAO e' aluno: fica fora de toda conta/lista de alunas. (2) Quem PERDE a cortesia
// ('manual_active') NAO vira prospecto: vira EX-ALUNO ('canceled'). Esta funcao e' a unica que decide isso na mudanca manual de status.
export function statusAfterManualChange(previous: string | null | undefined, requested: string): string {
  return previous === COURTESY_STATUS && requested === PENDING_STATUS ? CANCELED_STATUS : requested;
}

// "Pagante" = grupo 'confirmed' (subscriptionStatus active/grace). Cortesia NAO entra aqui de
// proposito — consolida a formula que estava duplicada em finance()/dashboard()/dataBusinessSummary().
export function estimatedMrrCents(payingCount: number): number {
  return payingCount * PRICE_PER_STUDENT_CENTS;
}
