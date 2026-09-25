import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class StartCycleDto {
  // Formato ISO: '2026-09-11' — o app envia a data local da aluna, escolhida no calendario
  // (nunca mais digitada em texto livre — ver evolucao do acompanhamento menstrual, 25/09/2026)
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  crampsLevel?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  energyLevel?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  moodLevel?: number;

  @IsOptional()
  @IsIn(['leve', 'moderado', 'intenso'])
  flowIntensity?: string;
}
