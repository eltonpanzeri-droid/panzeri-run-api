import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, ValidateNested } from 'class-validator';

export class AvailabilityDayDto {
  @IsInt()
  weekday!: number;

  @IsBoolean()
  noTraining!: boolean;

  @IsArray()
  modalities!: string[];

  @IsOptional()
  @IsInt()
  availableMin?: number | null;

  @IsOptional()
  @IsObject()
  modalityDurations?: Record<string, number>;
}

export class UpdateAvailabilityDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityDayDto)
  availability!: AvailabilityDayDto[];
}
