import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreatePainReportDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  regions!: string[];

  @IsOptional()
  regionDetails?: Record<string, string[]>;

  @IsOptional()
  @IsString()
  otherLocation?: string;

  @IsInt()
  @Min(1)
  @Max(10)
  intensity!: number;

  @IsIn(['starts_then_stops', 'starts_mid', 'after_only', 'all_the_time'])
  onsetPattern!: string;

  @IsIn(['permanent', 'oscillating', 'specific_movements'])
  persistencePattern!: string;

  @IsOptional()
  @IsIn(['none_before', 'resolved', 'improved', 'unchanged'])
  previousPainStatus?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resolvedRegions?: string[];

  @IsOptional()
  @IsString()
  comment?: string;
}
