import { AppleEligibility, AppleWatchApi, AppleWatchNative, sendSessionToAppleWatch } from './sendSessionToAppleWatch';

// Envio AUTOMATICO dos treinos da semana ao Apple Watch (ordem de Elton, 06/11/2026): ao abrir o Panzeri Run, os treinos que a API considera elegiveis e que ainda nao foram enviados
// seguem sozinhos para o relogio, sem a aluna tocar em nada. Logica pura (dependencias injetadas), testada sem React Native.
//
// Regras de seguranca (o que NAO faz):
//  - so' roda depois de a aluna ter feito UM envio manual com sucesso (a permissao do iPhone ja foi dada: nada de pedir permissao do nada ao abrir o Panzeri Run);
//  - nunca reenvia o que ja foi enviado, nem o que mudou depois do envio (o toque manual continua sendo o caminho para isso);
//  - cada sessao e' tentada no maximo UMA vez por abertura do Panzeri Run (sem laco de repeticao em caso de erro);
//  - esteira E' corrida (a elegibilidade e' decidida pela API, a mesma de sempre);
//  - para na primeira falta de autorizacao do iPhone (nao fica insistindo).

export const AUTO_SEND_STORAGE_KEY = 'panzeri:appleWatchAutoSend:v1';
export const AUTO_SEND_WINDOW_DAYS = 7;

export interface AutoSendSession {
  id: string;
  isoDate?: string | null;
  completion?: unknown;
}

export interface AutoSendDeps {
  api: AppleWatchApi;
  native: AppleWatchNative;
  eligibility(sessionId: string): Promise<AppleEligibility>;
  todayIso: string;
  // sessoes ja tentadas nesta abertura do Panzeri Run (compartilhado entre chamadas)
  attempted: Set<string>;
}

export interface AutoSendSummary {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  stoppedReason?: 'sem_autorizacao';
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Treinos de hoje em diante, ate' 7 dias, ainda sem feedback registrado (o resto nem e' consultado).
export function sessionsToAutoSend(sessions: AutoSendSession[] | null | undefined, todayIso: string): AutoSendSession[] {
  const last = addDaysIso(todayIso, AUTO_SEND_WINDOW_DAYS);
  return (sessions ?? [])
    .filter((session) => Boolean(session.isoDate) && !session.completion && (session.isoDate as string) >= todayIso && (session.isoDate as string) <= last)
    .sort((a, b) => ((a.isoDate as string) < (b.isoDate as string) ? -1 : 1));
}

export async function autoSendWeekToAppleWatch(sessions: AutoSendSession[] | null | undefined, deps: AutoSendDeps): Promise<AutoSendSummary> {
  const summary: AutoSendSummary = { considered: 0, sent: 0, skipped: 0, failed: 0 };
  if (!deps.native.isSupported) return summary;
  for (const session of sessionsToAutoSend(sessions, deps.todayIso)) {
    if (deps.attempted.has(session.id)) continue;
    deps.attempted.add(session.id);
    summary.considered += 1;
    let eligibility: AppleEligibility;
    try {
      eligibility = await deps.eligibility(session.id);
    } catch {
      summary.failed += 1;
      continue;
    }
    // so' o que a API aprova E ainda nao tem entrega concluida/alterada: sem entrega, ou entrega ainda pendente.
    if (!eligibility.eligible || (eligibility.delivery && eligibility.delivery.status !== 'pending')) {
      summary.skipped += 1;
      continue;
    }
    try {
      const result = await sendSessionToAppleWatch(session.id, deps.api, deps.native);
      if (result.ok) {
        summary.sent += 1;
        continue;
      }
      summary.failed += 1;
      if (result.reason === 'falha_workoutkit' && /nao autorizado/i.test(result.message)) {
        summary.stoppedReason = 'sem_autorizacao';
        break;
      }
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}
