import { Logger } from '@nestjs/common';

// Observabilidade de custo real de IA (28/09/2026) — uma linha por chamada, com os numeros que a
// propria Anthropic devolve (nunca estimados). Log puro (reaproveita o Logger de cada service, sem
// tabela/servico novo) — o objetivo agora e permitir analise de custo por agente depois, nunca um
// painel novo. NUNCA loga texto do aluno nem conteudo da conversa, so numeros/metadados.
export interface AiUsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function logAiUsage(
  logger: Logger,
  params: {
    agent: string;
    model: string;
    usage: AiUsageLike;
    durationMs: number;
    ttl?: string;
    extra?: string;
  },
): void {
  const { agent, model, usage, durationMs, ttl, extra } = params;
  logger.log(
    `[custo-ia] agente=${agent} modelo=${model} input_tokens=${usage.input_tokens} output_tokens=${usage.output_tokens} ` +
    `cache_read_tokens=${usage.cache_read_input_tokens ?? 0} cache_creation_tokens=${usage.cache_creation_input_tokens ?? 0} ` +
    `duracao_ms=${durationMs}${ttl ? ` ttl=${ttl}` : ''}${extra ? ` ${extra}` : ''}`,
  );
}
