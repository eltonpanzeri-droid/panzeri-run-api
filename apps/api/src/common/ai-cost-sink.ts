// Ponto de passagem do custo real de cada chamada de IA (01/11/2026). Arquivo FOLHA (sem dependencia de servicos): ai-usage-logger.ts publica aqui e
// AiCostRecorderService (que tem acesso ao banco) se registra como destino ao iniciar. Assim os 5 servicos de agentes nao precisam conhecer o banco.
// So' numeros e metadados: nunca texto de aluno nem conteudo de prompt/resposta.

export interface AiCostRecord {
  agent: string;
  model: string;
  effort: string | null;
  userId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  costWithoutCacheUsd: number;
  inputUsd: number;
  cacheWriteUsd: number;
  cacheReadUsd: number;
  outputUsd: number;
  durationMs: number;
  /** Medicao de tamanho por bloco (somente contagens). */
  detail: Record<string, unknown> | null;
}

type AiCostSink = (record: AiCostRecord) => void;

let sink: AiCostSink | null = null;

export function setAiCostSink(next: AiCostSink | null): void {
  sink = next;
}

/** Nunca lanca: registrar custo e' observabilidade e jamais pode afetar a chamada de IA que o originou. */
export function emitAiCost(record: AiCostRecord): void {
  try {
    sink?.(record);
  } catch {
    // observabilidade nao pode quebrar a geracao
  }
}
