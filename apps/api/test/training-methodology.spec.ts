import { buildWeeklyMethodologyDecision } from '../src/training-plans/training-methodology';

const availability = [
  { weekday: 2, modalities: ['corrida'], availableMin: 45 },
  { weekday: 4, modalities: ['corrida'], availableMin: 50 },
  { weekday: 6, modalities: ['corrida'], availableMin: 80 },
];

describe('Panzeri training methodology', () => {
  it('prioriza longo com corrida e caminhada para iniciante', () => {
    const decision = buildWeeklyMethodologyDecision({
      goal: 'Completar 5 km', experience: 'Nunca corri regularmente.', answers: { ran_5k_recently: 'no', fitness_self_rating: 'muito_leve' },
      availability, history: [], stravaRunMinutes: 0, stravaLongestRunMinutes: 0,
    });
    expect(decision.sessions.find((session) => session.weekday === 6)?.sessionType).toBe('walk_run');
    expect(decision.sessions.some((session) => session.sessionType === 'quality_run')).toBe(false);
  });

  it('inclui longo e apenas um treino de qualidade para corredor experiente', () => {
    const decision = buildWeeklyMethodologyDecision({
      goal: 'Melhorar meu tempo nos 10 km', experience: 'Corro regularmente ha mais de 2 anos.', answers: { ran_5k_recently: 'yes', longest_distance_recent: 15, recent_running_feeling: 'tranquila' },
      availability, history: [{ runMinutes: 150, completedRunMinutes: 140, longestRunMinutes: 70, prescribedSessions: 3, completedSessions: 3 }],
      stravaRunMinutes: 140, stravaLongestRunMinutes: 70,
    });
    expect(decision.sessions.filter((session) => session.sessionType === 'quality_run')).toHaveLength(1);
    expect(decision.sessions.filter((session) => session.sessionType === 'long_run')).toHaveLength(1);
  });

  it('nao aumenta novamente um longo grande apos aumento recente', () => {
    const decision = buildWeeklyMethodologyDecision({
      goal: 'Completar 21 km', experience: 'Corro regularmente ha mais de 2 anos.', answers: { ran_5k_recently: 'yes', longest_distance_recent: 15, recent_running_feeling: 'tranquila' },
      availability, history: [
        { runMinutes: 170, completedRunMinutes: 170, longestRunMinutes: 75, prescribedSessions: 3, completedSessions: 3 },
        { runMinutes: 155, completedRunMinutes: 155, longestRunMinutes: 65, prescribedSessions: 3, completedSessions: 3 },
      ], stravaRunMinutes: 170, stravaLongestRunMinutes: 75,
    });
    expect(decision.sessions.find((session) => session.sessionType === 'long_run')?.durationMin).toBeLessThanOrEqual(75);
  });

  it('reduz cautela mas nao bloqueia treino intervalado so por um relato antigo de dor na entrevista', () => {
    // Uma dor relatada na entrevista de onboarding (resposta unica, nunca expira sozinha) deve
    // reduzir volume/intensidade como precaucao, mas dor por si so nao deveria bloquear
    // intervalado para sempre — isso so acontece com um relato ESTRUTURADO e recente de dor
    // intensa (painTier explicito 'remove_running'), calculado pelo PainReportsService.
    const decision = buildWeeklyMethodologyDecision({
      goal: 'Melhorar meu tempo nos 5 km', experience: 'Corro regularmente ha mais de 2 anos.', answers: { current_pain: 'yes' },
      availability, history: [], stravaRunMinutes: 0, stravaLongestRunMinutes: 0,
    });
    expect(decision.safetyAdjustment).toBe(true);
    expect(decision.sessions.some((session) => session.sessionType === 'quality_run')).toBe(true);
  });

  it('remove treino intervalado quando o tier calculado e remove_running (dor intensa recente)', () => {
    const decision = buildWeeklyMethodologyDecision({
      goal: 'Melhorar meu tempo nos 5 km', experience: 'Corro regularmente ha mais de 2 anos.', answers: {},
      availability, history: [], stravaRunMinutes: 0, stravaLongestRunMinutes: 0,
      painTier: 'remove_running',
    });
    expect(decision.safetyAdjustment).toBe(true);
    expect(decision.sessions.some((session) => session.sessionType === 'quality_run')).toBe(false);
  });
});