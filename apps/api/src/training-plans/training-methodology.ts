export const PANZERI_METHODOLOGY_VERSION = 'panzeri-methodology-v1';

// Perguntas de entrevista que ja foram removidas/substituidas ao longo do tempo. Alunos que
// responderam a versao antiga da entrevista mantem essas chaves para sempre no JSON de
// respostas salvas (nunca sao apagadas). Sem este filtro, esse dado morto e contraditorio
// (ex: "current_continuous_run: Ate 5 minutos" de anos atras, de uma aluna que corre bem hoje)
// vaza sem filtro para dentro do contexto dos agentes de IA e gera conclusoes erradas.
// Sempre que uma pergunta for removida ou renomeada de verdade (nao so reformulada), adicione a
// chave antiga aqui.
const OBSOLETE_INTERVIEW_KEYS = new Set([
  'current_continuous_run', 'pain_region', 'ran_5k_recently', 'longest_distance_recent',
  'recent_physical_assessment', 'assessment_method', 'assessment_weight', 'muscle_mass', 'visceral_fat',
]);

export function sanitizeInterviewAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!OBSOLETE_INTERVIEW_KEYS.has(key)) sanitized[key] = value;
  }

  // 'pain_region' (texto livre) foi substituido por 'pain_regions' (multipla escolha
  // hierarquica) nesta versao da entrevista. Alunos que responderam antes dessa mudanca e
  // ainda nao refizeram a entrevista tem apenas o campo antigo preenchido — sem esta migracao,
  // a informacao de dor deles simplesmente desaparece do contexto do agente (respostasEntrevista
  // e a UNICA fonte de dados de dor que o agente de prescricao recebe).
  const legacyPainRegion = typeof answers.pain_region === 'string' ? answers.pain_region.trim() : '';
  const hasStructuredPainRegions = Array.isArray(answers.pain_regions) && answers.pain_regions.length > 0;
  if (legacyPainRegion && !hasStructuredPainRegions) {
    const existingOther = typeof sanitized.pain_other_location === 'string' ? sanitized.pain_other_location.trim() : '';
    sanitized.pain_other_location = existingOther ? `${existingOther}; ${legacyPainRegion}` : legacyPainRegion;
  }

  return sanitized;
}

export const PANZERI_PRESCRIPTION_PRINCIPLES = [
  'Individualizar acima de qualquer modelo fixo: objetivo, experiencia, condicionamento, rotina, dores, idade, teste e evolucao.',
  'Usar distribuicao polarizada como referencia flexivel, buscando aproximadamente 80% do volume em baixa intensidade.',
  'Prescrever corrida prioritariamente por distancia: quilometragem fixa por etapa, com pace, velocidade e tempo apresentados em faixas.',
  'Priorizar um treino longo progressivo, inclusive com corrida e caminhada quando isso ampliar o tempo aerobio com seguranca.',
  'Controlar progressao percentual e absoluta, evitando saltos bruscos de volume e do treino longo.',
  'Alternar aumento, manutencao e reducao dos longos quando as distancias e cargas crescerem.',
  'Preservar recuperacao, especialmente para iniciantes, pessoas pouco condicionadas ou com baixa resposta ao treino.',
  'Tratar caminhada como ferramenta valida de intensidade, recuperacao e progressao.',
  'Respeitar a rotina real e reduzir forca quando ela conflitar com corrida intensa ou longa.',
  'Usar fortalecimento com volume compativel, boa execucao e intensidade progressiva.',
  'Reduzir carga e recomendar avaliacao profissional diante de dor importante, limitacao, lesao recente ou doenca aguda.',
  'Ajustar o pace prescrito pela evolucao real, aderencia e percepcao do aluno ao longo do tempo — nunca mencionar nem sugerir teste de 3km ao aluno, feature suspensa pelo treinador.',
  'Reavaliar semanalmente o que foi prescrito, realizado e registrado no Strava antes de manter, aumentar ou reduzir carga.',
] as const;

export interface MethodologyAvailability {
  weekday: number;
  modalities: string[];
  availableMin?: number | null;
  modalityDurations?: Record<string, number> | null;
}

export interface MethodologyHistoryWeek {
  runMinutes: number;
  completedRunMinutes: number;
  longestRunMinutes: number;
  prescribedSessions: number;
  completedSessions: number;
  // Datas reais (incidente real 10/08 — aluna fez uma prova no domingo, e na terca seguinte a IA
  // escreveu "voce completou ontem", quando na verdade ja fazia 2 dias — ela nao tinha NENHUMA
  // data real pra calcular isso, so os numeros agregados da semana acima, sem nenhum dia anexado).
  // weekStartDate da o contexto geral de quando essa semana aconteceu; longestRunDate (quando
  // existir) e a data exata do dia do treino mais longo daquela semana — normalmente o dado mais
  // util pra situar uma prova/longao especifico no tempo.
  weekStartDate: string;
  longestRunDate: string | null;
}

export interface MethodologyInput {
  goal: string;
  experience: string;
  answers: Record<string, unknown>;
  availability: MethodologyAvailability[];
  history: MethodologyHistoryWeek[];
  stravaRunMinutes: number;
  stravaLongestRunMinutes: number;
  executionInsight?: {
    adherencePercent: number;
    executionPercent: number;
    actualKm: number;
    actualMinutes: number;
    distanceChangePercent: number | null;
    loadTrend: string;
  } | null;
  stravaAnalysis?: {
    summary: string;
    flags: string[];
    crossTrainingNote: string | null;
  } | null;
  studentDirectives?: string[];
  activeObservations?: string[];
  // Resumo condensado do prontuario do aluno (StudentProfileService.refreshProfile), gerado por
  // um agente pequeno e barato que le o log de eventos do aluno. Complementa (nao substitui) os
  // campos acima — pense nele como "o que um treinador ja sabe de cor sobre esse aluno", enquanto
  // history/studentDirectives/activeObservations continuam sendo a fonte primaria e mais recente.
  studentProfileSummary?: string;
  todayDate?: string;
  weekDates?: Array<{ weekday: number; date: string }>;
  recentReassessment?: {
    completedAt: string;
    answers: Record<string, unknown>;
    evolutionSummary?: string | null;
    evolutionWins?: string[];
    evolutionConcerns?: string[];
  } | null;
  painTier?: 'normal' | 'reduced' | 'remove_running';
  painReason?: string | null;
  // Lista (nao mais uma unica prova) — correcao real 16/08: um aluno pode ter mais de uma prova
  // "em_andamento" simultaneamente (ex: 10km em 3 semanas + meia em 3 meses), e antes so a mais
  // proxima chegava ate a IA. Ver TargetRacesService.activeGoals — ja vem filtrado (sem provas
  // vencidas havia mais de 2 dias, arquivadas automaticamente ali).
  targetRaces?: Array<{
    name: string;
    raceDate: string;
    distanceKm: number;
    paceSecondsPerKm: number | null;
    // Questionario de contexto sobre a meta (10/08) — escala de 1 a 10, cada campo pode ser null
    // (aluno nao respondeu, ou prova cadastrada antes dessa pergunta existir). Existe pra IA
    // calibrar TOM e o quanto vale empurrar alem do confortavel — ver a regra correspondente em
    // buildSystemPromptStable (prescription-agent.service.ts), nunca uma formula/trava.
    performanceIntent: number | null;
    socialIntent: number | null;
    personalImportance: number | null;
    perceivedDifficulty: number | null;
    dedicationWillingness: number | null;
    achievementSatisfaction: number | null;
    confidenceLevel: number | null;
    injuryConcern: number | null;
    adjustmentOpenness: number | null;
    anxietyLevel: number | null;
    isFirstTimeAtDistance: boolean | null;
  }>;
  // Maior distancia de corrida/caminhada CONCLUIDA de verdade (registrada em completion), de toda
  // a historia do aluno — nao um resumo escrito por outro agente, e sim calculado direto do banco.
  // Existe para progressoes de longo prazo (ex: diretriz de maratona com escada de distancias ao
  // longo de meses) nao dependerem so da memoria/resumo do prontuario para saber o estado atual.
  longestRunEver?: {
    distanceKm: number;
    date: string;
    satisfaction: string | null;
    // Autorrelato do aluno: 'correu_tudo' | 'caminhou_pouco' | 'caminhou_muito' | null (nao
    // respondido). Ver [[correr_vs_completar_distancia]] — distancia completada com caminhada NAO
    // e o mesmo que distancia corrida continuamente, especialmente pra decisoes de progressao.
    pacingMode: string | null;
  } | null;
  // So preenchido quando longestRunEver.distanceKm >= 8km (pedido explicito do treinador 10/08) —
  // treinos concluidos nas ultimas 10 semanas que chegaram perto (>=50%) da distancia do recorde
  // historico. Existe pra IA distinguir um recorde "quente" (reforcado por treinos recentes perto
  // desse patamar) de um recorde "frio" (feito uma vez, sem nada perto depois) — ela mesma faz essa
  // leitura como recomendacao de raciocinio (ver buildSystemPromptStable em
  // prescription-agent.service.ts), nao existe nenhuma formula em codigo decidindo isso.
  recentSessionsNearRecord?: Array<{
    distanceKm: number;
    date: string;
    pacingMode: string | null;
  }>;
}

// Um treino de corrida e descrito como uma SEQUENCIA ORDENADA de partes (nunca mais uma escolha
// unica entre "corrida continua OU intervalado OU caminhada-corrida") — pedido explicito do
// treinador (10/08): um treino pode ser misto, com varias partes diferentes (ex: caminhada, depois
// um bloco intervalado, depois mais caminhada). Cada parte e uma destas duas formas:
// (1) "continua" — uma distancia com um pace (pode ser um numero so, quando min===max, ou uma
// faixa quando o ritmo varia ao longo da parte); cobre tanto "caminhada"/"corrida constante"
// quanto "corrida variada", sem precisar de um terceiro tipo separado.
// (2) "intervalada" — um bloco que repete N vezes um estimulo + uma recuperacao, cada um com sua
// propria distancia e pace; cobre tanto "correr forte / recuperar" quanto "caminhar / correr"
// (os rotulos stimulusLabel/recoveryLabel dizem o que cada trecho e, ex: "Correr forte"/"Trotar",
// ou "Caminhar"/"Correr").
// A IA decide livremente quantas partes usar (normalmente 1, mas pode ser varias) e a ordem —
// o codigo so monta a exibicao somando todas elas, sem nenhuma conta ou regra propria decidindo
// o treino (ver [[no_math_rules_for_workout_calc]]).
export interface ContinuousPartDecision {
  kind: 'continua';
  distanceKm: number;
  paceSecondsPerKmMin: number;
  paceSecondsPerKmMax: number;
}

export interface IntervalPartDecision {
  kind: 'intervalada';
  repeatCount: number;
  stimulusLabel: string;
  stimulusStepKm: number;
  stimulusPaceSecondsPerKm: number;
  recoveryLabel: string;
  recoveryStepKm: number;
  recoveryPaceSecondsPerKm: number;
}

export type SessionPartDecision = ContinuousPartDecision | IntervalPartDecision;

export interface RunSessionDecision {
  weekday: number;
  title: string;
  durationMin: number;
  notes: string;
  parts: SessionPartDecision[];
}

export type StrengthModality = 'forca' | 'fortalecimento_corredores';

export interface StrengthSlot {
  weekday: number;
  modality: StrengthModality;
  durationMin: number;
}

// Escolha de exercicios de UM dia de forca/fortalecimento, decidida pela IA — nao existe mais
// nenhuma rotina fixa de exercicios escondida do agente (ver [[ai_only_prescription_engine]]).
// exerciseIds sao validados contra o catalogo aprovado (gymExerciseLibrary ou
// runnerStrengthExercises, conforme a modalidade) antes de serem aceitos.
export interface StrengthSessionDecision {
  weekday: number;
  modality: StrengthModality;
  title: string;
  exerciseIds: string[];
  sets: number;
  reps: string;
  restSeconds: number;
  intensity: 'Leve' | 'Moderada' | 'Forte';
  notes: string;
}

export interface WeeklyMethodologyDecision {
  sessions: RunSessionDecision[];
  strengthSessions?: StrengthSessionDecision[];
  recommendation: string;
  rationale: string[];
  safetyAdjustment: boolean;
  // Preenchido quando a IA cobriu menos/mais dias ou duracao diferente da rotina cadastrada sem
  // nenhuma diretriz individual justificando — ver validateSessions em prescription-agent.service.ts.
  // generateWeek() usa isso pra avisar o treinador so quando nao ha diretriz ativa (com diretriz,
  // o desvio e esperado).
  routineMismatch?: string | null;
  // Mesma informacao, quebrada por sessao (chave "weekday:modality", modality="corrida" pra
  // qualquer sessao de corrida) — generateWeek() usa isso pra marcar SO a sessao especifica que
  // saiu do combinado (TrainingSession.routineMismatchNote), em vez de tratar a semana inteira
  // como fora da rotina. Pedido explicito do treinador 03/08: aviso ao aluno + pedido de feedback
  // por sessao, nunca bloqueio.
  sessionMismatches?: Record<string, string>;
}

export function computeRunSlots(availability: MethodologyAvailability[]) {
  return availability
    .flatMap((day) => day.modalities.filter(isRunModality).map((modality) => ({
      weekday: day.weekday,
      durationMin: day.modalityDurations?.[modality] ?? day.availableMin ?? 45,
    })))
    .sort((left, right) => left.weekday - right.weekday);
}

export function computeStrengthSlots(availability: MethodologyAvailability[]): StrengthSlot[] {
  return availability
    .flatMap((day) => day.modalities.filter(isStrengthModality).map((modality) => ({
      weekday: day.weekday,
      modality: modality as StrengthModality,
      durationMin: day.modalityDurations?.[modality] ?? day.availableMin ?? 45,
    })))
    .sort((left, right) => left.weekday - right.weekday);
}

function isStrengthModality(modality: string) {
  return modality === 'forca' || modality === 'fortalecimento_corredores';
}

function isRunModality(modality: string) {
  return modality === 'corrida' || modality === 'esteira';
}

// A entrevista guardava esse tempo como M:SS (duas partes); a versao atual usa um seletor de
// roda H:MM:SS (tres partes). Aceitamos os dois formatos para nao quebrar respostas antigas ja
// salvas por alunos que ainda nao refizeram a entrevista.
export function parseMmSsToSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 2) [minutes, seconds] = parts;
  else if (parts.length === 3) [hours, minutes, seconds] = parts;
  else return null;
  if (minutes >= 60 || seconds >= 60) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

const CURRENTLY_RUNNING_VALUES = new Set(['currently_lt_3m', 'currently_lt_6m', 'currently_lt_1y', 'currently_gt_1y']);
export function isCurrentlyRunning(answers: Record<string, unknown>): boolean {
  return CURRENTLY_RUNNING_VALUES.has(String(answers.running_experience ?? ''));
}

export function numericAnswer(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value : null;
  if (typeof value === 'string') {
    const normalized = Number(value.replace(',', '.'));
    if (Number.isFinite(normalized) && normalized > 0) return normalized;
  }
  return null;
}

export function isNovice(experience: string, answers: Record<string, unknown>) {
  const experienceText = experience.toLowerCase();
  if (['nunca', 'algumas vezes', 'nao consigo'].some((term) => experienceText.includes(term))) return true;

  if (!isCurrentlyRunning(answers)) {
    const rating = typeof answers.fitness_self_rating === 'string' ? answers.fitness_self_rating : '';
    return rating === 'muito_leve' || rating === 'leve';
  }

  const distanceKm = numericAnswer(answers.longest_distance);
  const feeling = typeof answers.recent_running_feeling === 'string' ? answers.recent_running_feeling : '';
  if (distanceKm !== null && distanceKm < 5) return true;
  return feeling === 'dificil' || feeling === 'muito_dificil';
}

export function hasSafetyConcern(answers: Record<string, unknown>) {
  const injury = String(answers.important_injury ?? '').toLowerCase();
  const pain = answers.current_pain === 'yes';
  return pain || injury.includes('limitacoes') || injury.includes('limitações');
}

