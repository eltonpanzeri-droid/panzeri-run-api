import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateTargetRaceDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsDateString()
  raceDate!: string;

  @IsNumber()
  @Min(0.1)
  @Max(999)
  distanceKm!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(172800)
  targetSeconds?: number;

  @IsOptional()
  @IsIn(['principal', 'secundaria'])
  priority?: string;

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
