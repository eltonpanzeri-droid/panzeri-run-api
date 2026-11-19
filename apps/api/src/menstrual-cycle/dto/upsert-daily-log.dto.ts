import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CYCLE_NOTES_MAX_CHARS, CYCLE_SYMPTOM_IDS } from '../cycle-symptoms';

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

  // 19/11/2026: sintomas da lista fixa e relato livre do dia.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(CYCLE_SYMPTOM_IDS, { each: true })
  symptoms?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(CYCLE_NOTES_MAX_CHARS)
  notes?: string;
}
