/**
 * EVOLUÇÃO DO ATLETA — Contrato de Métricas V1
 *
 * Gerado em: 2026-09-09
 * Baseado no censo de cobertura de dados (09/09/2026).
 *
 * REGRAS FUNDAMENTAIS:
 * - adherencePercent = feitas / (feitas + naoFeitas)
 *   Sem registro NÃO entra no denominador. Nunca.
 * - coveragePercent = (feitas + naoFeitas) / sessoesPrescritas
 *   É uma métrica de transparência, sempre exibida junto com aderência.
 * - Quando coveragePercent < 30%, a UI exibe aviso de baixa cobertura.
 * - Todas as datas são YYYY-MM-DD no fuso UTC-3 (Brasil).
 * - Nenhum dado é inventado. Se não existe, o campo retorna null.
 *
 * NÃO incluído no V1 (dados insuficientes no censo):
 * - WeeklyCheckIn (23 registros totais)
 * - PainReport (14 registros totais)
 * - FitnessTest (30 registros, entrada escondida da UI)
 * - Pace/ritmo por sessão (não existe no schema)
 */

// ---------------------------------------------------------------------------
// Tipos primitivos compartilhados
// ---------------------------------------------------------------------------

export type ISODate = string; // 'YYYY-MM-DD'
export type ISOTimestamp = string; // ISO 8601 com timezone
export type YearMonth = string; // 'YYYY-MM'

export type SessionStatus = 'feita' | 'nao_feita' | 'sem_registro' | 'futura';

// ---------------------------------------------------------------------------
// Volume semanal
// ---------------------------------------------------------------------------

/**
 * Dados de uma semana de treino.
 * Semana começa na segunda-feira (padrão do sistema).
 */
export interface WeeklyVolume {
  /** Início da semana — segunda-feira */
  weekStart: ISODate;

  /** Sessões que o sistema prescreveu nessa semana */
  sessoesPrescritas: number;

  /** done + adjusted — aluno confirmou que treinou */
  sessoesFeitas: number;

  /** missed explícito — aluno confirmou que não treinou */
  sessoesNaoFeitas: number;

  /** Sem WorkoutCompletion e data já passou — desconhecido */
  sessoesSemRegistro: number;

  /**
   * feitas / (feitas + naoFeitas)
   * null quando denominador = 0 (nenhum feedback qualitativo)
   */
  adherencePercent: number | null;

  /**
   * (feitas + naoFeitas) / prescritas
   * Percentual de sessões sobre as quais o aluno deu algum feedback.
   * Usado para mostrar o aviso de baixa cobertura.
   */
  coveragePercent: number;

  /** true quando coveragePercent < 30 */
  lowCoverageWarning: boolean;

  /**
   * Soma de km percorridos nas sessões feitas da semana (campo distanceKm do WorkoutCompletion).
   * null quando nenhuma sessão feita teve distância preenchida.
   */
  kmPercorridos: number | null;
}

// ---------------------------------------------------------------------------
// Agregado mensal
// ---------------------------------------------------------------------------

export interface MonthlyAggregate {
  month: YearMonth;
  sessoesPrescritas: number;
  sessoesFeitas: number;
  sessoesNaoFeitas: number;
  sessoesSemRegistro: number;
  adherencePercent: number | null;
  coveragePercent: number;
  /** Soma de km percorridos nas sessões feitas do mês */
  kmPercorridos: number | null;
}

// ---------------------------------------------------------------------------
// Resumo de aderência por período
// ---------------------------------------------------------------------------

export type AdherencePeriod = 'all_time' | 'last_4_weeks' | 'last_8_weeks';

export interface AdherenceSummary {
  period: AdherencePeriod;
  sessoesPrescritas: number;
  sessoesFeitas: number;
  sessoesNaoFeitas: number;
  sessoesSemRegistro: number;

  /** feitas / (feitas + naoFeitas). null se sem dados */
  adherencePercent: number | null;

  /** (feitas + naoFeitas) / prescritas */
  coveragePercent: number;

  /** true quando coveragePercent < 30 */
  lowCoverageWarning: boolean;
}

// ---------------------------------------------------------------------------
// Distribuição por modalidade
// ---------------------------------------------------------------------------

export interface ModalityBreakdown {
  modality: string;
  sessoesPrescritas: number;
  sessoesFeitas: number;
  adherencePercent: number | null;
  coveragePercent: number;

  /** Percentual sobre o total de sessões prescritas do aluno */
  percentOfTotalPrescribed: number;
}

// ---------------------------------------------------------------------------
// Streak de consistência
// ---------------------------------------------------------------------------

/**
 * Contagem de semanas consecutivas com ao menos 1 sessão registrada
 * (feita ou não feita — o que importa é ter dado feedback).
 */
export interface ConsistencyStreak {
  /** Semanas consecutivas atuais com pelo menos 1 registro */
  currentStreakWeeks: number;

  /** Maior sequência já registrada */
  longestStreakWeeks: number;

  /** ISO date da última sessão com qualquer registro */
  lastRegisteredDate: ISODate | null;

  /** ISO date da última sessão com status feita/adjusted */
  lastCompletedDate: ISODate | null;
}

// ---------------------------------------------------------------------------
// Overview completo (endpoint principal)
// ---------------------------------------------------------------------------

/**
 * Resposta do endpoint GET /me/evolution/overview
 * Usado na tela de Evolução do aluno.
 */
export interface EvolutionOverview {
  /** Data do primeiro plano de treino do aluno */
  dataAvailableSince: ISODate | null;

  /** Total de semanas em que o aluno teve pelo menos um plano ativo */
  totalWeeksWithPlan: number;

  /** Total de sessões sem qualquer registro, acumulado */
  totalSemRegistro: number;

  /** Soma total de km percorridos em todas as sessões feitas com distância preenchida */
  totalKmPercorridos: number;

  /** Resumos de aderência por período */
  adherence: {
    allTime: AdherenceSummary;
    last4Weeks: AdherenceSummary;
    last8Weeks: AdherenceSummary;
  };

  /** Sequência de consistência */
  consistency: ConsistencyStreak;

  /** Distribuição de modalidades (all time) */
  modalityBreakdown: ModalityBreakdown[];

  /** Últimas 12 semanas de volume (para o gráfico de barras) */
  recentWeeks: WeeklyVolume[];

  /** Timestamp de quando esses dados foram calculados */
  calculatedAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Série temporal (endpoint para gráficos detalhados)
// ---------------------------------------------------------------------------

/**
 * Resposta do endpoint GET /me/evolution/series
 * Usado para gráficos de tendência de longo prazo.
 */
export interface EvolutionSeries {
  /** Todas as semanas desde o início (para gráfico completo) */
  weeks: WeeklyVolume[];

  /** Agregados mensais */
  months: MonthlyAggregate[];

  calculatedAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Tipos de entrada para o serviço de cálculo
// ---------------------------------------------------------------------------

/**
 * Dados brutos necessários para calcular todas as métricas de evolução.
 * O serviço recebe isso do Prisma e devolve os tipos acima.
 * Sem chamadas de IA. Sem fórmulas de prescrição. Apenas aritmética.
 */
export interface RawSessionData {
  sessionId: string;
  scheduledDate: ISODate;
  modality: string;
  completionStatus: 'done' | 'adjusted' | 'missed' | null;
  completionDate: ISODate | null;
  perceivedEffort: number | null;
  /** distanceKm do WorkoutCompletion; null se não preenchido ou sem completion */
  distanceKm: number | null;
}

/**
 * Parâmetros de consulta aceitos pelos endpoints de evolução
 */
export interface EvolutionQueryParams {
  /** Número de semanas recentes para o endpoint /overview (default: 12) */
  recentWeeks?: number;
}
