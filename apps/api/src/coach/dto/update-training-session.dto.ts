import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateTrainingSessionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  modality?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  durationMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  distanceKm?: number;

  @IsOptional()
  @IsString()
  intensityZone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
