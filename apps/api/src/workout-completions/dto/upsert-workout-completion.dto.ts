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

  // 4 dimensoes historicas (19/08) — satisfactionElaboracao e satisfactionCapacidade
  // continuam sendo coletadas na v1; satisfaction e satisfactionCarga deixaram de ser
  // coletadas na v1 mas sao preservadas para historico e ainda aceitas pelo endpoint.
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

  // painFlag v1: adiciona 'moderado' entre 'leve' e 'forte'.
  @IsOptional()
  @IsIn(['none', 'leve', 'moderado', 'forte'])
  painFlag?: string;

  // Feedback v1 (11/09/2026) — bloco 1: estado pre-treino. Escala 1-5.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  preSleepQuality?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  prePhysicalFatigue?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  preStressLevel?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  preMotivation?: number;

  // Feedback v1 — bloco 2: sensacao ao terminar. Escala 1-5 (1=muito mal, 5=muito bem).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  postWorkoutFeeling?: number;

  // Feedback v1 — bloco 3: timing da dor (condicional, so enviado quando painFlag != 'none').
  @IsOptional()
  @IsIn(['ja_comecei_sentindo', 'comeco_passou', 'comeco_continuou', 'durante_passou', 'durante_continuou', 'so_depois'])
  painTiming?: string;

  // Feedback v2 (24/09/2026) — bloco SONO. sleepDurationCategory e' categorica (nao escala de
  // intensidade); as demais sao escala 1-5 onde 5 = maior intensidade da variavel perguntada.
  @IsOptional()
  @IsIn(['menos_5h', '5_a_6h', '6_a_7h', '7_a_8h', '8_a_9h', 'mais_9h'])
  sleepDurationCategory?: string;

  @IsOptional()
  @IsInt() @Min(1) @Max(5)
  sleepScheduleIrregularity?: number;

  @IsOptional()
  @IsInt() @Min(1) @Max(5)
  sleepInterruption?: number;

  @IsOptional()
  @IsInt() @Min(1) @Max(5)
  sleepDifficulty?: number;

  // Feedback v2 — bloco ESTADO ANTES DO TREINO (cansaco mental pre, nova).
  @IsOptional()
  @IsInt() @Min(1) @Max(5)
  preMentalFatigue?: number;

  // Feedback v2 — bloco RESPOSTA AO TREINO.
  // executionVsPrescribed: 1=fiz bem menos, 2=um pouco menos, 3=como prescrito, 4=um pouco mais,
  // 5=fiz bem mais. 3 e' o ponto de referencia, NAO "neutro" — nao interpretar 5 como "melhor".
  @IsOptional()
  @IsInt() @Min(1) @Max(5)
  executionVsPrescribed?: number;

  @IsOptional()
  @IsInt() @Min(1) @Max(5)
  postPhysicalFatigue?: number;

  @IsOptional()
  @IsInt() @Min(1) @Max(5)
  postMentalFatigue?: number;

  @IsOptional()
  @IsInt() @Min(1) @Max(5)
  emotionalExperienceDuring?: number;

  @IsOptional()
  @IsInt() @Min(1) @Max(5)
  mentalStateChangePrePost?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}
