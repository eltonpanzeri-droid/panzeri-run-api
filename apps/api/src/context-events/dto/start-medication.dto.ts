import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class StartMedicationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
