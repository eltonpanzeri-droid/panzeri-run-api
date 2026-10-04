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
  | 'menstrual_cycle'
  | 'training_load';

export type VariableDataType = 'ordinal_scale' | 'categorical' | 'numeric_continuous';

/**
 * Direcao semantica. Deliberadamente NAO existe 'higher_is_better' — ver regra canonica no topo
 * do arquivo. constructLabel (no VariableDefinition) diz o que especificamente aumenta com o valor.
 */
export type SemanticDirection = 'higher_is_more_of_construct' | 'not_directional';

export type VariableSource =
  | 'student_feedback_per_workout'
  // 01/10/2026 — variavel coletada no formulario de feedback do treino, mas pertence a um registro
  // COMPARTILHADO entre sessoes (sono = uma noite, NightlySleepLog; estresse = janela movel de 24h,
  // StressCheckin), nunca a uma sessao especifica. Ver VariableDefinition.relatedTable.
  | 'student_feedback_shared_record'
  | 'student_weekly_checkin'
  | 'student_menstrual_daily_log'
  | 'student_menstrual_cycle_log'
  | 'weekly_training_load'
  // 04/10/2026 — metrica OBJETIVA de uma atividade executada (ActivityLog, qualquer provedor). Nao
  // depende de feedback; uma linha de ActivityLog = uma observacao.
  | 'activity_objective';

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
  // 'per_night' (01/10/2026): uma observacao por noite de sono, nao por sessao/treino — distinto de
  // 'per_day', que aqui descreve estresse (janela movel de 24h, nao uma noite fixa).
  expectedFrequency: 'per_workout' | 'per_week' | 'per_day' | 'per_night' | 'per_cycle';
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
  /**
   * 01/10/2026 — quando a variavel passou a viver num registro COMPARTILHADO entre sessoes
   * (NightlySleepLog/StressCheckin), aponta pro campo que a alimenta a partir de agora: uma linha
   * da tabela relacionada = uma observacao, por construcao (nunca duplica entre sessoes do mesmo
   * dia/janela). `versions` acima continua existindo SO para o historico legado (completions
   * anteriores a esta migration, sem vinculo com a tabela nova) — ver observation-reader.service.ts,
   * readWorkoutVariable(). Variaveis sem equivalente legado (ex: as perguntas novas de horario de
   * dormir/acordar) tem `versions: []`.
   */
  relatedTable?: { table: 'nightly_sleep_log' | 'stress_checkin'; field: string };
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
    source: 'student_feedback_shared_record',
    expectedFrequency: 'per_night',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    relatedTable: { table: 'nightly_sleep_log', field: 'sleepQuality' },
    versions: [
      { version: 1, field: 'preSleepQuality', storageLocation: 'column' },
      { version: 2, field: 'preSleepQuality', storageLocation: 'column' },
    ],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'Pergunta 1 (v2) / bloco 1 (v1) — mesma semantica, sem mudanca de escala. A partir de ' +
      '01/10/2026 pertence a UMA NOITE (NightlySleepLog), nao mais a cada sessao — versions acima ' +
      'so cobre completions anteriores a essa data (sem nightlySleepLogId vinculado).',
  },
  'workout.sleepDurationHoursEstimate': {
    variableId: 'workout.sleepDurationHoursEstimate',
    domain: 'sleep',
    dataType: 'numeric_continuous',
    constructLabel: 'horas de sono estimadas',
    scale: { min: 0, max: 12, unit: 'horas' },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_shared_record',
    expectedFrequency: 'per_night',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    relatedTable: { table: 'nightly_sleep_log', field: 'sleepDurationHoursEstimate' },
    versions: [{ version: 2, field: 'sleepDurationHoursEstimate', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'Transcricao numerica direta da categoria escolhida (ponto medio da faixa), sem formula nova ' +
      '— ver sleepDurationHoursEstimate() em workout-completions.service.ts. So existe a partir da v2. ' +
      'A partir de 01/10/2026 pertence a UMA NOITE (NightlySleepLog), ver nota em workout.preSleepQuality.',
  },
  // 01/10/2026: sleepScheduleIrregularity (pergunta 3, "irregularidade do horario") foi SUBSTITUIDA
  // por bedtimeShiftDirection (ver abaixo) — perdia a direcao do desvio. Esta variavel NAO tem
  // relatedTable: fica congelada lendo so o historico legado (versions), nunca mais ganha dado novo.
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
    notes: 'Substituida por workout.bedtimeShiftDirection em 01/10/2026 — historico preservado, sem dado novo a partir desta data.',
  },
  // 01/10/2026, NOVA — substitui workout.sleepScheduleIrregularity. Direcao+magnitude, nao escala
  // de intensidade: categorica por design (ver nota da proibicao de escala artificial no pedido).
  'workout.bedtimeShiftDirection': {
    variableId: 'workout.bedtimeShiftDirection',
    domain: 'sleep',
    dataType: 'categorical',
    direction: 'not_directional',
    source: 'student_feedback_shared_record',
    expectedFrequency: 'per_night',
    allowedMathStrategy: 'categorical_frequency',
    missingPolicy: 'never_impute',
    relatedTable: { table: 'nightly_sleep_log', field: 'bedtimeShiftDirection' },
    versions: [],
    versionComparability: 'not_comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'Categorica com 7 niveis (much_earlier..much_later) — nunca forcar numa escala 1-5 artificial.',
  },
  // 01/10/2026, NOVA — mesma logica/categorias de bedtimeShiftDirection, para o horario de acordar.
  'workout.wakeTimeShiftDirection': {
    variableId: 'workout.wakeTimeShiftDirection',
    domain: 'sleep',
    dataType: 'categorical',
    direction: 'not_directional',
    source: 'student_feedback_shared_record',
    expectedFrequency: 'per_night',
    allowedMathStrategy: 'categorical_frequency',
    missingPolicy: 'never_impute',
    relatedTable: { table: 'nightly_sleep_log', field: 'wakeTimeShiftDirection' },
    versions: [],
    versionComparability: 'not_comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'Categorica com 7 niveis (much_earlier..much_later) — nunca forcar numa escala 1-5 artificial.',
  },
  'workout.sleepInterruption': {
    variableId: 'workout.sleepInterruption',
    domain: 'sleep',
    dataType: 'ordinal_scale',
    constructLabel: 'interrupcao do sono durante a noite',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_shared_record',
    expectedFrequency: 'per_night',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    relatedTable: { table: 'nightly_sleep_log', field: 'sleepInterruption' },
    versions: [{ version: 2, field: 'sleepInterruption', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'A partir de 01/10/2026 pertence a UMA NOITE (NightlySleepLog), ver nota em workout.preSleepQuality.',
  },
  'workout.sleepDifficulty': {
    variableId: 'workout.sleepDifficulty',
    domain: 'sleep',
    dataType: 'ordinal_scale',
    constructLabel: 'dificuldade para pegar no sono',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_shared_record',
    expectedFrequency: 'per_night',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    relatedTable: { table: 'nightly_sleep_log', field: 'sleepDifficulty' },
    versions: [{ version: 2, field: 'sleepDifficulty', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'A partir de 01/10/2026 pertence a UMA NOITE (NightlySleepLog), ver nota em workout.preSleepQuality.',
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
    source: 'student_feedback_shared_record',
    expectedFrequency: 'per_day',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    relatedTable: { table: 'stress_checkin', field: 'stressLevel' },
    versions: [
      { version: 1, field: 'preStressLevel', storageLocation: 'column' },
      { version: 2, field: 'preStressLevel', storageLocation: 'column' },
    ],
    versionComparability: 'not_comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'MESMA coluna/escala, janela temporal mudou duas vezes: v1 media "no instante antes de ' +
      'comecar", v2 "no ultimo dia" (ainda por sessao). A partir de 01/10/2026 (StressCheckin) vira ' +
      '"ultimas 24h" com timestamp REAL da resposta (respondedAt), reaproveitado entre sessoes na ' +
      'mesma janela — nao e correto tratar como serie continua entre essas janelas sem aviso.',
  },
  // 01/10/2026, NOVA — "Nas ultimas 24 horas, com que frequencia voce passou por momentos que
  // aumentaram claramente seu estresse?" Distinta de preStressLevel (intensidade geral); mede
  // frequencia de eventos. Sem equivalente legado — versions: [].
  'workout.stressEventFrequency': {
    variableId: 'workout.stressEventFrequency',
    domain: 'psychological_state',
    dataType: 'ordinal_scale',
    constructLabel: 'frequencia de momentos de estresse nas ultimas 24h',
    scale: { min: 1, max: 5 },
    direction: 'higher_is_more_of_construct',
    source: 'student_feedback_shared_record',
    expectedFrequency: 'per_day',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    relatedTable: { table: 'stress_checkin', field: 'stressEventFrequency' },
    versions: [],
    versionComparability: 'not_comparable_across_versions',
    excludeExtraSessions: false,
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
      'de referencia numa sessao que o proprio aluno criou. CONGELADA em 01/10/2026: substituida ' +
      'por workout.executionBehavior (categorica/comportamental, nao ordinal) — esta variavel so ' +
      'ganha novas observacoes de completions antigos (feedbackVersion 2 sem executionBehavior); ' +
      'as duas NUNCA devem ser combinadas na mesma serie/media/baseline, sao semanticas diferentes.',
  },
  // 01/10/2026 — substitui workout.executionVsPrescribed. Mede o COMPORTAMENTO do aluno diante da
  // prescricao (seguiu / adaptou / mudou muito / trocou de treino / interrompeu), nunca
  // distancia/duracao/intensidade/ritmo/volume (isso fica com o dado objetivo de execucao,
  // incluindo integracoes de relogio). Categorica por design: as 5 alternativas NAO tem ordem nem
  // intensidade entre si — nunca calcular media/baseline/tendencia nem interpretar uma categoria
  // como "mais" ou "melhor" que outra. "Nao fiz o treino" nao e uma destas categorias (tem fluxo
  // proprio, status 'missed') — so se aplica quando houve inicio/execucao real.
  'workout.executionBehavior': {
    variableId: 'workout.executionBehavior',
    domain: 'training_response',
    dataType: 'categorical',
    direction: 'not_directional',
    source: 'student_feedback_per_workout',
    expectedFrequency: 'per_workout',
    allowedMathStrategy: 'categorical_frequency',
    missingPolicy: 'never_impute',
    versions: [{ version: 3, field: 'executionBehavior', storageLocation: 'column' }],
    versionComparability: 'not_comparable_across_versions',
    excludeExtraSessions: true,
    notes:
      'Substitui workout.executionVsPrescribed (01/10/2026) — serie SEPARADA e NAO comparavel ' +
      '(semantica quantitativa antiga vs. categorica/comportamental nova). Historico antigo ' +
      'preservado intacto em workout.executionVsPrescribed, nunca migrado nem reinterpretado.',
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

  // ---------------------------------------------------------------------------------------------
  // Ciclo menstrual (MenstrualCycleLog) — item 5 do pedido de 26/09 (domínio na Exploração
  // Longitudinal do Admin). Uma "observação" aqui não é diária: cada uma representa um CICLO
  // inteiro, disponível só quando o intervalo se torna conhecido (ver ObservationReader). Isso
  // faz duração de ciclo/menstruação passarem pela MESMA matemática (tendência/baseline/faixa
  // habitual/excursão) de qualquer outra variável, sem nenhuma tela nova no Admin — a Exploração
  // Longitudinal já lista qualquer variável do domínio automaticamente.
  // ---------------------------------------------------------------------------------------------
  'cycle.cycleLengthDays': {
    variableId: 'cycle.cycleLengthDays',
    domain: 'menstrual_cycle',
    dataType: 'numeric_continuous',
    constructLabel: 'duração do ciclo em dias',
    scale: { min: 15, max: 60, unit: 'dias' },
    direction: 'not_directional',
    source: 'student_menstrual_cycle_log',
    expectedFrequency: 'per_cycle',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, field: 'cycleStartDate', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'So existe UMA observação por INTERVALO entre dois inícios sucessivos (não por ciclo isolado) — ' +
      'o último ciclo registrado nunca gera observação porque a duração dele só é conhecida quando o ' +
      'PRÓXIMO começar (mesma regra de getCycleOverview em menstrual-cycle.service.ts, sem segunda ' +
      'matemática). Timestamp = data de início do ciclo seguinte (quando o valor passou a ser sabido).',
  },
  'cycle.periodLengthDays': {
    variableId: 'cycle.periodLengthDays',
    domain: 'menstrual_cycle',
    dataType: 'numeric_continuous',
    constructLabel: 'duração da menstruação em dias',
    scale: { min: 1, max: 15, unit: 'dias' },
    direction: 'not_directional',
    source: 'student_menstrual_cycle_log',
    expectedFrequency: 'per_cycle',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, field: 'cycleEndDate', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'So existe quando o FIM do sangramento foi informado — nunca inventa um fim. Timestamp = data de início daquele ciclo.',
  },

  // ---------------------------------------------------------------------------------------------
  // Volume, aderência e carga semanal (26/09/2026 — auditoria Volume/Aderência/ACWR). Fonte real:
  // EvolutionMetricService (evolution-metric.service.ts), NUNCA recalculado aqui — este arquivo só
  // registra a SEMÂNTICA de cada série já existente. Granularidade semanal real (expectedFrequency
  // 'per_week') — MM21/MM60/MM200 continuam significando 21/60/200 DIAS de calendário (a Camada
  // Matemática já trabalha por calendar_days, nunca por contagem de observações), então uma janela
  // de "MM21" aqui cobre ~3 semanas de dados, não 21 semanas — a UI mostra n/coverage reais, nunca
  // esconde a amostra pequena atrás de um rótulo enganoso.
  // ---------------------------------------------------------------------------------------------
  'training.volumePrescribedKm': {
    variableId: 'training.volumePrescribedKm',
    domain: 'training_load',
    dataType: 'numeric_continuous',
    constructLabel: 'volume prescrito',
    scale: { min: 0, max: 200, unit: 'km' },
    direction: 'not_directional',
    source: 'weekly_training_load',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, field: 'kmPrescritos', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'Soma de km planejados (TrainingSession.distanceKm) na semana — inclui apenas sessões com distância planejada preenchida. Ausente (nunca zero) quando nenhuma sessão da semana tinha km planejado.',
  },
  'training.volumeCompletedTotalKm': {
    variableId: 'training.volumeCompletedTotalKm',
    domain: 'training_load',
    dataType: 'numeric_continuous',
    constructLabel: 'volume total realizado',
    scale: { min: 0, max: 200, unit: 'km' },
    direction: 'not_directional',
    source: 'weekly_training_load',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, field: 'kmPercorridos', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'kmPercorridos de EvolutionMetricService — soma de km das sessões FEITAS (done/adjusted) na semana, JÁ INCLUINDO sessões extras (ver volumeCompletedPrescribedOnlyKm pra isolar só o prescrito). Esta é a série usada como "carga semanal" pro ACWR.',
  },
  'training.volumeCompletedPrescribedOnlyKm': {
    variableId: 'training.volumeCompletedPrescribedOnlyKm',
    domain: 'training_load',
    dataType: 'numeric_continuous',
    constructLabel: 'volume realizado (só sessões prescritas)',
    scale: { min: 0, max: 200, unit: 'km' },
    direction: 'not_directional',
    source: 'weekly_training_load',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, field: 'kmPercorridos', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: true,
    notes: 'kmPercorridos MENOS kmExtras — isola o volume que veio da prescrição em si, sem o que o aluno fez por iniciativa própria. Item 2 do pedido: nunca fundir prescrito-executado com extra na mesma série.',
  },
  'training.volumeExtraKm': {
    variableId: 'training.volumeExtraKm',
    domain: 'training_load',
    dataType: 'numeric_continuous',
    constructLabel: 'volume extra (iniciativa própria)',
    scale: { min: 0, max: 100, unit: 'km' },
    direction: 'not_directional',
    source: 'weekly_training_load',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, field: 'kmExtras', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'kmExtras de EvolutionMetricService — km de sessões criadas pelo próprio aluno (structure.source=student, type=extra). Ausente (nunca zero) na semana em que não houve nenhuma sessão extra.',
  },
  'training.volumeDiffAbsoluteKm': {
    variableId: 'training.volumeDiffAbsoluteKm',
    domain: 'training_load',
    dataType: 'numeric_continuous',
    constructLabel: 'diferença realizado menos prescrito',
    scale: { min: -100, max: 100, unit: 'km' },
    direction: 'not_directional',
    source: 'weekly_training_load',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, storageLocation: 'details_json', detailsKey: 'volumeDiffAbsoluteKm' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'volumeCompletedTotalKm − volumePrescribedKm, calculado só quando AMBOS existem naquela semana (nunca inventa um dos dois pra completar a subtração — semana sem km prescrito não vira "diferença de -X").',
  },
  'training.volumeRatioCompletedPrescribed': {
    variableId: 'training.volumeRatioCompletedPrescribed',
    domain: 'training_load',
    dataType: 'numeric_continuous',
    constructLabel: 'razão realizado/prescrito',
    scale: { min: 0, max: 3 },
    direction: 'not_directional',
    source: 'weekly_training_load',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, storageLocation: 'details_json', detailsKey: 'volumeRatioCompletedPrescribed' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes: 'volumeCompletedTotalKm ÷ volumePrescribedKm — só existe quando prescrito > 0 (item 3 do pedido: semana sem prescrição NUNCA vira 0% nem 100%, simplesmente não gera observação nessa semana).',
  },
  'training.adherencePercent': {
    variableId: 'training.adherencePercent',
    domain: 'training_load',
    dataType: 'numeric_continuous',
    constructLabel: 'aderência semanal',
    scale: { min: 0, max: 100, unit: '%' },
    direction: 'higher_is_more_of_construct',
    source: 'weekly_training_load',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, field: 'adherencePercent', storageLocation: 'column' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'feitas ÷ (feitas + não-feitas) — sem registro NUNCA entra no denominador (mesma fórmula canônica de EvolutionMetricService/coach.service.ts). Ausente (nunca 0%) na semana em que feitas+naoFeitas=0. ' +
      'Numerador/denominador/coverage reais ficam no context de cada observação (context.numerator/denominator/coveragePercent) — a % nunca aparece sem o tamanho da amostra por trás.',
  },
  'training.acwr': {
    variableId: 'training.acwr',
    domain: 'training_load',
    dataType: 'numeric_continuous',
    constructLabel: 'relação carga aguda:crônica (ACWR)',
    scale: { min: 0, max: 3 },
    direction: 'not_directional',
    source: 'weekly_training_load',
    expectedFrequency: 'per_week',
    allowedMathStrategy: 'ordinal_or_continuous_stats',
    missingPolicy: 'never_impute',
    versions: [{ version: 1, storageLocation: 'details_json', detailsKey: 'acwr' }],
    versionComparability: 'comparable_across_versions',
    excludeExtraSessions: false,
    notes:
      'Média móvel de 28 dias (aguda) ÷ média móvel de 42 dias (crônica) de training.volumeCompletedTotalKm, calculadas com a MESMA MathLayerService.movingAverage do resto da Training Intelligence (calendar_days, nunca por índice de array). ' +
      'É uma RELAÇÃO descritiva — não representa segurança, risco, correção de treino nem suficiência de estímulo por si só. Composição completa (agudo/crônico/coverage) fica no context de cada observação.',
  },
};

// ---------------------------------------------------------------------------------------------
// Metricas objetivas por atividade (04/10/2026, Evolucao objetiva). Fonte: ActivityLog (corrida
// executada, classificada corresponding/alternative). Pace e' DERIVADO na leitura de duracao/
// distancia (nunca persistido); cadencia e' a media ja normalizada pela serie canonica
// (ActivityTimeSeriesService) — ausente (nunca zero) quando o dispositivo nao forneceu.
// ---------------------------------------------------------------------------------------------
VARIABLE_REGISTRY['activity.avgPaceSecondsKm'] = {
  variableId: 'activity.avgPaceSecondsKm',
  domain: 'training_load',
  dataType: 'numeric_continuous',
  constructLabel: 'ritmo medio da corrida (segundos por km — valor MAIOR = mais lento)',
  scale: { min: 120, max: 1200, unit: 's/km' },
  direction: 'not_directional',
  source: 'activity_objective',
  expectedFrequency: 'per_workout',
  allowedMathStrategy: 'ordinal_or_continuous_stats',
  missingPolicy: 'never_impute',
  versions: [{ version: 1, storageLocation: 'column', field: 'durationSec/distanceMeters' }],
  versionComparability: 'comparable_across_versions',
  excludeExtraSessions: false,
  notes:
    'duracao ÷ distancia da atividade (so corrida com distancia > 0). Contextos diferentes (treino leve, intervalado, longao) NAO sao misturados em um julgamento: o pace medio so descreve o que aconteceu naquela atividade. Observacao tem context.modality = ActivityLog.sport.',
};
VARIABLE_REGISTRY['activity.cadenceAvg'] = {
  variableId: 'activity.cadenceAvg',
  domain: 'training_load',
  dataType: 'numeric_continuous',
  constructLabel: 'cadencia media da corrida (passos por minuto)',
  scale: { min: 60, max: 260, unit: 'spm' },
  direction: 'not_directional',
  source: 'activity_objective',
  expectedFrequency: 'per_workout',
  allowedMathStrategy: 'ordinal_or_continuous_stats',
  missingPolicy: 'never_impute',
  versions: [{ version: 1, storageLocation: 'column', field: 'cadenceAvg' }],
  versionComparability: 'comparable_across_versions',
  excludeExtraSessions: false,
  notes:
    'ActivityLog.cadenceAvg (media da serie canonica, ignorando leituras 0 = sem sinal de movimento). So entram atividades de corrida com cadencia valida fornecida pelo dispositivo — sem cadencia, a atividade nao gera observacao.',
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
