// VariableRegistry — fonte canonica da semantica das variaveis longitudinais do Panzeri Run.
//
// Por que isso existe (ver DIRETRIZ_MESTRA_TRAINING_INTELLIGENCE.md e
// CAMADA_MATEMATICA_LONGITUDINAL.md, secao 42): sem um registro central, cada consumidor (Admin,
// agente de IA, um endpoint novo) reinterpreta o significado de um campo do banco por conta propria
// — e e' exatamente assim que nascem duas formulas calculando a mesma coisa, ou uma calculando algo
// diferente do que o nome sugere. Este arquivo e' a UNICA fonte de verdade sobre: o que uma
// variavel significa, em que escala/direcao, de onde ela vem, e se duas versoes de instrumento que
// usam a mesma coluna do banco podem ser comparadas na mesma serie ou nao.
//
// Regra canonica das escalas 1-5 (ver GLOSSARIO_METRICAS.md): 5 = MAIOR intensidade/quantidade da
// variavel perguntada (o "constructLabel" abaixo), nunca "5 = sempre bom". RPE e' 1-10, nao 1-5.
//
// Nao e' um ORM nem um sistema de configuracao generico — e' deliberadamente simples: o suficiente
// pra impedir que uma formula generica (media, tendencia) seja aplicada numa variavel categorica,
// ou que duas versoes de instrumento com semantica diferente sejam misturadas silenciosamente numa
// mesma serie sem ninguem perceber.

export type VariableDomain =
  | 'sleep'
  | 'physical_state'
  | 'psychological_state'
  | 'training_response'
  | 'pain_health'
  | 'menstrual_cycle';

export type VariableDataType = 'ordinal_scale' | 'categorical' | 'numeric_continuous';

/**
 * Direcao semantica. Deliberadamente NAO existe 'higher_is_better' — ver regra canonica no topo
 * do arquivo. constructLabel (no VariableDefinition) diz o que especificamente aumenta com o valor.
 */
export type SemanticDirection = 'higher_is_more_of_construct' | 'not_directional';

export type VariableSource = 'student_feedback_per_workout' | 'student_weekly_checkin' | 'student_menstrual_daily_log';

export type MathStrategy = 'ordinal_or_continuous_stats' | 'categorical_frequency';

/**
 * Onde e como um dado instrumento (versao de questionario) coleta esta variavel.
 * `field` quando e' uma coluna do Prisma; `storageLocation: 'details_json'` + `detailsKey` quando
 * o valor vive dentro do campo JSON `details` (caso de dados antigos gravados antes de existir
 * coluna propria — ex: postWorkoutMood do feedbackVersion 1).
 */
export interface InstrumentVersionSpec {
  version: number;
  field?: string;
  storageLocation?: 'column' | 'details_json';
  detailsKey?: string;
}

export interface VariableDefinition {
  variableId: string;
  domain: VariableDomain;
  dataType: VariableDataType;
  /** Rotulo do que "mais" significa nesta variavel (obrigatorio quando direction = higher_is_more_of_construct). */
  constructLabel?: string;
  scale?: { min: number; max: number; unit?: string };
  direction: SemanticDirection;
  source: VariableSource;
  expectedFrequency: 'per_workout' | 'per_week' | 'per_day';
  /** Estrategias matematicas permitidas — o MathLayer recusa aplicar uma estrategia fora desta lista. */
  allowedMathStrategy: MathStrategy;
  /**
   * Missing nunca e' zero (ver CAMADA_MATEMATICA_LONGITUDINAL.md). Nesta rodada so existe uma
   * politica real (nunca imputar); o campo existe para permitir politicas futuras sem redesenhar
   * a interface (ex: variaveis onde 0 e' um valor valido vs ausencia).
   */
  missingPolicy: 'never_impute';
  /** Uma entrada por versao de instrumento (feedbackVersion / checkinVersion) que coleta esta variavel. */
  versions: InstrumentVersionSpec[];
  /**
   * Se false, uma serie que misture observacoes de versoes diferentes carrega um aviso explicito
   * no `evidence` da resposta do endpoint (nunca mistura silenciosa — ver auditoria, secao B).
   */
  versionComparability: 'comparable_across_versions' | 'not_comparable_across_versions';
  /**
   * Quando true, sessoes extras (criadas pelo proprio aluno, structure.source==='student' &&
   * structure.type==='extra') sao excluidas da serie desta variavel — reservado para variaveis cujo
   * significado depende de haver uma prescricao de referencia (ex: executionVsPrescribed: nao ha
   * "prescrito" numa sessao extra). Reaproveita a MESMA deteccao de sessao extra ja usada em
   * evolution-metric.service.ts, nao cria uma segunda interpretacao do conceito.
   */
  excludeExtraSessions: boolean;
  notes?: string;
}

export const VARIABLE_REGISTRY: Record<string, VariableDefinition> = {
  // ---------------------------------------------------------------------------------------------
  // Feedback por treino (WorkoutCompletion) — bloco Sono
  // ---------------------------------------------------------------------------------------------
  'workout.preSleepQuality': {
    variableId: 'workout.preSleepQuality',
    domain: 'sleep',
    dataType: 'ordinal_scale',
    constructLabel: 'qualidade do sono',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 1, field: 'preSleepQuality', storageLocation: 'column' },
      { version: 2, field: 'preSleepQuality', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'Pergunta 1 (v2) / bloco 1 (v1) — mesma coluna, mesma semantica, sem mudanca.',
  },
  'workout.sleepDurationHoursEstimate': {
    variableId: 'workout.sleepDurationHoursEstimate',
    domain: 'sleep',
    dataType: 'numeric_continuous',
    constructLabel: 'horas de sono estimadas',
    scale: { min: 0, max: 12, unit: 'horas' },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 2, field: 'sleepDurationHoursEstimate', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'Transcricao numerica direta da categoria escolhida (ponto medio da faixa), sem formula nova ' +
      '— ver sleepDurationHoursEstimate() em workout-completions.service.ts. So existe a partir da v2.',
  },
  'workout.sleepScheduleIrregularity': {
    variableId: 'workout.sleepScheduleIrregularity',
    domain: 'sleep',
    dataType: 'ordinal_scale',
    constructLabel: 'irregularidade do horario de dormir',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 2, field: 'sleepScheduleIrregularity', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
  },
  'workout.sleepInterruption': {
    variableId: 'workout.sleepInterruption',
    domain: 'sleep',
    dataType: 'ordinal_scale',
    constructLabel: 'interrupcao do sono durante a noite',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 2, field: 'sleepInterruption', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
  },
  'workout.sleepDifficulty': {
    variableId: 'workout.sleepDifficulty',
    domain: 'sleep',
    dataType: 'ordinal_scale',
    constructLabel: 'dificuldade para pegar no sono',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 2, field: 'sleepDifficulty', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
  },

  // ---------------------------------------------------------------------------------------------
  // Feedback por treino — bloco Estado antes do treino
  // ---------------------------------------------------------------------------------------------
  'workout.prePhysicalFatigue': {
    variableId: 'workout.prePhysicalFatigue',
    domain: 'physical_state',
    dataType: 'ordinal_scale',
    constructLabel: 'cansaco fisico antes do treino',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 1, field: 'prePhysicalFatigue', storageLocation: 'column' },
      { version: 2, field: 'prePhysicalFatigue', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
  },
  'workout.preMentalFatigue': {
    variableId: 'workout.preMentalFatigue',
    domain: 'psychological_state',
    dataType: 'ordinal_scale',
    constructLabel: 'cansaco mental antes do treino',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 2, field: 'preMentalFatigue', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'Pergunta nova a partir da v2 — sem equivalente na v1.',
  },
  'workout.preStressLevel': {
    variableId: 'workout.preStressLevel',
    domain: 'psychological_state',
    dataType: 'ordinal_scale',
    constructLabel: 'nivel de estresse',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 1, field: 'preStressLevel', storageLocation: 'column' },
      { version: 2, field: 'preStressLevel', storageLocation: 'column' },
    ],
    versionComparability: 'not_comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'MESMA coluna, janela temporal DIFERENTE: v1 media "no instante antes de comecar", v2 media ' +
      '"no ultimo dia". Direcao inalterada, mas nao e correto tratar como uma serie continua sem ' +
      'aviso — ver GLOSSARIO_METRICAS.md.',
  },
  'workout.preMotivation': {
    variableId: 'workout.preMotivation',
    domain: 'psychological_state',
    dataType: 'ordinal_scale',
    constructLabel: 'vontade de treinar',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 1, field: 'preMotivation', storageLocation: 'column' },
      { version: 2, field: 'preMotivation', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'Redacao adaptada na v2 (mais concreta), mesma coluna e mesma variavel conceitual.',
  },

  // ---------------------------------------------------------------------------------------------
  // Feedback por treino — bloco Resposta ao treino
  // ---------------------------------------------------------------------------------------------
  'workout.perceivedEffort': {
    variableId: 'workout.perceivedEffort',
    domain: 'training_response',
    dataType: 'ordinal_scale',
    constructLabel: 'percepcao de esforco (RPE)',
    scale: { min: 1, max: 10 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 1, field: 'perceivedEffort', storageLocation: 'column' },
      { version: 2, field: 'perceivedEffort', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'Escala 1-10 (RPE classico), nunca convertida para 1-5.',
  },
  'workout.satisfactionElaboracao': {
    variableId: 'workout.satisfactionElaboracao',
    domain: 'training_response',
    dataType: 'ordinal_scale',
    constructLabel: 'satisfacao com a elaboracao do treino',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 1, field: 'satisfactionElaboracao', storageLocation: 'column' },
      { version: 2, field: 'satisfactionElaboracao', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'Gravada como categoria (amei..detestei); ObservationReader converte pra 1-5 usando o mesmo ' +
      'SATISFACTION_SCORE ja usado em workout-completions.service.ts (nao duplica a tabela de conversao).',
  },
  'workout.executionVsPrescribed': {
    variableId: 'workout.executionVsPrescribed',
    domain: 'training_response',
    dataType: 'ordinal_scale',
    constructLabel: 'desvio da execucao em relacao ao prescrito (1=bem menos, 3=como prescrito, 5=bem mais)',
    scale: { min: 1, max: 5 },
    direction: 'not_directional',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 2, field: 'executionVsPrescribed', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: true,
    notes:
      'Substitui satisfactionCapacidade a partir da v2, mas NAO e comparavel a ela (escala com ' +
      'significado diferente — ver schema.prisma). Excluida em sessoes extra: nao ha "prescrito" ' +
      'de referencia numa sessao que o proprio aluno criou.',
  },
  'workout.postPhysicalFatigue': {
    variableId: 'workout.postPhysicalFatigue',
    domain: 'training_response',
    dataType: 'ordinal_scale',
    constructLabel: 'cansaco fisico provocado pelo treino',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 2, field: 'postPhysicalFatigue', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'NAO e comparavel a postWorkoutFeeling (v1): direcao oposta (postWorkoutFeeling 1=mal/5=bem; ' +
      'esta e 1=pouco cansaco/5=muito cansaco). Por isso e uma variableId separada, nunca a mesma serie.',
  },
  'workout.postMentalFatigue': {
    variableId: 'workout.postMentalFatigue',
    domain: 'psychological_state',
    dataType: 'ordinal_scale',
    constructLabel: 'cansaco mental provocado pelo treino',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 2, field: 'postMentalFatigue', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'Pergunta nova a partir da v2 — sem equivalente na v1.',
  },
  'workout.emotionalExperienceDuring': {
    variableId: 'workout.emotionalExperienceDuring',
    domain: 'psychological_state',
    dataType: 'ordinal_scale',
    constructLabel: 'experiencia emocional durante o treino',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 1, storageLocation: 'details_json', detailsKey: 'postWorkoutMood' },
      { version: 2, field: 'emotionalExperienceDuring', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'Mesma variavel conceitual em v1 (guardada em details.postWorkoutMood, sem coluna propria) e ' +
      'v2 (promovida a coluna). Nao e mudanca de semantica, so de local de armazenamento — ver ' +
      'schema.prisma. ObservationReader le dos dois lugares conforme feedbackVersion da sessao.',
  },
  'workout.mentalStateChangePrePost': {
    variableId: 'workout.mentalStateChangePrePost',
    domain: 'psychological_state',
    dataType: 'ordinal_scale',
    constructLabel: 'mudanca do estado mental comparando antes x depois do treino (1=muito pior, 5=muito melhor)',
    scale: { min: 1, max: 5 },
    direction: 'not_directional',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 2, field: 'mentalStateChangePrePost', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'Pergunta nova a partir da v2 — nao redundante com emotionalExperienceDuring (mede mudanca, nao experiencia durante).',
  },
  'workout.painFlag': {
    variableId: 'workout.painFlag',
    domain: 'pain_health',
    dataType: 'categorical',
    direction: 'not_directional',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'categorical_frequency',
    missingPolicy: 'never_impute',
    versions: [
      { version: 1, field: 'painFlag', storageLocation: 'column' },
      { version: 2, field: 'painFlag', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'Categorica (none|leve|moderado|forte) — MathLayer desta rodada so opera sobre ordinal_scale/' +
      'numeric_continuous; incluida aqui pra provar que o registry nao presume que toda variavel e numerica.',
  },

  // ---------------------------------------------------------------------------------------------
  // Check-in semanal (WeeklyCheckIn) — colunas comparaveis v2/v3
  // ---------------------------------------------------------------------------------------------
  'checkin.prescriptionLiking': {
    variableId: 'checkin.prescriptionLiking',
    domain: 'training_response',
    dataType: 'ordinal_scale',
    constructLabel: 'quanto gostou dos treinos prescritos na semana',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_weekly_checkin',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 2, field: 'prescriptionLiking', storageLocation: 'column' },
      { version: 3, field: 'prescriptionLiking', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'Coluna reaproveitada identica entre v2 e v3 (weekly-checkin.service.ts).',
  },
  'checkin.prescriptionSuitability': {
    variableId: 'checkin.prescriptionSuitability',
    domain: 'training_response',
    dataType: 'ordinal_scale',
    constructLabel: 'adequacao percebida dos treinos prescritos',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_weekly_checkin',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 2, field: 'prescriptionSuitability', storageLocation: 'column' },
      { version: 3, field: 'prescriptionSuitability', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
  },
  'checkin.executionSatisfaction': {
    variableId: 'checkin.executionSatisfaction',
    domain: 'training_response',
    dataType: 'ordinal_scale',
    constructLabel: 'satisfacao com a propria execucao na semana',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_weekly_checkin',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 2, field: 'executionSatisfaction', storageLocation: 'column' },
      { version: 3, field: 'executionSatisfaction', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
  },
  'checkin.bodyResponseVsNormal': {
    variableId: 'checkin.bodyResponseVsNormal',
    domain: 'physical_state',
    dataType: 'ordinal_scale',
    constructLabel: 'resposta do corpo comparada ao normal do proprio aluno',
    scale: { min: 1, max: 5 },
    direction: 'not_directional',
    source: 'student_weekly_checkin',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 2, field: 'bodyResponseVsNormal', storageLocation: 'column' },
      { version: 3, field: 'bodyResponseVsNormal', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
  },
  'checkin.postWeekMotivation': {
    variableId: 'checkin.postWeekMotivation',
    domain: 'psychological_state',
    dataType: 'ordinal_scale',
    constructLabel: 'motivacao ao final da semana',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_weekly_checkin',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [
      { version: 2, field: 'postWeekMotivation', storageLocation: 'column' },
      { version: 3, field: 'postWeekMotivation', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
  },
  'checkin.weekDemandVsNormal': {
    variableId: 'checkin.weekDemandVsNormal',
    domain: 'training_response',
    dataType: 'ordinal_scale',
    constructLabel: 'exigencia da semana comparada ao normal do proprio aluno',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_weekly_checkin',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 3, field: 'weekDemandVsNormal', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'Variavel nova na v3, sem equivalente anterior.',
  },
  'checkin.expectedRoutineInterference': {
    variableId: 'checkin.expectedRoutineInterference',
    domain: 'training_response',
    dataType: 'ordinal_scale',
    constructLabel: 'interferencia esperada da rotina na proxima semana',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_weekly_checkin',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 3, field: 'expectedRoutineInterference', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'Coluna NOVA na v3 (nao reaproveita routineInterference nem expectedScheduleFeasibility da v2, ' +
      'que tinham escala invertida e janela temporal diferente — ver schema.prisma).',
  },

  // ---------------------------------------------------------------------------------------------
  // Ciclo menstrual (MenstrualDailyLog) — evolucao do acompanhamento menstrual, 25/09/2026.
  // Registro diario opcional (upsert por data) — nao tem dimensao de modalidade (nao e' por treino).
  // ---------------------------------------------------------------------------------------------
  'cycle.crampsLevel': {
    variableId: 'cycle.crampsLevel',
    domain: 'menstrual_cycle',
    dataType: 'ordinal_scale',
    constructLabel: 'intensidade de cólica',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_menstrual_daily_log',
    expectedFrequency: 'per_day',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, field: 'crampsLevel', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
  },
  'cycle.energyLevel': {
    variableId: 'cycle.energyLevel',
    domain: 'menstrual_cycle',
    dataType: 'ordinal_scale',
    constructLabel: 'energia',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_menstrual_daily_log',
    expectedFrequency: 'per_day',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, field: 'energyLevel', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
  },
  'cycle.moodLevel': {
    variableId: 'cycle.moodLevel',
    domain: 'menstrual_cycle',
    dataType: 'ordinal_scale',
    constructLabel: 'estabilidade de humor',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_menstrual_daily_log',
    expectedFrequency: 'per_day',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, field: 'moodLevel', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: '1 = muito instável, 5 = muito estável (nunca "5 = feliz") — ver MenstrualDailyLog no schema.',
  },
};

export function getVariableDefinition(variableId: string): VariableDefinition | undefined {
  return VARIABLE_REGISTRY[variableId];
}

export type VariabilityStrategy = 'robust_distributional' | 'not_applicable';

/**
 * Estrategia de variabilidade permitida pra uma variavel, derivada de allowedMathStrategy — nao
 * duplica a informacao numa segunda propriedade por variavel. 'robust_distributional' (mediana/IQR/
 * MAD) e' a unica estrategia real desta rodada; a funcao existe pra que a ESCOLHA continue vindo do
 * registry (nunca hardcoded no MathLayer/LongitudinalDynamics) mesmo quando uma segunda estrategia
 * for adicionada no futuro.
 */
export function getVariabilityStrategy(definition: VariableDefinition): VariabilityStrategy {
  return definition.allowedMathStrategy === 'ordinal_or_continuous_stats' ? 'robust_distributional' : 'not_applicable';
}

export function listVariableIds(): string[] {
  return Object.keys(VARIABLE_REGISTRY);
}
