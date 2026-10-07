import { AppleCustomWorkoutSpecJson, NativeCustomWorkoutValidation, validateAppleSpecOnDevice } from './customWorkoutBridge';

// Orquestracao do envio de UMA TrainingSession real ao Apple Watch (WorkoutKit CustomWorkout). Logica pura, com dependencias injetadas (API do
// Panzeri Run e modulo nativo), para ser testada sem React Native. Idempotente: a identidade da entrega (WorkoutPlan.id) vive no servidor
// (WorkoutDelivery); tocar duas vezes, fechar e reabrir o app ou repetir em outro aparelho nunca cria um segundo workout.
//
// Pipeline (Etapa 7): API (TrainingSession -> CanonicalWorkout -> AppleCustomWorkoutSpec, gravado no WorkoutDelivery) -> aqui: validacao NATIVA do spec
// (sem agendar) -> autorizacao -> agendamento do CustomWorkout -> releitura de scheduledWorkouts -> 'sent'.
//
// Estados registrados (so' o que a evidencia permite): o servidor so' marca 'sent' depois que o WorkoutKit ACEITOU o agendamento — aqui,
// confirmado por o plano constar na lista de agendados do app. Nunca 'delivered_to_device' e nunca nada sobre execucao. Erros nativos sao
// preservados (codigo + mensagem reais) no resultado e no registro de falha da entrega.

export interface AppleDeliveryRef {
  id: string;
  status: string;
  planId: string;
  outdated: boolean;
}

export type AppleEligibility =
  | { eligible: false; reason: string }
  | { eligible: true; distanceKm: number; scheduledDate: string; delivery: AppleDeliveryRef | null };

export type ApplePrepare =
  | { eligible: false; reason: string }
  // spec = o AppleCustomWorkoutSpec da entrega (snapshot enviado); null so' para entrega antiga sem spec gravado.
  | { eligible: true; distanceKm: number; scheduledDate: string; delivery: AppleDeliveryRef; spec: AppleCustomWorkoutSpecJson | null };

export interface AppleWatchApi {
  prepare(sessionId: string): Promise<ApplePrepare>;
  confirmSent(deliveryId: string): Promise<unknown>;
  reportFailure(deliveryId: string, message: string): Promise<unknown>;
}

export interface AppleWatchNative {
  isSupported: boolean;
  // Constroi/valida o CustomWorkout no aparelho SEM agendar e SEM pedir autorizacao.
  validateCustomWorkoutSpec(specJson: string): NativeCustomWorkoutValidation;
  requestAuthorization(): Promise<string>;
  listScheduled(): Promise<Array<{ planId: string }>>;
  // Agenda o CustomWorkout do spec com o planId estavel da entrega. scheduled=false => spec recusado (errors); falha de autorizacao/agendamento rejeita.
  scheduleCustomWorkout(planId: string, specJson: string, date: Date): Promise<{ scheduled: boolean; errors?: Array<{ code: string; message: string; path: string }> }>;
}

export type SendResult =
  | { ok: true; state: 'scheduled' | 'already_scheduled'; planId: string }
  | { ok: false; reason: string; message: string };

// O que o card mostra ANTES do toque. O botao so' aparece para sessao elegivel (a API decide, com o tradutor Apple como unica fonte de verdade).
// Quando uma sessao de CORRIDA nao e' elegivel por um motivo que o aluno pode entender, ou quando a consulta falha, o card mostra uma linha curta
// dizendo o porque — a falha nunca e' silenciosa. Sessoes que nunca teriam o botao (forca, esteira, extra) e estados esperados (data passada, ja
// registrada) continuam sem nenhuma mensagem.
export type AppleWatchAvailability =
  | { show: 'button' }
  | { show: 'note'; note: string }
  | { show: 'nothing' };

const NOTE_BY_REASON: Record<string, string> = {
  goal_time_not_supported_yet: 'treino com passo por tempo ainda nao e suportado',
  passive_recovery_not_supported_yet: 'pausa passiva ainda nao e suportada',
  goal_open_not_supported: 'passo sem meta definida',
  distance_out_of_range: 'distancia total acima do limite aceito (100 km)',
  distancia_inconsistente: 'a distancia da estrutura nao confere com a do treino',
  nothing_to_translate: 'nenhum passo traduzivel',
  repeat_count_invalid: 'repeticoes invalidas no treino',
};

export function appleWatchAvailability(result: AppleEligibility | { error: string } | null): AppleWatchAvailability {
  if (!result) return { show: 'nothing' };
  if ('error' in result) return { show: 'note', note: `Nao foi possivel verificar o envio ao Apple Watch (${result.error}).` };
  if (result.eligible) return { show: 'button' };
  const note = NOTE_BY_REASON[result.reason] ?? (result.reason.startsWith('canonical_') ? 'a estrutura do treino esta incompleta' : null);
  return note ? { show: 'note', note: `Envio ao Apple Watch indisponivel: ${note}.` } : { show: 'nothing' };
}

// 'YYYY-MM-DD' (dia da sessao) -> meio-dia LOCAL do aparelho: o WorkoutKit agenda por componentes (ano/mes/dia/hora/minuto) no calendario do
// aparelho, e meio-dia evita que um fuso desloque o dia.
export function sessionDateToLocalNoon(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function describeNativeError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return typeof code === 'string' && !message.includes(code) ? `${code}: ${message}` : message;
}

export async function sendSessionToAppleWatch(sessionId: string, api: AppleWatchApi, native: AppleWatchNative): Promise<SendResult> {
  if (!native.isSupported) return { ok: false, reason: 'nao_suportado', message: 'Disponivel apenas no app nativo do iPhone.' };

  // 1) valida a sessao e cria/reutiliza a identidade persistente da entrega (servidor)
  const prepared = await api.prepare(sessionId);
  if (!prepared.eligible) return { ok: false, reason: prepared.reason, message: 'Este treino nao pode ser enviado ao Apple Watch.' };
  const { delivery, scheduledDate } = prepared;

  // 2) ja' agendada? (consulta o proprio WorkoutKit: sobrevive a reabrir o app e a erro entre agendar e registrar)
  const scheduledBefore = await native.listScheduled();
  if (scheduledBefore.some((item) => item.planId.toLowerCase() === delivery.planId.toLowerCase())) {
    if (delivery.status === 'pending') await api.confirmSent(delivery.id);
    return { ok: true, state: 'already_scheduled', planId: delivery.planId };
  }
  // O servidor diz 'sent' mas o aparelho nao tem o plano (removido do Apple Watch/Treino, ou outro aparelho): agenda de novo com a MESMA
  // identidade — nunca com um UUID novo. Se a prescricao mudou depois do envio, `outdated` e' informado e esta etapa nao reenvia automaticamente.
  if (delivery.outdated && delivery.status !== 'pending') {
    return { ok: false, reason: 'prescricao_alterada', message: 'A prescricao mudou depois do envio anterior.' };
  }
  if (!prepared.spec) {
    // Entrega de uma versao antiga do envio (sem spec gravado): nao ha o que agendar com seguranca.
    if (delivery.status === 'pending') await api.reportFailure(delivery.id, 'entrega sem especificacao Apple gravada');
    return { ok: false, reason: 'sem_especificacao', message: 'A entrega nao tem a especificacao do treino.' };
  }
  const spec = prepared.spec;
  const specJson = JSON.stringify(spec);

  // 3) valida o spec NO APARELHO (WorkoutKit supports*/dataRepresentation), sem agendar e sem pedir autorizacao
  const validation = validateAppleSpecOnDevice({ isSupported: native.isSupported, validateCustomWorkoutSpec: native.validateCustomWorkoutSpec }, spec);
  if (!validation.ok) {
    const message = validation.errors.map((e) => `${e.code}${e.path ? ` @ ${e.path}` : ''}: ${e.message}`).join(' | ');
    if (delivery.status === 'pending') await api.reportFailure(delivery.id, `${validation.reason}: ${message}`);
    return { ok: false, reason: 'validacao_nativa', message: `${validation.reason}: ${message}` };
  }

  // 4) autoriza e agenda o CustomWorkout (erro nativo real preservado)
  try {
    const authorization = await native.requestAuthorization();
    if (authorization !== 'authorized') throw new Error(`WorkoutKit nao autorizado (${authorization}).`);
    const scheduled = await native.scheduleCustomWorkout(delivery.planId, specJson, sessionDateToLocalNoon(scheduledDate));
    if (!scheduled.scheduled) {
      const detail = (scheduled.errors ?? []).map((e) => `${e.code}${e.path ? ` @ ${e.path}` : ''}: ${e.message}`).join(' | ') || 'spec recusado no agendamento';
      throw new Error(detail);
    }
  } catch (error) {
    const message = describeNativeError(error);
    if (delivery.status === 'pending') await api.reportFailure(delivery.id, message);
    return { ok: false, reason: 'falha_workoutkit', message };
  }

  // 5) so' registra 'enviado' se o agendamento consta no WorkoutKit (evidencia real do que foi aceito)
  const scheduledAfter = await native.listScheduled();
  if (!scheduledAfter.some((item) => item.planId.toLowerCase() === delivery.planId.toLowerCase())) {
    if (delivery.status === 'pending') await api.reportFailure(delivery.id, 'agendamento nao confirmado na lista do WorkoutKit');
    return { ok: false, reason: 'agendamento_nao_confirmado', message: 'O agendamento nao foi confirmado pelo WorkoutKit.' };
  }
  if (delivery.status === 'pending') await api.confirmSent(delivery.id);
  return { ok: true, state: 'scheduled', planId: delivery.planId };
}

// Texto do card depois do toque. Para falhas do WorkoutKit/validacao nativa, o ERRO NATIVO REAL (codigo e mensagem) e' mostrado junto da explicacao:
// nunca fica escondido atras de um texto generico.
const FRIENDLY_BY_REASON: Record<string, string> = {
  prescricao_alterada: 'A prescrição mudou depois do envio anterior.',
  falha_workoutkit: 'Não foi possível agendar no Apple Watch.',
  validacao_nativa: 'O iPhone recusou a estrutura do treino.',
  agendamento_nao_confirmado: 'O agendamento não foi confirmado pelo iPhone.',
  sem_especificacao: 'Esta entrega é de uma versão antiga e não tem o treino gravado.',
  nao_suportado: 'Disponível apenas no app do iPhone.',
};

export function sendResultMessage(result: SendResult): string {
  if (result.ok) return result.state === 'already_scheduled' ? 'Já estava agendado no Apple Watch.' : 'Agendado no Apple Watch. Confira no app Treino do iPhone/Watch.';
  const friendly = FRIENDLY_BY_REASON[result.reason];
  if (!friendly) return result.message;
  return result.reason === 'falha_workoutkit' || result.reason === 'validacao_nativa' ? `${friendly} (${result.message})` : friendly;
}
