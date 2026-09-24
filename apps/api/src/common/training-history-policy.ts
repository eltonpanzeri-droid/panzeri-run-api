// TrainingHistoryPolicy — fonte UNICA da politica "a partir de quando o historico de treino conta
// como esportivo real" (fechamento do Passo 2, 25/09/2026).
//
// Origem: investigacao confirmou multiplas regeneracoes de teste entre 22/06 e 01/08/2026 (ate 17
// sessoes da mesma modalidade no mesmo dia — fisicamente impossivel ser treino real), resultado de
// `generateWeek()` ter sido chamado repetidamente durante o desenvolvimento/testes do proprio
// Panzeri Run. O corte de 01/08/2026 ja existia, mas isolado dentro de EvolutionMetricService —
// centralizado aqui pra qualquer consumidor de Training Intelligence usar a MESMA data, em vez de
// cada um definir a sua.
//
// IMPORTANTE (nao mude sem entender por que): isso NAO apaga nada do banco. Sessoes anteriores ao
// corte continuam la, disponiveis pra auditoria tecnica (ver diagnostico do Passo 2). O corte so'
// se aplica a quem CALCULA historico esportivo longitudinal (EvolutionMetricService,
// ObservationReaderService) — nao ao Admin, nem a historicoSemanal (que ja e' naturalmente
// recente, ultimas 4 semanas, e serve um proposito diferente: contexto operacional pro agente, nao
// analise longitudinal de Training Intelligence).

export const TRAINING_INTELLIGENCE_DATA_CUTOFF = new Date('2026-08-01T00:00:00Z');

/** true quando a data esta dentro do periodo considerado historico esportivo real (>= corte). */
export function isWithinValidTrainingHistory(date: Date): boolean {
  return date.getTime() >= TRAINING_INTELLIGENCE_DATA_CUTOFF.getTime();
}
