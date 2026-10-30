import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { ASSESSMENT_METHODS } from '../physiology-input';

// Os limites numéricos e as relações entre campos (L1 < L2 < VO₂máx) são validados em normalizeExternalResults, com mensagens em português.
export class ExternalResultsDto {
  @IsOptional() @IsNumber() vo2max?: number;
  @IsOptional() @IsNumber() vvo2max_kmh?: number;
  @IsOptional() @IsNumber() vvo2max_pace_seconds?: number;
  @IsOptional() @IsNumber() hrmax_bpm?: number;
  @IsOptional() @IsNumber() l1_speed_kmh?: number;
  @IsOptional() @IsNumber() l1_pace_seconds?: number;
  @IsOptional() @IsNumber() l1_hr_bpm?: number;
  @IsOptional() @IsNumber() l1_vo2?: number;
  @IsOptional() @IsNumber() l1_vo2_pct?: number;
  @IsOptional() @IsNumber() l2_speed_kmh?: number;
  @IsOptional() @IsNumber() l2_pace_seconds?: number;
  @IsOptional() @IsNumber() l2_hr_bpm?: number;
  @IsOptional() @IsNumber() l2_vo2?: number;
  @IsOptional() @IsNumber() l2_vo2_pct?: number;
  @IsOptional() @IsNumber() totalSeconds?: number;
  @IsOptional() @IsNumber() distanceMeters?: number;
}

export class CreateExternalAssessmentDto {
  @IsIn([...ASSESSMENT_METHODS]) method!: string;
  @IsOptional() @IsString() @MaxLength(80) methodLabel?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'performedAt deve estar no formato AAAA-MM-DD.' }) performedAt!: string;
  @IsObject() @ValidateNested() @Type(() => ExternalResultsDto) results!: ExternalResultsDto;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
