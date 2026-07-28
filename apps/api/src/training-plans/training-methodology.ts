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
  'Usar o teste de 3 km como referencia inicial e ajustar por evolucao, aderencia, percepcao e novos testes.',
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
  targetRace?: {
    name: string;
    raceDate: string;
    distanceKm: number;
    paceSecondsPerKm: number | null;
  } | null;
}

// Estrutura do bloco intervalado (quality_run) — decidida pela IA, nao por uma proporcao fixa no
// codigo. O codigo so monta a exibicao a partir desses numeros e confere se a soma do tempo real
// bate com durationMin (ver validateSessions em prescription-agent.service.ts).
export interface IntervalStructureDecision {
  repeatCount: number;
  fastStepKm: number;
  recoveryStepKm: number;
  recoveryPaceSecondsPerKm: number;
  easyVolumeKm: number;
}

// Estrutura do bloco caminhada-corrida (walk_run) — mesma logica: a IA decide, o codigo so monta
// e confere consistencia.
export interface WalkRunStructureDecision {
  repeatCount: number;
  walkStepKm: number;
  runStepKm: number;
  walkPaceSecondsPerKm: number;
  runPaceSecondsPerKm: number;
}

export interface RunSessionDecision {
  weekday: number;
  title: string;
  sessionType: 'easy_run' | 'quality_run' | 'long_run' | 'walk_run';
  zone: 'Z2' | 'Z4';
  durationMin: number;
  notes: string;
  // Orientacoes gerais (aquecimento, desaquecimento, hidratacao, cuidados rua/esteira etc.),
  // pensadas pela IA para este aluno especifico — NAO fazem parte do treino prescrito nem da
  // distancia/duracao total, sao so recomendacoes em texto exibidas separadamente.
  recommendations?: string;
  // Preenchido pela IA somente quando sessionType === 'quality_run'/'walk_run' (null nos demais
  // casos). Substituem uma formula fixa (proporcao 30/70, passo de recuperacao sempre 0,4km, pace
  // de recuperacao sempre 900s/km) que decidia isso no lugar da IA.
  intervalStructure?: IntervalStructureDecision | null;
  walkRunStructure?: WalkRunStructureDecision | null;
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
  targetLowIntensityShare: number;
  paceAssessment?: {
    easyPaceSecondsPerKm: number;
    intensePaceSecondsPerKm: number;
    rationale: string;
  };
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

