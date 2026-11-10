import { Transform } from 'class-transformer';
import { canonicalModality } from '../../activity-execution/canonical-modality';
import { IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateTrainingSessionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && canonicalModality(value.trim()) === 'corrida' ? 'corrida' : value))
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

  @IsOptional()
  @IsObject()
  structure?: Record<string, unknown>;
}
