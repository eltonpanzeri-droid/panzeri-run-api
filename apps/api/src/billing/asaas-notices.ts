// Avisos do Asaas ao treinador (Telegram) e regra de "cobranca mais recente" (17/11/2026, caso Fernando Teodoro, Cod. 0000058). Funcoes puras, testaveis sem banco.
//
// Por que existe: na cobranca por CARTAO o Asaas manda dois avisos para o MESMO pagamento: PAYMENT_CONFIRMED (cartao aprovado, no dia) e PAYMENT_RECEIVED (dinheiro liberado, cerca de 30 dias depois). O
// segundo chegou quando a mensalidade seguinte ja' estava vencida e foi tratado como pagamento novo: reativou o aluno e mandou "Pagamento recebido". Agora cada aviso tem texto proprio, e um aviso de
// "pago" de uma cobranca que NAO e' a mais recente nao reativa ninguem.

export type AsaasNoticeKind = 'captured' | 'settled' | 'overdue';

// 'YYYY-MM-DD' (ou ISO completo) -> 'dd/mm/aa'. Sem data valida devolve null.
export function shortBrDate(value: string | null | undefined): string | null {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1].slice(2)}` : null;
}

const who = (name: string, code: string) => `${name} (Cod. ${code})`;

// 1) O aluno pagou (cartao aprovado); o Asaas ainda vai liberar o dinheiro.
export function capturedNotice(input: { name: string; code: string; dueDate: string | null; creditDate: string | null; firstPayment?: boolean }): string {
  const due = shortBrDate(input.dueDate);
  const credit = shortBrDate(input.creditDate);
  return `Aluno ${who(input.name, input.code)} fez o pagamento referente ao vencimento ${due ?? '(data não informada)'}. O Asaas vai efetivar o pagamento ${credit ? `em ${credit}` : 'em data ainda não informada pelo Asaas'}.${input.firstPayment ? '\n\nPrimeiro pagamento deste aluno.' : ''}`;
}

// 2) O banco Asaas liberou o dinheiro.
export function settledNotice(input: { name: string; code: string; dueDate: string | null; firstPayment?: boolean }): string {
  const due = shortBrDate(input.dueDate);
  return `O banco Asaas efetivou o pagamento do aluno ${who(input.name, input.code)} referente ao vencimento ${due ?? '(data não informada)'}.${input.firstPayment ? '\n\nPrimeiro pagamento deste aluno.' : ''}`;
}

// 3) O aluno ficou atrasado: qual mensalidade e quando venceu.
export function overdueNotice(input: { name: string; code: string; dueDate: string | null }): string {
  const due = shortBrDate(input.dueDate);
  return `O aluno ${who(input.name, input.code)} está com a mensalidade de vencimento ${due ?? '(data não informada)'} atrasada.`;
}

// Regra de Elton: o atraso so' pode ser avisado a partir do DIA SEGUINTE ao vencimento (o aluno pode pagar ate o fim do dia). `todaySp` = 'YYYY-MM-DD' de hoje em Sao Paulo.
export function isOverdueDay(dueDate: string | null | undefined, todaySp: string): boolean {
  return typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dueDate) && dueDate.slice(0, 10) < todaySp;
}

export function noticeKindOfEvent(event: string | undefined): AsaasNoticeKind | null {
  if (event === 'PAYMENT_CONFIRMED') return 'captured';
  if (event === 'PAYMENT_RECEIVED') return 'settled';
  if (event === 'PAYMENT_OVERDUE') return 'overdue';
  return null; // reembolso/estorno NAO sao "atraso": nao geram o aviso de atraso
}

export interface PaymentLike { id?: string; status?: string; dueDate?: string; dateCreated?: string }

// Cobranca mais recente que ja' conta (a mesma regra da sincronizacao diaria): cobranca "pendente" com vencimento hoje ou no futuro ainda nao conta como atrasada nem como paga.
export function pickLatestRelevantPayment<T extends PaymentLike>(payments: readonly T[], todaySp: string): { relevant: T[]; latest: T | undefined } {
  const relevant = payments.filter((payment) => {
    const status = (payment.status ?? '').toLowerCase();
    const isFuturePending = status === 'pending' && payment.dueDate ? payment.dueDate >= todaySp : false;
    return !isFuturePending;
  });
  const latest = [...relevant].sort((a, b) => (a.dueDate ?? a.dateCreated ?? '').localeCompare(b.dueDate ?? b.dateCreated ?? '')).at(-1);
  return { relevant, latest };
}

// Um aviso de "pago" e' ANTIGO (nao pode reativar ninguem) quando a cobranca mais recente e' OUTRA e nao esta paga. Sem cobranca mais recente diferente, vale o aviso.
export function isStalePaidEvent(paymentId: string, payments: readonly PaymentLike[], todaySp: string, paidStatuses: ReadonlySet<string>): boolean {
  const { latest } = pickLatestRelevantPayment(payments, todaySp);
  if (!latest || !latest.id || latest.id === paymentId) return false;
  return !paidStatuses.has((latest.status ?? '').toLowerCase());
}
