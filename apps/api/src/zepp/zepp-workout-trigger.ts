// Pedido de sincronizacao de treinos com a Zepp (22/10/2026). Ponto de ENTRADA sem injecao de dependencia: qualquer servico (geracao de treino, edicao do treinador, abertura do app,
// autorizacao da aluna) chama requestZeppWorkoutSync(userId, motivo) DEPOIS de gravar, sem importar o modulo da Zepp (evita ciclo de modulos). Quem registra o tratador e' o agendador
// da Zepp (ZeppWorkoutSchedulerService), que decide se ha o que enviar. Nunca lanca erro e nunca espera: e' disparo-e-esquece, para jamais atrasar ou derrubar quem chamou.
export type ZeppWorkoutSyncReason = 'grant' | 'plan_generated' | 'session_regenerated' | 'session_edited' | 'session_removed' | 'session_rescheduled' | 'app_open';

type Handler = (userId: string, reason: ZeppWorkoutSyncReason) => void;
let handler: Handler | null = null;

export function setZeppWorkoutTriggerHandler(next: Handler | null): void {
  handler = next;
}

export function requestZeppWorkoutSync(userId: string, reason: ZeppWorkoutSyncReason): void {
  try {
    handler?.(userId, reason);
  } catch {
    /* pedido de sincronizacao nunca pode afetar o fluxo que o originou */
  }
}
