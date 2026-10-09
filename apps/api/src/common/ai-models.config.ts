// Configuracao centralizada dos modelos de IA usados pelos agentes (28/09/2026 — otimizacao de
// custo/caching). Trocar o modelo de um agente mexe so aqui, nunca precisa caçar strings soltas
// pelo codigo. O Agente de Analise do Strava mantem 'claude-sonnet-5' hardcoded de proposito, fora
// desta constante — pedido explicito do treinador nesta mesma tarefa: "manter configuracao atual,
// sem alteracoes".
export const AI_MODELS = {
  SONNET_5: 'claude-sonnet-5',
  // 09/10/2026: Haiku 5.5 (lancado em 07/10/2026) substitui o Haiku 4.5 nos agentes auxiliares. ID fixo, sem sufixo de data nem alias.
  // Tokenizador novo: ~30% mais tokens para o mesmo texto (por isso os max_tokens dos agentes auxiliares foram elevados).
  HAIKU_5_5: 'claude-haiku-5-5',
} as const;

// ── Tarifas (USD por milhao de tokens) ────────────────────────────────────────────────────────────────────────────────
// Fonte: platform.claude.com/docs/en/about-claude/pricing, conferida em 09/10/2026. Atualizar AQUI se a Anthropic mudar a tabela.
// Gravacao de cache: 1,25x (TTL 5 min) e 2x (TTL 1 h) o preco de entrada; leitura: 0,1x. Haiku 5.5 tem tarifa maior quando o PROMPT TOTAL
// (entrada + leitura + gravacao de cache) passa de 100 mil tokens — cada chamada e' precificada pelo seu proprio tamanho.
export interface AiRates { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number }
export const AI_RATES_USD_PER_MTOK: Record<string, { standard: AiRates; longPrompt?: { aboveTokens: number; rates: AiRates } }> = {
  [AI_MODELS.SONNET_5]: { standard: { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 } },
  [AI_MODELS.HAIKU_5_5]: {
    standard: { input: 0.1, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 },
    longPrompt: { aboveTokens: 100_000, rates: { input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 } },
  },
};

// ── Politica de cache de prompt por agente ────────────────────────────────────────────────────────────────────────────
// '5m' = padrao da API (gravacao 1,25x; leitura 0,1x): compensa quando mais de ~22% das chamadas encontram o prefixo ainda vivo.
// '1h' = gravacao 2x: so compensa quando mais de ~53% das chamadas reaproveitam o prefixo dentro de uma hora. 'off' = sem cache_control.
// Mudar o TTL de um agente e' trocar UMA palavra aqui, depois de olhar o campo economia_cache_usd dos logs [custo-ia].
export type AiCacheTtl = '5m' | '1h' | 'off';
export const AI_CACHE_POLICY = {
  treinador_semana: '5m',        // ~66 mil caracteres estaveis (~20 mil tokens); chamadas em rajadas (domingo/segunda) — decidir 1h so' com a medicao
  treinador_dia_corrida: '5m',
  treinador_dia_forca: '5m',
  gerente_tecnico: '5m',         // varias iteracoes (ferramentas) da mesma conversa em segundos: o prefixo e' reaproveitado dentro da conversa
  prontuario_condensacao: '5m',  // mantido como estava; prefixo ~3 mil tokens a US$ 0,10/MTok: efeito em dolares desprezivel
  prontuario: '5m',              // Agente de Evolucao (relatorio de trajetoria): chamadas raras; idem
  relator: 'off',                // chamadas esporadicas (um relato por vez), prefixo pequeno: sem reaproveitamento esperado (era inerte no Haiku 4.5 por ficar abaixo de 4096 tokens)
} as const satisfies Record<string, AiCacheTtl>;
export type AiCacheAgent = keyof typeof AI_CACHE_POLICY;

// Fragmento para espalhar no bloco de system: `{ type: 'text', text, ...cacheControlFor('agente') }`.
export function cacheControlFor(agent: AiCacheAgent): { cache_control?: { type: 'ephemeral'; ttl?: '1h' } } {
  const ttl = AI_CACHE_POLICY[agent] as AiCacheTtl;
  if (ttl === 'off') return {};
  return { cache_control: ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' } };
}
export const cacheTtlLabel = (agent: AiCacheAgent): string => AI_CACHE_POLICY[agent];
