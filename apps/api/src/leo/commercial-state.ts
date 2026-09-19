// Estado comercial TEMPORAL de uma pessoa (19/09/2026, fundacao longitudinal do Panzeri Intelligence).
//
// Pergunta que este modulo responde de forma deterministica:
//   "No instante T, qual era a relacao comercial desta pessoa com o Panzeri Run?"
// Nunca usa o subscriptionStatus de HOJE para reescrever o passado: reprocessa o log imutavel de
// BillingEvent (baseline_snapshot + status_changed) ate T.
//
// Estados:
//  prospect      - nunca teve relacao comercial ativa ate T
//  active        - tinha relacao ativa em T (active, manual_active/cortesia, grace; e tambem 'overdue' de
//                  quem ja era assinante: atraso nao encerra a relacao — o status bruto vai junto)
//  ex_subscriber - ja teve relacao ativa e, em T, nao tinha mais (canceled / pending apos ter sido ativo)
//  reactivated   - voltou a ter relacao ativa DEPOIS de ter sido ex_subscriber (permanece 'reactivated'
//                  enquanto a relacao continuar ativa; um novo cancelamento volta a ex_subscriber)
//  unknown       - nao ha evidencia suficiente (nunca inventamos)
// 'basis' diz de onde veio a certeza, para o consumidor filtrar por confianca.

export type CommercialState = 'prospect' | 'active' | 'ex_subscriber' | 'reactivated' | 'unknown';

export type CommercialBasis =
  | 'no_account_yet'                // T anterior ao cadastro: por definicao nunca foi assinante
  | 'transition_log'                // reconstruido do log (certeza): a partir do baseline/cadastro
  | 'first_paid_bound'              // T anterior ao 1o pagamento confirmado (anterior ao log)
  | 'current_status_unchanged_since'// anterior ao log, mas o status atual nao mudou desde antes de T
  | 'insufficient_history';         // anterior ao log e o status mudou depois de T sem registro

export interface BillingLogEvent {
  event: string; // 'baseline_snapshot' | 'status_changed' | (outros sao ignorados)
  at: Date;
  prevStatus: string | null;
  nextStatus: string | null;
  ref: string | null;
}

export interface CommercialUserFacts {
  createdAt: Date;
  currentStatus: string;
  statusUpdatedAt: Date | null;
  firstPaidAt: Date | null;
  hasStudentCode: boolean;
}

export interface CommercialStateResult {
  state: CommercialState;
  subscriptionStatus: string | null;
  basis: CommercialBasis;
}

export const ACCESS_STATUSES = new Set(['active', 'manual_active', 'grace']);

type Machine = { state: 'prospect' | 'active' | 'ex_subscriber' | 'reactivated'; everActive: boolean };

function initialMachine(status: string, everActive: boolean): Machine {
  if (ACCESS_STATUSES.has(status)) return { state: 'active', everActive: true };
  if (status === 'overdue') return { state: everActive ? 'active' : 'prospect', everActive };
  return { state: everActive ? 'ex_subscriber' : 'prospect', everActive };
}

function step(machine: Machine, prev: string | null, next: string): Machine {
  if (ACCESS_STATUSES.has(next)) {
    return { state: machine.state === 'ex_subscriber' || machine.state === 'reactivated' ? 'reactivated' : 'active', everActive: true };
  }
  // Atraso nao encerra a relacao: quem era assinante continua no mesmo estado; quem nunca foi, segue prospect.
  if (next === 'overdue') return machine.everActive ? machine : { state: 'prospect', everActive: false };
  // Assinante em atraso que gera novo checkout volta a 'pending' por mecanica do app — nao e' perda de relacao.
  if (next === 'pending' && prev === 'overdue') return machine;
  return { state: machine.everActive ? 'ex_subscriber' : 'prospect', everActive: machine.everActive };
}

export function deriveCommercialState(
  events: BillingLogEvent[],
  facts: CommercialUserFacts,
  at: Date,
  // Instante em que o log passou a existir (menor timestamp de baseline_snapshot no banco). Usado para
  // pessoas cadastradas DEPOIS dele, que nao tem baseline proprio (nasceram com status 'pending').
  logStartedAt: Date | null,
): CommercialStateResult {
  const t = at.getTime();
  if (t < facts.createdAt.getTime()) {
    return { state: 'prospect', subscriptionStatus: null, basis: 'no_account_yet' };
  }

  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const baseline = sorted.find((e) => e.event === 'baseline_snapshot' && e.nextStatus);

  let start: { at: Date; status: string; everActive: boolean } | null = null;
  if (baseline?.nextStatus) {
    start = {
      at: baseline.at,
      status: baseline.nextStatus,
      everActive: ACCESS_STATUSES.has(baseline.nextStatus) || baseline.ref === 'baseline:had_access',
    };
  } else if (logStartedAt && facts.createdAt.getTime() >= logStartedAt.getTime()) {
    start = { at: facts.createdAt, status: 'pending', everActive: false };
  }

  if (start && t >= start.at.getTime()) {
    let machine = initialMachine(start.status, start.everActive);
    let status = start.status;
    for (const e of sorted) {
      if (e.event !== 'status_changed' || !e.nextStatus) continue;
      if (e.at.getTime() < start.at.getTime()) continue;
      if (e.at.getTime() > t) break;
      machine = step(machine, e.prevStatus, e.nextStatus);
      status = e.nextStatus;
    }
    return { state: machine.state, subscriptionStatus: status, basis: 'transition_log' };
  }

  // Anterior ao log: so' afirmamos o que e' provavel por construcao; caso contrario, 'unknown'.
  if (facts.firstPaidAt && t < facts.firstPaidAt.getTime()) {
    return { state: 'prospect', subscriptionStatus: null, basis: 'first_paid_bound' };
  }
  if (!facts.statusUpdatedAt || facts.statusUpdatedAt.getTime() <= t) {
    const machine = initialMachine(facts.currentStatus, ACCESS_STATUSES.has(facts.currentStatus) || facts.hasStudentCode);
    return { state: machine.state, subscriptionStatus: facts.currentStatus, basis: 'current_status_unchanged_since' };
  }
  return { state: 'unknown', subscriptionStatus: null, basis: 'insufficient_history' };
}

// Provider de uma linha de BillingEvent, derivado do prefixo de externalRef ("asaas:...", "revenuecat:...",
// "coupon:...", "student:...", "coach:..."). payment_confirmed usa o paymentId puro do Asaas ("pay_...").
export function providerFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const idx = ref.indexOf(':');
  if (idx > 0) return ref.slice(0, idx);
  return ref.startsWith('pay_') ? 'asaas' : null;
}
