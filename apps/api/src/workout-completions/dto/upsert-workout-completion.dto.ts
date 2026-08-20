import { IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertWorkoutCompletionDto {
  @IsString()
  sessionId!: string;

  @IsIn(['done', 'missed', 'adjusted'])
  status!: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(600)
  durationMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  distanceKm?: number;

  @IsOptional()
  @IsInt()
  @Min(120)
  @Max(3600)
  avgPaceSecondsKm?: number;

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(240)
  avgHeartRate?: number;

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(240)
  maxHeartRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  perceivedEffort?: number;

  // 4 dimensoes de satisfacao (19/08) — pergunta vaga = aluno perdido, cada uma pergunta uma
  // coisa especifica e diferente das outras (ver comentario no schema.prisma).
  @IsOptional()
  @IsIn(['amei', 'gostei', 'neutro', 'nao_gostei', 'detestei'])
  satisfactionElaboracao?: string;

  @IsOptional()
  @IsIn(['amei', 'gostei', 'neutro', 'nao_gostei', 'detestei'])
  satisfaction?: string;

  @IsOptional()
  @IsIn(['amei', 'gostei', 'neutro', 'nao_gostei', 'detestei'])
  satisfactionCapacidade?: string;

  @IsOptional()
  @IsIn(['muito_leve', 'leve', 'na_medida', 'pesada', 'muito_pesada'])
  satisfactionCarga?: string;

  @IsOptional()
  @IsIn(['none', 'leve', 'forte'])
  painFlag?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}
