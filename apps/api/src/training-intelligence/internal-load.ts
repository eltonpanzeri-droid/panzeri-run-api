// Carga interna percebida da sessão (01/11/2026). Constantes COMPARTILHADAS (folha, sem dependências) entre o registro de indicadores, o leitor de observações, o painel e o contexto da IA.
//
// Três variáveis DISTINTAS e preservadas (a carga NUNCA substitui a PSE isolada):
//   1. workout.perceivedEffort           — PSE da sessão (1 a 10), já existente.
//   2. workout.sessionDurationUsedMin    — duração efetiva usada no cálculo, em minutos.
//   3. workout.sessionInternalLoad       — carga interna percebida = PSE × minutos, em UA (unidade arbitrária).
// Duas sessões podem ter a mesma carga com combinações muito diferentes de PSE e duração: por isso as três ficam disponíveis separadas.
export const INTERNAL_LOAD_VARIABLE_ID = 'workout.sessionInternalLoad';
export const SESSION_DURATION_VARIABLE_ID = 'workout.sessionDurationUsedMin';
export const SESSION_PSE_VARIABLE_ID = 'workout.perceivedEffort';
export const INTERNAL_LOAD_VARIABLE_IDS = [INTERNAL_LOAD_VARIABLE_ID, SESSION_DURATION_VARIABLE_ID] as const;
