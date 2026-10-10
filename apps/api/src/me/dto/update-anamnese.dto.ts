import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
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

  // (10/2026) Opcional: a rotina e' salva por PUT /me/availability. Sem este campo o salvamento de perfil/saude/preferencias NAO toca a rotina atual.
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAvailabilityDto)
  availability?: UpdateAvailabilityDto;
}
