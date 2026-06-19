import { BadRequestException } from '@nestjs/common';
import { AvailabilityDayDto } from './dto/update-availability.dto';

export function validateAvailability(days: AvailabilityDayDto[]) {
  const seen = new Set<number>();

  for (const day of days) {
    if (day.weekday < 0 || day.weekday > 6) {
      throw new BadRequestException('weekday deve estar entre 0 e 6.');
    }

    if (seen.has(day.weekday)) {
      throw new BadRequestException('Nao envie dias repetidos na disponibilidade.');
    }
    seen.add(day.weekday);

    if (day.noTraining && (day.modalities.length > 0 || (day.availableMin ?? 0) > 0)) {
      throw new BadRequestException('Quando noTraining=true, modalities deve ser vazio e availableMin deve ser 0 ou null.');
    }
  }
}
