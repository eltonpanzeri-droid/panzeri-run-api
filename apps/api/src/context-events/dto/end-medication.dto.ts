import { IsDateString } from 'class-validator';

export class EndMedicationDto {
  @IsDateString()
  endDate!: string;
}
