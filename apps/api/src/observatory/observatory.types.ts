import type { PhasedCycle } from '../menstrual-cycle/cycle-phases';
// Observatorio Panzeri Run (24/10/2026) — tipos do contrato. FATOS (entrada) e RESULTADOS (saida). Nada aqui carrega nome, e-mail ou id de aluno: `participant` e' uma chave
// interna e opaca que NUNCA sai da camada de calculo.

export type PainOrigin = 'explicit_no_pain' | 'no_pain_report' | 'reported_pain';

// Nivel categorico da dor marcada no feedback do treino (leve/moderado/forte). NUNCA vira nota 1-10: a nota numerica so' existe no "Relatar dor", que e' analisado a parte (ordem de Elton, 26/11/2026).
export type PainLevel = 'leve' | 'moderado' | 'forte';
export type TrainingGroup = 'corrida' | 'forca' | 'outras';

export interface ObsParticipant {
  key: string;
  // Ciclos registrados (so' quem registrou); fica na camada de calculo e NUNCA sai na resposta.
  cycle?: { cycles: PhasedCycle[]; hormonal: boolean | null };
  birthDate: string | null; // YYYY-MM-DD
  sex: string | null;
}

// Um treino de corrida elegivel (um evento fisico deduplicado) — a unidade da dor por treino.
export interface ObsRunEvent {
  participant: string;
  eventKey: string;
  day: string; // dia LOCAL da execucao (YYYY-MM-DD)
  km: number | null; // distancia valida (>0) ou null
  seconds: number | null; // duracao valida (>0) ou null
  source: 'activity' | 'manual';
  isExtra: boolean;
  feedbackAnswered: boolean;
  painLevel?: PainLevel | null;
  painTiming?: string | null;
  pain: {
    origin: PainOrigin;
    // 1..10 quando conhecida. 0 so' nos zeros operacionais. null = relato SEM nota numerica (intensidade desconhecida).
    intensity: number | null;
  };
}

// Um treino de QUALQUER modalidade (corrida, forca, outras) para a dor por treino e por 100 treinos. A dor aqui e' SO' a do feedback do treino.
export interface ObsTraining {
  participant: string;
  eventKey: string;
  day: string;
  group: TrainingGroup;
  km: number | null;
  seconds: number | null;
  feedbackAnswered: boolean;
  pain: { origin: PainOrigin; level: PainLevel | null; timing: string | null };
}

// Relato avulso do "Relatar dor" (1-10 + regioes). Analisado SEPARADO dos treinos: nao e' ligado a treino nenhum.
export interface ObsPainReport {
  participant: string;
  day: string;
  intensity: number;
  regions: string[];
}

export interface ObsStrengthEvent {
  participant: string;
  eventKey: string;
  day: string;
}

export interface ObsQuality {
  stravaExcludedEvents: number; // procedencia Strava (direta ou indireta): fora do produto analitico
  ambiguousIdentityEvents: number; // identidade fisica ambigua: fora dos totais principais
  unevaluatedIdentityEvents: number; // identidade nao avaliada (legado): incluidos, mas sinalizados
  invalidDistanceEvents: number; // evento existe mas sem distancia valida
  duplicateManualEvents: number; // treino manual que repete uma atividade importada do mesmo dia
  painReportsWithoutTraining?: number; // DESCONTINUADO (26/11/2026): o "Relatar dor" deixou de ser colado a treino; fica a parte
  painConflicts: number; // relato de dor no mesmo treino em que a aluna marcou "sem dor"
}

export interface ObsFacts {
  dataset: 'real' | 'synthetic';
  dataAsOf: string; // ISO
  participants: ObsParticipant[];
  runEvents: ObsRunEvent[];
  strengthEvents: ObsStrengthEvent[];
  trainings?: ObsTraining[];
  painReports?: ObsPainReport[];
  quality: ObsQuality;
}

export type ObsMode = 'cross' | 'cohort';
export type ObsGroupBy = 'volume' | 'age' | 'strength' | 'sex' | 'priorVolume' | 'priorStrength';

export interface ObsFilters {
  from: string;
  to: string;
  today: string; // dia local de hoje (para semanas completas)
  volumeBands: string[]; // ids das faixas de volume semanal ('v1'..'v8'); vazio = todas
  ageBands: string[]; // 'lt30','30_39',... ; vazio = todas
  strengthBands: string[]; // 's0','s1','s2p'; vazio = todas
  sexes: string[]; // vazio = todos
  mode: ObsMode;
  groupBy: ObsGroupBy;
  includeZeroWeeks: boolean;
  minParticipants: number;
}

export interface PainMetrics {
  trainings: number;
  km: number;
  reports: number; // relatos de dor (com ou sem nota)
  reportsWithIntensity: number;
  reportsWithoutIntensity: number;
  reportsPer1000Km: number | null;
  meanIntensityReports: number | null; // so' relatos com nota (zeros fora)
  meanIntensityAll: number | null; // todos os treinos com nota numerica (zeros dentro)
  painPointsPer1000Km: number | null; // soma das notas dos relatos / km * 1000
  intensityBins: Array<{ key: string; label: string; count: number; pctOfKnown: number | null; per1000Km: number | null }>;
  // Dor do FEEDBACK do treino por nivel categorico (leve/moderada/forte). E' o que a corrida tem de gravidade; a nota 1-10 so' existe no "Relatar dor" (a parte).
  levelBins: Array<{ key: PainLevel; label: string; count: number; per1000Km: number | null }>;
  coverage: {
    trainings: number;
    withFeedback: number;
    withoutFeedback: number;
    numericIntensityTrainings: number; // treinos com nota numerica (incl. zeros operacionais)
    intensityCoveragePct: number | null;
  };
  zeroOrigins: { explicitNoPain: number; noPainReport: number };
}

export interface ObsRow<T> {
  key: string;
  label: string;
  participants: number | null; // null quando a linha e' suprimida: o tamanho exato de um grupo pequeno nao e' divulgado
  suppressed: boolean;
  complementary: boolean; // ocultada por supressao complementar
  data: T | null; // null quando suprimida
}
