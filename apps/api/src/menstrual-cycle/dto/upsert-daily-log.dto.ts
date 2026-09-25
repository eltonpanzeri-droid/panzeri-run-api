import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

// Registro rapido do dia (secao 12 do pedido): cólica/energia/humor/fluxo, tudo opcional,
// upsert por data — a aluna pode preencher hoje, ou voltar e completar um dia anterior.
export class UpsertDailyLogDto {
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
