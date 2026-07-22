import { IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertWorkoutCompletionDto {
  @IsString()
  sessionId!: string;

  @IsIn(['done', 'missed', 'adjusted'])
  status!: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  durationMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  distanceKm?: number;

  @IsOptional()
  @IsInt()
  @Min(120)
  @Max(3600)
  avgPaceSecondsKm?: number;

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(240)
  avgHeartRate?: number;

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(240)
  maxHeartRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  perceivedEffort?: number;

  @IsOptional()
  @IsIn(['amei', 'gostei', 'neutro', 'nao_gostei', 'detestei'])
  satisfaction?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}
