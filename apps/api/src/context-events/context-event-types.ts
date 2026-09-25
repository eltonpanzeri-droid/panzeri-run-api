// Passo 4 (25/09/2026) — constantes centrais do ContextEvent. Nao espalhar esses valores pelo
// codigo (mobile e backend importam/replicam exatamente esta lista).

// Limiar operacional inicial pra disparar o questionario de retorno-apos-lacuna. NAO e' uma
// verdade fisiologica ("14 dias sem treinar = perda de condicionamento") — e' so' o ponto em que
// vale a pena perguntar ao aluno o que aconteceu antes de continuar gerando treinos como se nada
// tivesse mudado. Ajustavel livremente sem migration (nao persistido em lugar nenhum).
export const GAP_RETURN_THRESHOLD_DAYS = 14;

export const CONTEXT_EVENT_TYPES = [
  'work', 'routine_change', 'travel', 'family_personal', 'health', 'illness', 'pain_injury', 'sleep', 'other',
] as const;
export type ContextEventType = (typeof CONTEXT_EVENT_TYPES)[number];

export const CONTEXT_EVENT_SOURCES = [
  'student_reported', 'coach_reported', 'reassessment', 'return_after_gap', 'system_detected',
] as const;
export type ContextEventSource = (typeof CONTEXT_EVENT_SOURCES)[number];

export const CONTEXT_EVENT_STATUSES = ['ongoing', 'ended'] as const;
export type ContextEventStatus = (typeof CONTEXT_EVENT_STATUSES)[number];

// Pergunta 1 do questionario de retorno — "Durante esse periodo, voce treinou?"
export const TRAINING_DURING_GAP_OPTIONS = [
  'none', 'very_little', 'some_outside', 'normal_outside',
] as const;
export type TrainingDuringGapOption = (typeof TRAINING_DURING_GAP_OPTIONS)[number];

// Pergunta 2 do questionario de retorno — motivo principal. Cada id mapeia pra um type de
// ContextEvent (ver REASON_TO_CONTEXT_TYPE); 'trained_but_not_registered' nao produz gap real de
// "aconteceu algo na vida", mas ainda assim conta a historia de que o treino existiu fora do
// registro — mapeado pra type 'other' com subtype proprio.
export const RETURN_REASON_OPTIONS = [
  'travel', 'routine_or_work_change', 'health_illness', 'pain_injury',
  'family_personal', 'demotivation', 'trained_but_not_registered', 'other',
] as const;
export type ReturnReasonOption = (typeof RETURN_REASON_OPTIONS)[number];

export const REASON_TO_CONTEXT_TYPE: Record<ReturnReasonOption, ContextEventType> = {
  travel: 'travel',
  routine_or_work_change: 'routine_change',
  health_illness: 'illness',
  pain_injury: 'pain_injury',
  family_personal: 'family_personal',
  demotivation: 'other',
  trained_but_not_registered: 'other',
  other: 'other',
};
