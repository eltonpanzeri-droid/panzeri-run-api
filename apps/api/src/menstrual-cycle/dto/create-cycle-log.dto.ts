import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateCycleLogDto {
  // Formato ISO: '2026-09-11' — o app envia a data local da aluna
  @IsDateString()
  cycleStartDate!: string;

  // Sintomas opcionais (escala 1-5)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  crampsLevel?: number;  // 1=sem cólicas, 5=muito intensa

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  energyLevel?: number;  // 1=muito baixa, 5=alta

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  moodLevel?: number;    // 1=muito instável, 5=muito estável
}
