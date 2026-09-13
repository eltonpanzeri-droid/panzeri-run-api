import { computeRunSlots, computeStrengthSlots, sanitizeInterviewAnswers, stripRoutineKeysFromAnswers, hasSafetyConcern, isNovice, parseMmSsToSeconds } from '../src/training-plans/training-methodology';

// The removed deterministic builder is not the current prescription engine.
describe('Panzeri methodology context', () => {
  it('uses modality-specific availability and keeps slots ordered', () => {
    const availability = [
      { weekday: 6, modalities: ['corrida', 'forca'], availableMin: 80, modalityDurations: { corrida: 60, forca: 20 } },
      { weekday: 2, modalities: ['esteira'], availableMin: 45 },
    ];
    expect(computeRunSlots(availability)).toEqual([{ weekday: 2, durationMin: 45 }, { weekday: 6, durationMin: 60 }]);
    expect(computeStrengthSlots(availability)).toEqual([{ weekday: 6, modality: 'forca', durationMin: 20 }]);
  });
  it('preserves legacy pain without mutating answers', () => {
    const answers = { pain_region: 'joelho', current_continuous_run: 'Até 5 minutos', current_pain: 'yes' };
    expect(sanitizeInterviewAnswers(answers)).toEqual({ current_pain: 'yes', pain_other_location: 'joelho' });
    expect(answers.pain_region).toBe('joelho');
    expect(sanitizeInterviewAnswers({ pain_region: 'joelho', pain_regions: ['joelho'] })).toEqual({ pain_regions: ['joelho'] });
  });
  it('removes routine answers but preserves health and goals', () => {
    const answers = { monday_run_time: 30, routine_modality_choice: 'corrida', current_pain: 'yes', goal: '10km' };
    expect(stripRoutineKeysFromAnswers(answers)).toEqual({ current_pain: 'yes', goal: '10km' });
    expect(answers.monday_run_time).toBe(30);
  });
  it('retains pain and injury safety flags', () => {
    expect(hasSafetyConcern({ current_pain: 'yes' })).toBe(true);
    expect(hasSafetyConcern({ important_injury: 'Com limitações' })).toBe(true);
    expect(hasSafetyConcern({ current_pain: 'no' })).toBe(false);
  });
  it('recognizes novice and experienced current runners', () => {
    expect(isNovice('Nunca corri regularmente', {})).toBe(true);
    expect(isNovice('Corro há dois anos', { running_experience: 'currently_gt_1y', longest_distance: 15, recent_running_feeling: 'tranquila' })).toBe(false);
  });
  it('accepts current and legacy duration formats', () => {
    expect(parseMmSsToSeconds('25:30')).toBe(1530);
    expect(parseMmSsToSeconds('1:25:30')).toBe(5130);
    expect(parseMmSsToSeconds('1:60:00')).toBeNull();
  });
});
