import { gymExerciseLibrary, isApprovedGymExercise, selectGymExercises } from '../src/training-plans/gym-exercise-library';
import { runnerStrengthExercises, selectRunnerStrengthExercises } from '../src/training-plans/runner-strength-library';

describe('exercise libraries', () => {
  it('mantem nomes unicos na biblioteca fechada de musculacao', () => {
    expect(new Set(gymExerciseLibrary.map((exercise) => exercise.name)).size).toBe(gymExerciseLibrary.length);
    expect(gymExerciseLibrary.length).toBeGreaterThanOrEqual(60);
    expect(gymExerciseLibrary.every((exercise) => exercise.videoUrl === null)).toBe(true);
  });

  it('seleciona somente exercicios aprovados para musculacao', () => {
    const selected = selectGymExercises({ durationMin: 60, experience: 'Treino ha mais de 3 anos.', rotation: 2 });
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((exercise) => isApprovedGymExercise(exercise.name))).toBe(true);
  });

  it('mantem videos em todos os exercicios de fortalecimento para corredores', () => {
    expect(runnerStrengthExercises.every((exercise) => exercise.videoUrl.startsWith('https://youtu.be/'))).toBe(true);
    expect(selectRunnerStrengthExercises(60).every((exercise) => exercise.videoUrl)).toBe(true);
  });
});