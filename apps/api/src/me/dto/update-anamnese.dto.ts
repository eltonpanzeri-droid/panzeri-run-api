import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { UpdateAvailabilityDto } from './update-availability.dto';
import { UpdateHealthDto } from './update-health.dto';
import { UpdatePreferencesDto } from './update-preferences.dto';
import { UpdateProfileDto } from './update-profile.dto';

export class UpdateAnamneseDto {
  @ValidateNested()
  @Type(() => UpdateProfileDto)
  profile!: UpdateProfileDto;

  @ValidateNested()
  @Type(() => UpdateHealthDto)
  health!: UpdateHealthDto;

  @ValidateNested()
  @Type(() => UpdatePreferencesDto)
  preferences!: UpdatePreferencesDto;

  @ValidateNested()
  @Type(() => UpdateAvailabilityDto)
  availability!: UpdateAvailabilityDto;
}
