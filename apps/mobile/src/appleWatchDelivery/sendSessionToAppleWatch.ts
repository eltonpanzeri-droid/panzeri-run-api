// Orquestracao do envio de UMA TrainingSession real ao Apple Watch (WorkoutKit). Logica pura, com dependencias injetadas (API do Panzeri Run e
// modulo nativo), para ser testada sem React Native. Idempotente: a identidade da entrega (WorkoutPlan.id) vive no servidor
// (WorkoutDelivery); tocar duas vezes, fechar e reabrir o app ou repetir em outro aparelho nunca cria um segundo workout.
//
// Estados registrados (so' o que a evidencia permite): o servidor so' marca 'sent' depois que o WorkoutKit ACEITOU o agendamento — aqui,
// confirmado por o plano constar na lista de agendados do app. Nunca 'delivered_to_device' e nunca nada sobre execucao.

export type AppleEligibility =
  | { eligible: false; reason: string }
  | { eligible: true; distanceKm: number; scheduledDate: string; delivery: { id: string; status: string; planId: string; outdated: boolean } | null };

export type ApplePrepare =
  | { eligible: false; reason: string }
  | { eligible: true; distanceKm: number; scheduledDate: string; delivery: { id: string; status: string; planId: string; outdated: boolean } };

export interface AppleWatchApi {
  prepare(sessionId: string): Promise<ApplePrepare>;
  confirmSent(deliveryId: string): Promise<unknown>;
  reportFailure(deliveryId: string, message: string): Promise<unknown>;
}

export interface AppleWatchNative {
  isSupported: boolean;
  requestAuthorization(): Promise<string>;
  listScheduled(): Promise<Array<{ planId: string }>>;
  scheduleRun(planId: string, distanceKm: number, date: Date): Promise<unknown>;
}

export type SendResult =
  | { ok: true; state: 'scheduled' | 'already_scheduled'; planId: string }
  | { ok: false; reason: string; message: string };

// 'YYYY-MM-DD' (dia da sessao) -> meio-dia LOCAL do aparelho: o WorkoutKit agenda por componentes (ano/mes/dia/hora/minuto) no calendario do
// aparelho, e meio-dia evita que um fuso desloque o dia.
export function sessionDateToLocalNoon(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

export async function sendSessionToAppleWatch(sessionId: string, api: AppleWatchApi, native: AppleWatchNative): Promise<SendResult> {
  if (!native.isSupported) return { ok: false, reason: 'nao_suportado', message: 'Disponivel apenas no app nativo do iPhone.' };

  // 1) valida a sessao e cria/reutiliza a identidade persistente da entrega (servidor)
  const prepared = await api.prepare(sessionId);
  if (!prepared.eligible) return { ok: false, reason: prepared.reason, message: 'Este treino nao pode ser enviado ao Apple Watch.' };
  const { delivery, distanceKm, scheduledDate } = prepared;

  // 2) ja' agendada? (consulta o proprio WorkoutKit: sobrevive a reabrir o app e a erro entre agendar e registrar)
  const scheduledBefore = await native.listScheduled();
  if (scheduledBefore.some((item) => item.planId.toLowerCase() === delivery.planId.toLowerCase())) {
    if (delivery.status === 'pending') await api.confirmSent(delivery.id);
    return { ok: true, state: 'already_scheduled', planId: delivery.planId };
  }
  // O servidor diz 'sent' mas o aparelho nao tem o plano (removido do Apple Watch/Treino, ou outro aparelho): agenda de novo com a MESMA
  // identidade — nunca com um UUID novo.
  // (se a prescricao mudou depois do envio, `outdated` e' informado, mas esta etapa nao reenvia automaticamente)
  if (delivery.outdated && delivery.status !== 'pending') {
    return { ok: false, reason: 'prescricao_alterada', message: 'A prescricao mudou depois do envio anterior.' };
  }

  // 3) agenda no WorkoutKit
  try {
    const authorization = await native.requestAuthorization();
    if (authorization !== 'authorized') throw new Error(`WorkoutKit nao autorizado (${authorization}).`);
    await native.scheduleRun(delivery.planId, distanceKm, sessionDateToLocalNoon(scheduledDate));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (delivery.status === 'pending') await api.reportFailure(delivery.id, message);
    return { ok: false, reason: 'falha_workoutkit', message };
  }

  // 4) so' registra 'enviado' se o agendamento consta no WorkoutKit (evidencia real do que foi aceito)
  const scheduledAfter = await native.listScheduled();
  if (!scheduledAfter.some((item) => item.planId.toLowerCase() === delivery.planId.toLowerCase())) {
    if (delivery.status === 'pending') await api.reportFailure(delivery.id, 'agendamento nao confirmado na lista do WorkoutKit');
    return { ok: false, reason: 'agendamento_nao_confirmado', message: 'O agendamento nao foi confirmado pelo WorkoutKit.' };
  }
  if (delivery.status === 'pending') await api.confirmSent(delivery.id);
  return { ok: true, state: 'scheduled', planId: delivery.planId };
}
