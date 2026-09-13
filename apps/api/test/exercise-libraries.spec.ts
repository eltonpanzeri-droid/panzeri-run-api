import { gymExerciseLibrary } from '../src/training-plans/gym-exercise-library';
import { runnerStrengthExercises } from '../src/training-plans/runner-strength-library';

describe('exercise libraries', () => {
  it('mantem nomes unicos na biblioteca fechada de musculacao', () => {
    expect(new Set(gymExerciseLibrary.map((exercise) => exercise.name)).size).toBe(gymExerciseLibrary.length);
    expect(gymExerciseLibrary.length).toBeGreaterThanOrEqual(60);
    expect(gymExerciseLibrary.every((exercise) => exercise.videoUrl === null)).toBe(true);
  });

  it('mantem identificadores unicos e descricoes no catalogo usado pela IA', () => {
    expect(new Set(gymExerciseLibrary.map((exercise) => exercise.id)).size).toBe(gymExerciseLibrary.length);
    expect(gymExerciseLibrary.every((exercise) => exercise.id && exercise.description && exercise.group)).toBe(true);
  });

  it('mantem videos em todos os exercicios de fortalecimento para corredores', () => {
    expect(runnerStrengthExercises.every((exercise) => exercise.videoUrl.startsWith('https://youtu.be/'))).toBe(true);
    expect(new Set(runnerStrengthExercises.map((exercise) => exercise.id)).size).toBe(runnerStrengthExercises.length);
  });
});
