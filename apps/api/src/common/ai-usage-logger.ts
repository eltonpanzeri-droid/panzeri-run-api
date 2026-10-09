import { Logger } from '@nestjs/common';
import { AI_RATES_USD_PER_MTOK, AiRates } from './ai-models.config';

// Observabilidade de custo real de IA (28/09/2026; custo estimado em 09/10/2026) — uma linha por chamada, com os numeros que a
// propria Anthropic devolve (nunca estimados) e o custo calculado a partir deles com a tabela de tarifas de ai-models.config.ts.
// Log puro (reaproveita o Logger de cada service, sem tabela/servico novo). NUNCA loga texto do aluno nem conteudo da conversa,
// so numeros/metadados.
export interface AiUsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  // Detalhe da gravacao por TTL (presente quando a API informa); sem ele, toda gravacao e' tratada como de 5 min.
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
}

export interface AiCallCost {
  inputTotalTokens: number;
  cache5mTokens: number;
  cache1hTokens: number;
  usd: number;
  usdWithoutCache: number;
  // Positivo = o cache economizou; NEGATIVO = o cache custou mais do que custaria sem ele (gravacoes sem leituras suficientes).
  cacheSavingsUsd: number;
}

// Funcao pura (testavel). Retorna null para modelo sem tarifa cadastrada — o log mostra n/d em vez de inventar um numero.
export function estimateCallCost(model: string, usage: AiUsageLike): AiCallCost | null {
  const entry = AI_RATES_USD_PER_MTOK[model];
  if (!entry) return null;
  const read = usage.cache_read_input_tokens ?? 0;
  const created = usage.cache_creation_input_tokens ?? 0;
  const created1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const created5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, created - created1h);
  const inputTotal = usage.input_tokens + read + created;
  const rates: AiRates = entry.longPrompt && inputTotal > entry.longPrompt.aboveTokens ? entry.longPrompt.rates : entry.standard;
  const usd = (usage.input_tokens * rates.input + created5m * rates.cacheWrite5m + created1h * rates.cacheWrite1h + read * rates.cacheRead + usage.output_tokens * rates.output) / 1_000_000;
  const usdWithoutCache = (inputTotal * rates.input + usage.output_tokens * rates.output) / 1_000_000;
  return { inputTotalTokens: inputTotal, cache5mTokens: created5m, cache1hTokens: created1h, usd, usdWithoutCache, cacheSavingsUsd: usdWithoutCache - usd };
}

const money = (value: number) => value.toFixed(6);

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
  const cost = estimateCallCost(model, usage);
  logger.log(
    `[custo-ia] agente=${agent} modelo=${model} input_tokens=${usage.input_tokens} output_tokens=${usage.output_tokens} ` +
    `cache_read_tokens=${usage.cache_read_input_tokens ?? 0} cache_creation_tokens=${usage.cache_creation_input_tokens ?? 0} ` +
    (cost
      ? `cache_5m_tokens=${cost.cache5mTokens} cache_1h_tokens=${cost.cache1hTokens} input_total_tokens=${cost.inputTotalTokens} ` +
        `custo_usd=${money(cost.usd)} custo_sem_cache_usd=${money(cost.usdWithoutCache)} economia_cache_usd=${money(cost.cacheSavingsUsd)} `
      : 'custo_usd=n/d ') +
    `duracao_ms=${durationMs}${ttl ? ` ttl=${ttl}` : ''}${extra ? ` ${extra}` : ''}`,
  );
}
