// Formato de UMA sessao no historico do aluno mostrado no painel (prescrito + resposta da aluna). Extraido de CoachService.student() sem mudar nenhum campo, para o
// historico (aba Evolucao) e o calendario (aba Semanas anteriores) mostrarem exatamente os mesmos dados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapHistorySession(session: any) {
  return {
    id: session.id,
    date: session.scheduledDate,
    weekday: session.weekday,
    title: session.title,
    modality: session.modality,
    durationMin: session.durationMin,
    distanceKm: session.distanceKm,
    zone: session.intensityZone,
    structure: session.structure,
    notes: [session.notes, session.recommendations].filter(Boolean).join(' '),
    routineMismatchNote: session.routineMismatchNote,
    completionStatus: session.completion?.status ?? 'sem_registro',
    completedAt: session.completion?.completedAt ?? null,
    completedDurationMin: session.completion?.durationMin ?? null,
    completedDistanceKm: session.completion?.distanceKm ?? null,
    completedPaceSecondsKm: session.completion?.avgPaceSecondsKm ?? null,
    perceivedEffort: session.completion?.perceivedEffort ?? null,
    satisfactionElaboracao: session.completion?.satisfactionElaboracao ?? null,
    satisfaction: session.completion?.satisfaction ?? null,
    satisfactionCapacidade: session.completion?.satisfactionCapacidade ?? null,
    satisfactionCarga: session.completion?.satisfactionCarga ?? null,
    feedback: session.completion?.notes ?? null,
    // Feedback v1 — bloco 1: estado pre-treino
    preSleepQuality: session.completion?.preSleepQuality ?? null,
    prePhysicalFatigue: session.completion?.prePhysicalFatigue ?? null,
    preStressLevel: session.completion?.preStressLevel ?? null,
    preMotivation: session.completion?.preMotivation ?? null,
    // Feedback v1 — bloco 2: experiencia
    postWorkoutFeeling: session.completion?.postWorkoutFeeling ?? null,
    // postWorkoutMood fica em details (campo sem migration propria — 12/09/2026)
    postWorkoutMood: session.completion?.details != null && typeof session.completion.details === 'object'
      ? (Number((session.completion.details as Record<string, unknown>).postWorkoutMood) || null)
      : null,
    // Feedback v2 (24/09/2026)
    sleepDurationCategory: session.completion?.sleepDurationCategory ?? null,
    sleepScheduleIrregularity: session.completion?.sleepScheduleIrregularity ?? null,
    sleepInterruption: session.completion?.sleepInterruption ?? null,
    sleepDifficulty: session.completion?.sleepDifficulty ?? null,
    preMentalFatigue: session.completion?.preMentalFatigue ?? null,
    executionVsPrescribed: session.completion?.executionVsPrescribed ?? null,
    postPhysicalFatigue: session.completion?.postPhysicalFatigue ?? null,
    postMentalFatigue: session.completion?.postMentalFatigue ?? null,
    emotionalExperienceDuring: session.completion?.emotionalExperienceDuring ?? null,
    mentalStateChangePrePost: session.completion?.mentalStateChangePrePost ?? null,
    // walkingReasons: motivos de caminhada/parada, multi-select (14/09/2026)
    walkingReasons: session.completion?.details != null && typeof session.completion.details === 'object'
      ? (Array.isArray((session.completion.details as Record<string, unknown>).walkingReasons)
        ? (session.completion.details as Record<string, unknown>).walkingReasons as string[]
        : null)
      : null,
    // Feedback v1 — bloco 3: dor
    painFlag: session.completion?.painFlag ?? null,
    painTiming: session.completion?.painTiming ?? null,
    feedbackVersion: session.completion?.feedbackVersion ?? null,
  };
}
