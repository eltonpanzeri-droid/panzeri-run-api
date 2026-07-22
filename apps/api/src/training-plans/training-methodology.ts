export const PANZERI_METHODOLOGY_VERSION = 'panzeri-methodology-v1';

// Perguntas de entrevista que ja foram removidas/substituidas ao longo do tempo. Alunos que
// responderam a versao antiga da entrevista mantem essas chaves para sempre no JSON de
// respostas salvas (nunca sao apagadas). Sem este filtro, esse dado morto e contraditorio
// (ex: "current_continuous_run: Ate 5 minutos" de anos atras, de uma aluna que corre bem hoje)
// vaza sem filtro para dentro do contexto dos agentes de IA e gera conclusoes erradas.
// Sempre que uma pergunta for removida ou renomeada de verdade (nao so reformulada), adicione a
// chave antiga aqui.
const OBSOLETE_INTERVIEW_KEYS = new Set(['current_continuous_run', 'pain_region']);

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
}

export interface RunSessionDecision {
  weekday: number;
  title: string;
  sessionType: 'easy_run' | 'quality_run' | 'long_run' | 'walk_run';
  zone: 'Z2' | 'Z4';
  durationMin: number;
  notes: string;
}

export interface WeeklyMethodologyDecision {
  sessions: RunSessionDecision[];
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

export function buildWeeklyMethodologyDecision(input: MethodologyInput): WeeklyMethodologyDecision {
  const runSlots = computeRunSlots(input.availability);
  const answers = input.answers;
  const novice = isNovice(input.experience, answers);
  const safetyAdjustment = hasSafetyConcern(answers);
  const latest = input.history[0];
  const previous = input.history[1];
  const observedLongest = Math.max(latest?.longestRunMinutes ?? 0, input.stravaLongestRunMinutes);
  const previousLongest = previous?.longestRunMinutes ?? 0;
  const selfReportedLongestMin =
    answers.ran_5k_recently === 'yes' ? Math.round((parseMmSsToSeconds(answers.longest_distance_recent_time) ?? 0) / 60) || null : null;
  const adherence = input.executionInsight
    ? input.executionInsight.adherencePercent / 100
    : latest?.prescribedSessions ? latest.completedSessions / latest.prescribedSessions : 1;
  const longSlot = runSlots.slice().sort((left, right) => right.durationMin - left.durationMin || weekendPriority(right.weekday) - weekendPriority(left.weekday))[0];
  const qualityAllowed = runSlots.length >= 3 && !novice && !safetyAdjustment && adherence >= 0.5;
  const qualitySlot = qualityAllowed ? chooseQualitySlot(runSlots, longSlot?.weekday, input.availability) : undefined;
  const rationale: string[] = [];

  if (novice) rationale.push('Progressao conservadora e uso de corrida com caminhada por experiencia ou condicionamento atual.');
  if (!latest && selfReportedLongestMin) rationale.push('Sem historico ainda: usamos a maior distancia relatada na entrevista como referencia inicial do treino longo.');
  if (safetyAdjustment) rationale.push('Carga reduzida por dor, limitacao ou sinal de saude informado.');
  if (input.history.length) rationale.push('Carga comparada com as semanas anteriores e com a aderencia registrada.');
  if (input.stravaRunMinutes > 0) rationale.push('Atividades recentes do Strava consideradas na decisao de carga.');
  if (input.executionInsight) {
    rationale.push(`Agente de analise: ${input.executionInsight.executionPercent}% dos treinos previstos tiveram alguma execucao e ${input.executionInsight.adherencePercent}% seguiram modalidade e execucao propostas.`);
    rationale.push(`Tendencia de carga observada no Strava: ${input.executionInsight.loadTrend}.`);
  }
  if (longSlot) rationale.push('Treino longo priorizado no dia com maior tempo disponivel.');
  if (!qualityAllowed && runSlots.length >= 2) rationale.push('Semana sem estimulo intenso para preservar recuperacao e consistencia.');

  const sessions = runSlots.map((slot) => {
    if (slot.weekday === longSlot?.weekday) {
      const durationMin = longDuration(slot.durationMin, observedLongest, previousLongest, novice, safetyAdjustment, adherence, selfReportedLongestMin);
      return {
        weekday: slot.weekday,
        title: novice ? 'Longao com corrida e caminhada' : 'Longao leve',
        sessionType: novice ? 'walk_run' as const : 'long_run' as const,
        zone: 'Z2' as const,
        durationMin,
        notes: novice
          ? 'Alternar corrida leve e caminhada para ampliar o tempo aerobio sem perder o controle da intensidade.'
          : 'Manter baixa intensidade e concluir com sensacao de controle.',
      };
    }
    if (slot.weekday === qualitySlot?.weekday) {
      return {
        weekday: slot.weekday,
        title: qualityTitle(input.goal),
        sessionType: 'quality_run' as const,
        zone: 'Z4' as const,
        durationMin: Math.min(slot.durationMin, safetyAdjustment ? 35 : 55),
        notes: 'O volume intenso fica limitado; aquecimento, recuperacoes e desaquecimento permanecem leves.',
      };
    }
    return {
      weekday: slot.weekday,
      title: 'Corrida leve',
      sessionType: 'easy_run' as const,
      zone: 'Z2' as const,
      durationMin: Math.min(slot.durationMin, safetyAdjustment ? 35 : novice ? 40 : 55),
      notes: 'Manter conforto respiratorio e acumular volume de baixa intensidade.',
    };
  });

  return {
    sessions,
    recommendation: recommendationText(input.goal, sessions, rationale),
    rationale,
    safetyAdjustment,
    targetLowIntensityShare: 0.8,
  };
}

function isRunModality(modality: string) {
  return modality === 'corrida' || modality === 'esteira';
}

function parseMmSsToSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{1,3}):(\d{1,2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
  const total = minutes * 60 + seconds;
  return total > 0 ? total : null;
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

  if (answers.ran_5k_recently === 'no') {
    const rating = typeof answers.fitness_self_rating === 'string' ? answers.fitness_self_rating : '';
    return rating === 'muito_leve' || rating === 'leve';
  }

  const distanceKm = numericAnswer(answers.longest_distance_recent);
  const feeling = typeof answers.recent_running_feeling === 'string' ? answers.recent_running_feeling : '';
  if (distanceKm !== null && distanceKm < 5) return true;
  return feeling === 'dificil' || feeling === 'muito_dificil';
}

export function hasSafetyConcern(answers: Record<string, unknown>) {
  const injury = String(answers.important_injury ?? '').toLowerCase();
  const pain = answers.current_pain === 'yes';
  return pain || injury.includes('limitacoes') || injury.includes('limitações');
}

function weekendPriority(weekday: number) {
  return weekday === 6 ? 2 : weekday === 0 ? 1 : 0;
}

function chooseQualitySlot(slots: Array<{ weekday: number; durationMin: number }>, longWeekday: number | undefined, availability: MethodologyAvailability[]) {
  const strengthDays = new Set(availability.filter((day) => day.modalities.some((item) => item === 'forca' || item === 'fortalecimento_corredores')).map((day) => day.weekday));
  return slots
    .filter((slot) => slot.weekday !== longWeekday)
    .map((slot) => ({
      ...slot,
      score: circularDistance(slot.weekday, longWeekday ?? slot.weekday) * 3 - (strengthDays.has(slot.weekday) ? 4 : 0) - (strengthDays.has(previousWeekday(slot.weekday)) ? 2 : 0),
    }))
    .sort((left, right) => right.score - left.score || right.durationMin - left.durationMin)[0];
}

function circularDistance(left: number, right: number) {
  const distance = Math.abs(left - right);
  return Math.min(distance, 7 - distance);
}

function previousWeekday(day: number) {
  return day === 0 ? 6 : day - 1;
}

function longDuration(
  available: number,
  latest: number,
  previous: number,
  novice: boolean,
  safety: boolean,
  adherence: number,
  selfReportedLongestMin?: number | null,
) {
  if (safety) return Math.min(available, latest || 40, 40);
  if (!latest) {
    if (selfReportedLongestMin) {
      const ceiling = novice ? selfReportedLongestMin : Math.round(selfReportedLongestMin * 1.1);
      return Math.max(20, Math.min(available, ceiling));
    }
    return Math.min(available, novice ? 45 : 70);
  }
  if (adherence < 0.5) return Math.min(available, latest);
  const increasedLastWeek = latest > previous && latest > 60;
  const ceiling = increasedLastWeek ? latest : Math.max(latest + 8, Math.round(latest * 1.1));
  return Math.max(30, Math.min(available, ceiling));
}

function qualityTitle(goal: string) {
  const normalized = goal.toLowerCase();
  if (normalized.includes('melhorar') || normalized.includes('tempo')) return 'Intervalado controlado';
  return 'Ritmo controlado';
}

function recommendationText(goal: string, sessions: RunSessionDecision[], rationale: string[]) {
  const long = sessions.find((session) => session.sessionType === 'long_run' || session.sessionType === 'walk_run');
  const quality = sessions.find((session) => session.sessionType === 'quality_run');
  const parts = [`Semana individualizada para ${goal || 'evolucao consistente'}.`];
  if (long) parts.push(`${long.title} de ${long.durationMin} min priorizado.`);
  if (quality) parts.push(`${quality.title} com volume intenso controlado e predominio semanal de baixa intensidade.`);
  else parts.push('Predominio de baixa intensidade para consolidar adaptacao e recuperacao.');
  if (rationale.some((item) => item.includes('Strava'))) parts.push('Execucao recente no Strava considerada.');
  return parts.join(' ');
}
