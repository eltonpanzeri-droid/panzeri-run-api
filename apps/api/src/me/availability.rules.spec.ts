import { BadRequestException } from '@nestjs/common';
import { validateAvailability } from './availability.rules';

describe('validateAvailability', () => {
  it('aceita dias de treino e descanso validos', () => {
    expect(() => validateAvailability([
      { weekday: 1, noTraining: false, modalities: ['corrida'], availableMin: 45 },
      { weekday: 2, noTraining: true, modalities: [], availableMin: 0 },
    ])).not.toThrow();
  });

  it('rejeita modalidade em um dia marcado sem treino', () => {
    expect(() => validateAvailability([
      { weekday: 1, noTraining: true, modalities: ['corrida'], availableMin: 0 },
    ])).toThrow(BadRequestException);
  });

  it('rejeita dias repetidos', () => {
    expect(() => validateAvailability([
      { weekday: 1, noTraining: false, modalities: ['corrida'], availableMin: 30 },
      { weekday: 1, noTraining: false, modalities: ['forca'], availableMin: 45 },
    ])).toThrow(BadRequestException);
  });
});
