// Fontes de texto livre do aluno conectadas a Linha do Tempo de Relatos (28/09/2026). String pura
// de proposito (nao um enum do Prisma) — uma fonte nova so precisa de uma constante nova aqui,
// nunca de migration. Ver StudentReportEntry.sourceType no schema.
export const STUDENT_REPORT_SOURCE_TYPES = {
  WORKOUT_FEEDBACK_NOTES: 'workout_feedback_notes',
  WORKOUT_MISSED_COMMENT: 'workout_missed_comment',
  WORKOUT_ADJUSTMENT_COMMENT: 'workout_adjustment_comment',
  PAIN_REPORT: 'pain_report',
  WEEKLY_CHECKIN_FREE_TEXT: 'weekly_checkin_free_text',
  STUDENT_OBSERVATION: 'student_observation',
  CONTEXT_EVENT: 'context_event',
  ONBOARDING_INTERVIEW_HEALTH: 'onboarding_interview_health',
  ONBOARDING_INTERVIEW_ROUTINE_NOTE: 'onboarding_interview_routine_note',
  REASSESSMENT_HEALTH: 'reassessment_health',
  SUBSCRIPTION_CANCEL_FEEDBACK: 'subscription_cancel_feedback',
} as const;

export type StudentReportSourceType = (typeof STUDENT_REPORT_SOURCE_TYPES)[keyof typeof STUDENT_REPORT_SOURCE_TYPES];
