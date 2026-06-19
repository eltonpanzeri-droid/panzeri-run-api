import { BadRequestException } from '@nestjs/common';
import { validateAvailability } from '../src/me/availability.rules';

describe('validateAvailability', () => {
  it('rejects modalities when noTraining is true', () => {
    expect(() =>
      validateAvailability([
        {
          weekday: 1,
          noTraining: true,
          modalities: ['corrida_rua'],
          availableMin: 45,
        },
      ]),
    ).toThrow(BadRequestException);
  });

  it('accepts rest day with empty modalities and zero minutes', () => {
    expect(() =>
      validateAvailability([
        {
          weekday: 1,
          noTraining: true,
          modalities: [],
          availableMin: 0,
        },
      ]),
    ).not.toThrow();
  });
});
