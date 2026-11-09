import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateTargetRaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsDateString()
  raceDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(999)
  distanceKm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(864000)
  targetSeconds?: number;

  @IsOptional()
  @IsIn(['principal', 'secundaria'])
  priority?: string;

  // Local e horario (09/11/2026): null limpa o valor.
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/, { message: 'state deve ter 2 letras (UF)' })
  state?: string | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime deve ser HH:MM (00:00 a 23:59)' })
  startTime?: string | null;

  @IsOptional()
  @IsIn(['em_andamento', 'concluida', 'arquivada'])
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Questionario de contexto sobre a meta (10/08) — escala de 1 a 10, tudo opcional. Ver
  // comentario no schema.prisma (TargetRace) e a regra de uso em prescription-agent.service.ts.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  performanceIntent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  socialIntent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  personalImportance?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  perceivedDifficulty?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  dedicationWillingness?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  achievementSatisfaction?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  confidenceLevel?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  injuryConcern?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  adjustmentOpenness?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  anxietyLevel?: number;

  @IsOptional()
  @IsBoolean()
  isFirstTimeAtDistance?: boolean;
}
