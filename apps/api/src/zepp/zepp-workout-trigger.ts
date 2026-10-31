// Pedido de sincronizacao de treinos com a Zepp (22/10/2026). Ponto de ENTRADA sem injecao de dependencia: qualquer servico (geracao de treino, edicao do treinador, abertura do app,
// autorizacao da aluna) chama requestZeppWorkoutSync(userId, motivo) DEPOIS de gravar, sem importar o modulo da Zepp (evita ciclo de modulos). Quem registra o tratador e' o agendador
// da Zepp (ZeppWorkoutSchedulerService), que decide se ha o que enviar. Nunca lanca erro e nunca espera: e' disparo-e-esquece, para jamais atrasar ou derrubar quem chamou.
export type ZeppWorkoutSyncReason = 'grant' | 'plan_generated' | 'session_regenerated' | 'session_edited' | 'session_removed' | 'session_rescheduled' | 'app_open';

type Handler = (userId: string, reason: ZeppWorkoutSyncReason) => void;
let handler: Handler | null = null;

export function setZeppWorkoutTriggerHandler(next: Handler | null): void {
  handler = next;
}

// Outros provedores que recebem treino (COROS, 30/10/2026) se registram aqui e passam a ser avisados pelos MESMOS pontos de chamada (geracao, edicao, remocao, reagendamento, abertura do app),
// sem espalhar uma segunda chamada por cada servico de treino. Cada ouvinte decide se a aluna tem a conexao e a autorizacao dele.
const listeners = new Set<Handler>();
export function addWorkoutSyncListener(listener: Handler): void {
  listeners.add(listener);
}

export function requestZeppWorkoutSync(userId: string, reason: ZeppWorkoutSyncReason): void {
  try {
    handler?.(userId, reason);
  } catch {
    /* pedido de sincronizacao nunca pode afetar o fluxo que o originou */
  }
  for (const listener of listeners) {
    try {
      listener(userId, reason);
    } catch {
      /* um ouvinte com defeito nao pode afetar os demais nem o fluxo que originou o pedido */
    }
  }
}
