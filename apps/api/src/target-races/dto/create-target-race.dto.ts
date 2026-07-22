import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateTargetRaceDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsDateString()
  raceDate!: string;

  @IsNumber()
  @Min(0.1)
  @Max(999)
  distanceKm!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(172800)
  targetSeconds?: number;

  @IsOptional()
  @IsIn(['principal', 'secundaria'])
  priority?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
