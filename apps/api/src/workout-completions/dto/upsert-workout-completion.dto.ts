import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Correcao definitiva do ciclo de vida da prescricao (25/09/2026) — "Fiz, mas mudei o treino"
// (status continua sendo 'adjusted', so o rotulo mudou). Ids curtos, nunca reordenados/removidos
// depois de existirem respostas reais gravadas com eles.
export const ADJUSTMENT_REASON_IDS = [
  'trained_with_someone_else',
  'short_on_time',
  'felt_great_did_more',
  'tired_reduced',
  'pain_or_discomfort',
  'felt_too_hard',
  'felt_too_easy_increased',
  'weather',
  'location_route_issue',
  'unexpected_event',
  'preferred_different_workout',
  'other',
] as const;

// Direcao + magnitude do desvio de horario (dormir/acordar) em relacao ao habitual (01/10/2026).
// Substitui a antiga escala 1-5 de "irregularidade" (sleepScheduleIrregularity), que perdia a
// direcao do desvio. Deliberadamente categorica, nunca forcada numa escala numerica artificial.
export const SLEEP_SHIFT_DIRECTIONS = [
  'much_earlier',
  'moderately_earlier',
  'slightly_earlier',
  'on_time',
  'slightly_later',
  'moderately_later',
  'much_later',
] as const;

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

  // 01/10/2026: redacao da pergunta mudou para "Nas ultimas 24 horas, qual foi o seu nivel geral
  // de estresse?" — mesma coluna/escala/direcao (5=mais estresse), so' a janela de referencia e o
  // texto exibido mudaram. Timestamp real preservado em StressCheckin.respondedAt, nao aqui.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  preStressLevel?: number;

  // 01/10/2026, NOVA — "Nas ultimas 24 horas, com que frequencia voce passou por momentos que
  // aumentaram claramente seu estresse?" 1=nenhuma vez, 5=quase continuamente.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  stressEventFrequency?: number;

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

  // 01/10/2026: substitui sleepScheduleIrregularity (perdia a direcao do desvio). "Em relacao ao
  // seu horario habitual, hoje voce foi dormir:".
  @IsOptional()
  @IsIn(SLEEP_SHIFT_DIRECTIONS)
  bedtimeShiftDirection?: (typeof SLEEP_SHIFT_DIRECTIONS)[number];

  // 01/10/2026, NOVA — mesma logica de direcao+magnitude, para o horario de acordar. Pertence a
  // noite de sono (NightlySleepLog), nao a sessao.
  @IsOptional()
  @IsIn(SLEEP_SHIFT_DIRECTIONS)
  wakeTimeShiftDirection?: (typeof SLEEP_SHIFT_DIRECTIONS)[number];

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
  // executionVsPrescribed: CONGELADA (01/10/2026) — so para clientes antigos/historico. Nunca mais
  // escrita por um cliente novo (ver isV3Client/executionBehavior em workout-completions.service.ts).
  // 1=fiz bem menos, 2=um pouco menos, 3=como prescrito, 4=um pouco mais, 5=fiz bem mais.
  @IsOptional()
  @IsInt() @Min(1) @Max(5)
  executionVsPrescribed?: number;

  // Feedback v3 (01/10/2026) — substitui executionVsPrescribed. Categorica/comportamental, NAO
  // ordinal: nenhuma das 5 categorias e "mais" ou "menos" que outra, nao ha media/baseline.
  @IsOptional()
  @IsIn(['as_planned', 'minor_adaptations', 'major_changes', 'different_workout', 'stopped_early'])
  executionBehavior?: string;

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

  // "Fiz, mas mudei o treino" (status='adjusted') — motivos de multipla escolha + observacao
  // opcional. So' fazem sentido quando status==='adjusted'; o service nao exige, so' persiste
  // quando vierem (nunca altera TrainingSession, so' descreve o completion).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ADJUSTMENT_REASON_IDS.length)
  @IsIn(ADJUSTMENT_REASON_IDS, { each: true })
  adjustmentReasons?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  adjustmentComment?: string;

  // So' preenchido quando adjustmentReasons incluir 'preferred_different_workout'.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  adjustmentPreferredActivity?: string;
}
