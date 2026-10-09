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
