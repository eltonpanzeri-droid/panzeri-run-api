// Contexto de INFORMACOES do aluno que chega ao Prescritor (Etapa 1.1, 09/10/2026).
// Funcoes PURAS: selecao, ordenacao e formatacao estrutural. Nenhuma decide treino nem interpreta conteudo —
// a interpretacao continua sendo do agente (Principio da Prescricao). Aqui so' se garante que a informacao CHEGA, com
// data e status, e que o que ainda nao foi processado ou nao pode ser recuperado fica EXPLICITO (nunca em silencio).

// ── Lacunas de contexto ──────────────────────────────────────────────────────────────────────────────────────────

export type ContextGapSource =
  | 'estado_do_atleta'
  | 'ciclo_menstrual'
  | 'relatorio_de_evolucao'
  | 'prontuario'
  | 'relatos_do_aluno'
  | 'checkin_semanal'
  | 'historico_semanal'
  | 'execucao_da_semana';

export interface ContextGap {
  source: ContextGapSource;
  // 'degradado' = o dado existe mas NAO pôde ser recuperado (falha); 'informativo' = ha processamento pendente, mas o
  // conteudo bruto foi entregue ao agente (nada se perdeu).
  severity: 'degradado' | 'informativo';
  reason: string;
  // O que isto significa para a decisao, em linguagem para o agente.
  effect: string;
}

export function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, ' ').slice(0, 160);
}

// ── Relatos interpretados pelo Relator ───────────────────────────────────────────────────────────────────────────

export interface ReportEntryRow {
  id: string;
  sourceType: string;
  relatedLabel: string | null;
  originalText: string;
  occurredAt: Date;
  analyzedAt: Date | null;
  analysisError: string | null;
  createdAt: Date;
  facts: string | null;
  perception: string | null;
  themes: string[];
  temporality: string | null;
  longitudinalNote: string | null;
  hypotheses: string[];
  relevance: string | null;
}

export interface ReportEntryForAgent {
  data: string;
  origem: string;
  fatos: string | null;
  percepcaoDoAluno: string | null;
  temas: string[];
  temporalidade: string | null;
  relevancia: string | null;
  notaLongitudinal: string | null;
  // Hipoteses do Relator sao HIPOTESES, nunca fatos.
  hipotesesDoRelator: string[];
  relatoOriginal: string;
}

export interface PendingReportForAgent {
  data: string;
  origem: string;
  situacao: 'em_processamento' | 'analise_falhou' | 'sem_analise';
  relatoOriginal: string;
}

export const REPORT_CONTEXT_LIMITS = {
  recentRelevantDays: 120,
  resolvedDays: 180,
  maxPersistent: 30,
  maxRecentRelevant: 40,
  maxPending: 20,
  originalTextChars: 600,
  pendingTextChars: 800,
  factChars: 500,
  // Processamento recente demais para ja ter terminado: a analise ainda pode estar em andamento.
  inFlightMs: 15 * 60 * 1000,
  // Orcamento total (caracteres) dos relatos interpretados: acima disso descartam-se primeiro os mais antigos que
  // NAO sao persistentes.
  totalBudgetChars: 14000,
} as const;

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const day = (date: Date) => date.toISOString().slice(0, 10);

function toAgentEntry(row: ReportEntryRow): ReportEntryForAgent {
  return {
    data: day(row.occurredAt),
    origem: row.relatedLabel ?? row.sourceType,
    fatos: row.facts ? truncate(row.facts, REPORT_CONTEXT_LIMITS.factChars) : null,
    percepcaoDoAluno: row.perception ? truncate(row.perception, REPORT_CONTEXT_LIMITS.factChars) : null,
    temas: row.themes.slice(0, 8),
    temporalidade: row.temporality,
    relevancia: row.relevance,
    notaLongitudinal: row.longitudinalNote ? truncate(row.longitudinalNote, REPORT_CONTEXT_LIMITS.factChars) : null,
    hipotesesDoRelator: row.hypotheses.slice(0, 5),
    relatoOriginal: truncate(row.originalText, REPORT_CONTEXT_LIMITS.originalTextChars),
  };
}

const entrySize = (entry: ReportEntryForAgent) => JSON.stringify(entry).length;

// Selecao estrutural (sem ler o conteudo):
//  - TODO relato com temporalidade PERSISTENTE_ATE_CONTRARIO (vale ate o aluno dizer o contrario; sem limite de idade);
//  - relatos de relevancia diferente de PONTUAL dos ultimos N dias;
//  - relatos RESOLVIDOS dos ultimos N dias (para o agente ver que uma restricao anterior foi encerrada);
//  - relatos ainda SEM interpretacao entram a parte, com o texto bruto.
// Ordem cronologica crescente: o mais recente vem por ultimo (a regra de precedencia esta no prompt do agente).
export function selectRelevantReportEntries(rows: ReportEntryRow[], now: Date = new Date()): { interpreted: ReportEntryForAgent[]; pending: PendingReportForAgent[]; omittedForBudget: number; interpretedIds: string[]; pendingIds: string[] } {
  const L = REPORT_CONTEXT_LIMITS;
  const dayMs = 86_400_000;
  const analyzed = rows.filter((row) => row.analyzedAt !== null);
  const newestFirst = (a: ReportEntryRow, b: ReportEntryRow) => b.occurredAt.getTime() - a.occurredAt.getTime();

  const persistent = analyzed.filter((r) => r.temporality === 'PERSISTENTE_ATE_CONTRARIO').sort(newestFirst).slice(0, L.maxPersistent);
  const persistentIds = new Set(persistent.map((r) => r.id));
  const recentRelevant = analyzed
    .filter((r) => !persistentIds.has(r.id))
    .filter((r) => {
      const age = now.getTime() - r.occurredAt.getTime();
      if (r.temporality === 'RESOLVIDO') return age <= L.resolvedDays * dayMs;
      return r.relevance !== null && r.relevance !== 'PONTUAL' && age <= L.recentRelevantDays * dayMs;
    })
    .sort(newestFirst)
    .slice(0, L.maxRecentRelevant);

  let omittedForBudget = 0;
  let nonPersistent = recentRelevant;
  const persistentEntries = persistent.map(toAgentEntry);
  let used = persistentEntries.reduce((total, entry) => total + entrySize(entry), 0);
  const keptNonPersistent: ReportEntryRow[] = [];
  for (const row of nonPersistent) { // do mais novo para o mais antigo
    const size = entrySize(toAgentEntry(row));
    if (used + size > L.totalBudgetChars) { omittedForBudget++; continue; }
    used += size;
    keptNonPersistent.push(row);
  }
  nonPersistent = keptNonPersistent;

  const interpretedRows = [...persistent, ...nonPersistent].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const interpreted = interpretedRows.map(toAgentEntry);

  const pendingRows = rows
    .filter((row) => row.analyzedAt === null)
    .sort(newestFirst)
    .slice(0, L.maxPending)
    .reverse();
  const pending: PendingReportForAgent[] = pendingRows
    .map((row): PendingReportForAgent => ({
      data: day(row.occurredAt),
      origem: row.relatedLabel ?? row.sourceType,
      situacao: row.analysisError
        ? 'analise_falhou'
        : now.getTime() - row.createdAt.getTime() <= L.inFlightMs ? 'em_processamento' : 'sem_analise',
      relatoOriginal: truncate(row.originalText, L.pendingTextChars),
    }));

  // Ids paralelos aos arrays acima (rastreabilidade); NAO fazem parte do que e enviado a IA.
  return { interpreted, pending, omittedForBudget, interpretedIds: interpretedRows.map((r) => r.id), pendingIds: pendingRows.map((r) => r.id) };
}

// ── Observacoes do aluno e eventos do prontuario ainda nao condensados ───────────────────────────────────────────

export function formatObservationForAgent(observation: { content: string; createdAt?: Date | null }): string {
  return observation.createdAt ? `[registrada em ${day(observation.createdAt)}] ${observation.content}` : observation.content;
}

export function formatPendingProfileEvent(event: { code: string; content: string; createdAt: Date }, maxChars = 700): string {
  return `[${day(event.createdAt)}] ${event.code}: ${truncate(event.content, maxChars)}`;
}

// ── Historico semanal: UMA semana = UM plano autoritativo ────────────────────────────────────────────────────────

export interface HistoryPlanLike<S> {
  id: string;
  startDate: Date;
  createdAt: Date;
  planCode?: number | null;
  sessions: Array<S & { id: string; completion: unknown | null }>;
}

export interface HistoryWeek<S> {
  startDate: Date;
  // Sessoes que contam para o historico daquela semana.
  sessions: Array<S & { id: string; completion: unknown | null }>;
  planId: string;
  supersededPlanIds: string[];
}

// Cada geracao/regeneracao cria um TrainingPlan novo e arquiva o anterior; as sessoes JA EXECUTADAS sao migradas para o novo
// plano (TrainingPlansService.generateWeekLocked). Logo, para uma mesma semana:
//   - o plano MAIS RECENTE e' o autoritativo: todas as suas sessoes sao reais (inclusive as sem registro do aluno);
//   - planos anteriores da mesma semana so' contribuem com sessoes COM registro que nao estejam no autoritativo; as sem
//     registro sao "fantasmas" de regeneracao (o aluno nunca as viu) e nao contam.
// Antes disto, o historico usava os ultimos N PLANOS (nao semanas): uma semana regenerada ocupava varias vagas e suas
// sessoes-fantasma inflavam o prescrito e as sessoes "sem registro".
export function selectHistoryWeeks<S>(plans: Array<HistoryPlanLike<S>>, maxWeeks = 4): Array<HistoryWeek<S>> {
  const byWeek = new Map<string, Array<HistoryPlanLike<S>>>();
  for (const plan of plans) {
    const key = day(plan.startDate);
    byWeek.set(key, [...(byWeek.get(key) ?? []), plan]);
  }
  const weeks = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, maxWeeks)
    .map(([, weekPlans]): HistoryWeek<S> => {
      const ordered = [...weekPlans].sort((a, b) => (b.createdAt.getTime() - a.createdAt.getTime()) || ((b.planCode ?? 0) - (a.planCode ?? 0)));
      const [authoritative, ...superseded] = ordered;
      const known = new Set(authoritative.sessions.map((s) => s.id));
      const kept: HistoryWeek<S>['sessions'] = [...authoritative.sessions];
      for (const plan of superseded) {
        for (const session of plan.sessions) {
          if (session.completion !== null && !known.has(session.id)) {
            known.add(session.id);
            kept.push(session);
          }
        }
      }
      return { startDate: authoritative.startDate, sessions: kept, planId: authoritative.id, supersededPlanIds: superseded.map((p) => p.id) };
    });
  return weeks;
}
