// Configuracao centralizada dos modelos de IA usados pelos agentes (28/09/2026 — otimizacao de
// custo/caching). Trocar o modelo de um agente mexe so aqui, nunca precisa caçar strings soltas
// pelo codigo. O Agente de Analise do Strava mantem 'claude-sonnet-5' hardcoded de proposito, fora
// desta constante — pedido explicito do treinador nesta mesma tarefa: "manter configuracao atual,
// sem alteracoes".
export const AI_MODELS = {
  SONNET_5: 'claude-sonnet-5',
  HAIKU_4_5: 'claude-haiku-4-5-20251001',
} as const;
