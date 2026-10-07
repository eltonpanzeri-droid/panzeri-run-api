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

// O que o card mostra ANTES do toque. O botao so' aparece para sessao elegivel (a API decide; as regras nao mudam aqui). Quando uma sessao de CORRIDA
// nao e' elegivel por um motivo que o aluno pode entender (varias partes, intervalado, por tempo, distancia), ou quando a consulta falha, o card
// mostra uma linha curta dizendo o porque — antes a falha era silenciosa e o botao simplesmente sumia sem explicacao. Sessoes que nunca teriam o
// botao (forca, esteira, extra) e estados esperados (data passada, ja registrada) continuam sem nenhuma mensagem.
export type AppleWatchAvailability =
  | { show: 'button' }
  | { show: 'note'; note: string }
  | { show: 'nothing' };

const NOTE_BY_REASON: Record<string, string> = {
  varias_partes: 'este treino tem varias partes (por enquanto so corrida continua)',
  intervalado: 'treino intervalado ainda nao e suportado',
  por_tempo: 'treino por tempo ainda nao e suportado (por enquanto so corrida por distancia)',
  distancia_invalida: 'distancia do treino invalida ou ausente',
  distancia_inconsistente: 'a distancia da estrutura nao confere com a do treino',
};

export function appleWatchAvailability(result: AppleEligibility | { error: string } | null): AppleWatchAvailability {
  if (!result) return { show: 'nothing' };
  if ('error' in result) return { show: 'note', note: `Nao foi possivel verificar o envio ao Apple Watch (${result.error}).` };
  if (result.eligible) return { show: 'button' };
  const note = NOTE_BY_REASON[result.reason];
  return note ? { show: 'note', note: `Envio ao Apple Watch indisponivel: ${note}.` } : { show: 'nothing' };
}

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
