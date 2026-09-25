import { IsDateString } from 'class-validator';

export class EndCycleDto {
  @IsDateString()
  date!: string;
}
