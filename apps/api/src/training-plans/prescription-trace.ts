import { createHash } from 'crypto';
import { describeSessionShape } from './agent-context-format';
import type { ContextGap } from './student-information-context';
import type { MethodologyInput } from './training-methodology';

// Rastreabilidade das prescricoes (Etapa 1.2a, 09/10/2026). Funcoes PURAS: montam o INDICE de evidencias e as decisoes
// deterministicas. Nada aqui decide treino. O que a IA "declara" ter usado (intent/expected/basis) e' da 1.2b — aqui ficam
// vazios (traceStatus = absent). Regra de ouro: o que foi CONSIDERADO e' registrado pelo codigo, nao pelo que a IA diz.

export const TRACE_SCHEMA_VERSION = 1;
export const DEFAULT_AGENT_INPUT_RETENTION_MONTHS = 12;

export type EvidenceDelivery = 'delivered' | 'delivered_unprocessed' | 'absent';
export type EvidenceStorage = 'complete' | 'partial' | 'reference_only';

export interface EvidenceItem {
  // Referencia estavel (ex: report:<id>, directive:<id>, variable:workout.perceivedEffort).
  ref: string;
  kind: string;
  // Tabela/origem do dado (nunca o dado bruto de um provedor).
  source: string;
  sourceId: string | null;
  // Provedor de dispositivo de que o item deriva diretamente (so' itens de atividade); Strava nunca aparece.
  provider: string | null;
  asOf: string | null;
  label: string;
  // entregue a IA / entregue sem processar (texto bruto) / ausente (nao recuperado).
  delivery: EvidenceDelivery;
  // como este item esta guardado NO INDICE: completo / parcial (trecho) / so' referencia.
  storage: EvidenceStorage;
  storageNote?: string;
  excerpt: string | null;
  // true apos exclusao de dados do provedor (valores e referencia removidos).
  redacted?: boolean;
}

export interface AgentCallTrace {
  purpose: 'semana' | 'dia_corrida' | 'dia_forca' | 'reparo_forca';
  model: string;
  // SHA-256 do(s) prompt(s) de sistema (o texto vive no codigo, versionado; so o hash e' guardado).
  systemPromptSha256: string;
  // Texto EXATO do prompt de usuario enviado a IA.
  userPrompt: string;
}

export function recordAgentCall(trace: AgentCallTrace[] | undefined, call: { purpose: AgentCallTrace['purpose']; model: string; system: string; userPrompt: string }): void {
  if (!trace) return;
  trace.push({ purpose: call.purpose, model: call.model, systemPromptSha256: sha256(call.system), userPrompt: call.userPrompt });
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const dayOf = (date: Date | string | null | undefined) => (date ? new Date(date).toISOString().slice(0, 10) : null);

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

// ── Registro do que foi enviado a IA ─────────────────────────────────────────────────────────────────────────────

export interface AgentInputRecord {
  agentInput: unknown;
  agentInputHash: string;
  modelIds: string[];
  oversized: boolean;
}

// Limite de seguranca por pacote (caracteres do JSON): acima disto so' o indice de evidencias e' guardado.
export const MAX_AGENT_INPUT_CHARS = 512 * 1024;

export function buildAgentInputRecord(calls: AgentCallTrace[]): AgentInputRecord {
  const hash = sha256(JSON.stringify(calls.map((call) => [call.purpose, call.model, call.systemPromptSha256, call.userPrompt])));
  const modelIds = [...new Set(calls.map((call) => call.model))];
  // O prompt e' guardado como TEXTO EXATO (string): o jsonb do Postgres reordena chaves de objetos, entao um objeto parseado nao reproduz
  // o texto enviado. O hash (userPromptSha256) permite conferir a fidelidade; a leitura devolve tambem uma copia parseada para consulta.
  const entries = calls.map((call, index) => ({
    attempt: index + 1, purpose: call.purpose, model: call.model, systemPromptSha256: call.systemPromptSha256, userPromptSha256: sha256(call.userPrompt), userPrompt: call.userPrompt,
  }));
  const size = JSON.stringify(entries).length;
  if (size > MAX_AGENT_INPUT_CHARS) return { agentInput: null, agentInputHash: hash, modelIds, oversized: true };
  return { agentInput: { calls: entries }, agentInputHash: hash, modelIds, oversized: false };
}

// ── Indice de evidencias ─────────────────────────────────────────────────────────────────────────────────────────

export interface EvidenceBuildInput {
  input: MethodologyInput;
  directives: Array<{ id: string; content: string; createdAt: Date }>;
  observations: Array<{ id: string; content: string; createdAt: Date }>;
  // Ids PARALELOS aos arrays enviados a IA (nao vao no prompt).
  interpretedReportIds: string[];
  pendingReportIds: string[];
  pendingProfileEventIds: string[];
  historyWeeks: Array<{ startDate: Date; planId: string }>;
  checkIn: { id: string } | null;
  targetRaces: Array<{ id: string; name: string }>;
  reassessment: { id: string; completedAt: Date | null } | null;
  evolutionReport: { id: string; createdAt: Date } | null;
  interviewCompletedAt: Date | null;
  paceSource: string | null;
  contextGaps: ContextGap[];
}

function item(partial: Partial<EvidenceItem> & Pick<EvidenceItem, 'ref' | 'kind' | 'source' | 'label'>): EvidenceItem {
  return { sourceId: null, provider: null, asOf: null, delivery: 'delivered', storage: 'reference_only', excerpt: null, ...partial };
}

export function buildEvidenceIndex(p: EvidenceBuildInput): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const input = p.input;

  if (Object.keys(input.answers ?? {}).length > 0) {
    items.push(item({ ref: 'interview:answers', kind: 'interview', source: 'OnboardingInterview', label: 'Respostas da entrevista inicial', asOf: dayOf(p.interviewCompletedAt), storage: 'reference_only', storageNote: 'Conteudo completo em agentInput.' }));
  }
  items.push(item({
    ref: 'availability:week', kind: 'availability', source: 'WeeklyAvailability', label: 'Rotina de treino da semana',
    storage: 'complete',
    excerpt: input.availability.map((day) => `${WEEKDAYS[day.weekday] ?? day.weekday}:${day.modalities.join('+')}${day.availableMin ? `/${day.availableMin}min` : ''}`).join(' '),
  }));
  if (p.paceSource) items.push(item({ ref: 'pace:evidence', kind: 'pace_evidence', source: 'FitnessTest|OnboardingInterview', label: 'Evidencia de pace', storage: 'complete', excerpt: p.paceSource }));

  for (const d of p.directives) {
    items.push(item({ ref: `directive:${d.id}`, kind: 'directive', source: 'StudentDirective', sourceId: d.id, asOf: dayOf(d.createdAt), label: 'Diretriz do treinador', storage: d.content.length > 300 ? 'partial' : 'complete', storageNote: d.content.length > 300 ? 'Texto integral em agentInput.' : undefined, excerpt: clip(d.content, 300) }));
  }
  for (const o of p.observations) {
    items.push(item({ ref: `observation:${o.id}`, kind: 'observation', source: 'StudentObservation', sourceId: o.id, asOf: dayOf(o.createdAt), label: 'Observacao registrada pelo aluno', storage: o.content.length > 300 ? 'partial' : 'complete', storageNote: o.content.length > 300 ? 'Texto integral em agentInput.' : undefined, excerpt: clip(o.content, 300) }));
  }

  (input.studentReports ?? []).forEach((report, index) => {
    const id = p.interpretedReportIds[index] ?? null;
    const facts = report.fatos ?? report.relatoOriginal;
    items.push(item({
      ref: id ? `report:${id}` : `report:#${index}`, kind: 'report', source: 'StudentReportEntry', sourceId: id, asOf: report.data,
      label: `Relato do aluno interpretado (${report.origem}; ${report.temporalidade ?? 'sem temporalidade'}; ${report.relevancia ?? 'sem relevancia'})`,
      storage: facts.length > 300 ? 'partial' : 'complete', storageNote: facts.length > 300 ? 'Texto integral em agentInput.' : undefined, excerpt: clip(facts, 300),
    }));
  });
  (input.pendingStudentReports ?? []).forEach((report, index) => {
    const id = p.pendingReportIds[index] ?? null;
    items.push(item({
      ref: id ? `report_pending:${id}` : `report_pending:#${index}`, kind: 'report_pending', source: 'StudentReportEntry', sourceId: id, asOf: report.data,
      label: `Relato do aluno SEM interpretacao (${report.situacao})`, delivery: 'delivered_unprocessed',
      storage: report.relatoOriginal.length > 300 ? 'partial' : 'complete', storageNote: report.relatoOriginal.length > 300 ? 'Texto integral em agentInput.' : undefined, excerpt: clip(report.relatoOriginal, 300),
    }));
  });

  if (input.studentProfileSummary) {
    items.push(item({ ref: 'profile:summary', kind: 'profile_summary', source: 'StudentProfile', label: 'Prontuario condensado', storage: 'reference_only', storageNote: `${input.studentProfileSummary.length} caracteres; sha256 ${sha256(input.studentProfileSummary).slice(0, 16)}. Conteudo em agentInput.` }));
  }
  (input.pendingProfileEvents ?? []).forEach((line, index) => {
    const id = p.pendingProfileEventIds[index] ?? null;
    items.push(item({ ref: id ? `profile_event_pending:${id}` : `profile_event_pending:#${index}`, kind: 'profile_event_pending', source: 'StudentProfileEvent', sourceId: id, label: 'Evento do prontuario ainda nao condensado', delivery: 'delivered_unprocessed', storage: line.length > 300 ? 'partial' : 'complete', excerpt: clip(line, 300) }));
  });

  for (const week of p.historyWeeks) {
    const key = dayOf(week.startDate)!;
    const summary = input.history.find((h) => h.weekStartDate === key);
    items.push(item({ ref: `history_week:${key}`, kind: 'history_week', source: 'TrainingPlan', sourceId: week.planId, asOf: key, label: 'Semana anterior (historico)', storage: summary ? 'complete' : 'reference_only', excerpt: summary ? `prescritas ${summary.prescribedSessions}, concluidas ${summary.completedSessions}, sem registro ${summary.unregisteredSessions}` : null }));
  }

  if (input.weeklyCheckIn) {
    const skipped = input.weeklyCheckIn.checkinSkipped || input.weeklyCheckIn.elaborationSatisfaction === 0;
    items.push(item({ ref: p.checkIn ? `checkin:${p.checkIn.id}` : 'checkin:latest', kind: 'checkin', source: 'WeeklyCheckIn', sourceId: p.checkIn?.id ?? null, label: skipped ? 'Check-in semanal (aluno optou por nao registrar)' : `Check-in semanal v${input.weeklyCheckIn.checkinVersion}`, storage: 'reference_only', storageNote: 'Campos em agentInput.' }));
  }
  for (const race of p.targetRaces) {
    items.push(item({ ref: `target_race:${race.id}`, kind: 'target_race', source: 'TargetRace', sourceId: race.id, label: 'Prova alvo', storage: 'complete', excerpt: clip(race.name, 120) }));
  }
  if ((input.painTier ?? 'normal') !== 'normal' || input.painReason) {
    items.push(item({ ref: 'pain:safety', kind: 'pain_safety', source: 'PainReport', label: 'Sinal de seguranca por dor', storage: 'complete', excerpt: clip(`${input.painTier ?? 'normal'}${input.painReason ? `: ${input.painReason}` : ''}`, 300) }));
  }
  if (p.reassessment) items.push(item({ ref: `reassessment:${p.reassessment.id}`, kind: 'reassessment', source: 'Reassessment', sourceId: p.reassessment.id, asOf: dayOf(p.reassessment.completedAt), label: 'Reavaliacao periodica mais recente', storage: 'reference_only' }));
  if (p.evolutionReport) items.push(item({ ref: `evolution_report:${p.evolutionReport.id}`, kind: 'evolution_report', source: 'EvolutionReport', sourceId: p.evolutionReport.id, asOf: dayOf(p.evolutionReport.createdAt), label: 'Relatorio de evolucao', storage: 'reference_only' }));

  const state = input.athleteStateContext;
  if (state) {
    let withData = 0;
    for (const [variableId, variable] of Object.entries(state.variables ?? {})) {
      const n = variable.evidence?.n ?? 0;
      if (n <= 0) continue;
      withData++;
      items.push(item({ ref: `variable:${variableId}`, kind: 'athlete_state_variable', source: 'ActivityLog|WorkoutCompletion|WeeklyCheckIn|...', asOf: variable.evidence.lastObservationAt ? dayOf(variable.evidence.lastObservationAt) : null, label: `Variavel longitudinal ${variableId}`, storage: 'reference_only', storageNote: `n=${n}; estado completo em agentInput.` }));
    }
    items.push(item({ ref: 'athlete_state:summary', kind: 'athlete_state_summary', source: 'AthleteStateSnapshot', label: 'Estado longitudinal do atleta (resumo)', storage: 'complete', excerpt: `${withData} variavel(is) com dados; ${Object.keys(state.variables ?? {}).length - withData} sem dados` }));
    if (state.menstrualCycle) items.push(item({ ref: 'menstrual_cycle:context', kind: 'menstrual_cycle', source: 'MenstrualCycleLog', label: 'Contexto do ciclo menstrual', storage: 'reference_only', storageNote: 'Conteudo em agentInput.' }));
  }

  for (const gap of p.contextGaps) {
    items.push(item({ ref: `gap:${gap.source}`, kind: 'gap', source: gap.source, label: `Lacuna de contexto (${gap.severity})`, delivery: gap.severity === 'degradado' ? 'absent' : 'delivered', storage: 'complete', excerpt: clip(`${gap.reason} | ${gap.effect}`, 400) }));
  }
  return items;
}

// ── Exclusao de dados de um provedor ─────────────────────────────────────────────────────────────────────────────

// Remove valores e referencias dos itens de evidencia derivados DIRETAMENTE de atividades do provedor (so' em exclusao explicita
// pelo aluno; desconectar NAO chama isto). Itens agregados/derivados (variaveis longitudinais) nao sao atribuiveis a um provedor.
export function redactEvidenceForProvider(evidence: unknown, provider: string): { evidence: EvidenceItem[]; redacted: number } {
  const list = Array.isArray(evidence) ? (evidence as EvidenceItem[]) : [];
  let redacted = 0;
  const next = list.map((entry) => {
    if (entry?.provider !== provider || entry.redacted) return entry;
    redacted++;
    return { ...entry, ref: `redacted:${provider}`, sourceId: null, excerpt: null, label: `Evidencia removida (dados do provedor ${provider} excluidos a pedido do aluno)`, storage: 'reference_only' as const, storageNote: 'Removida por exclusao explicita de dados do provedor.', redacted: true };
  });
  return { evidence: next, redacted };
}

// ── Decisoes deterministicas ─────────────────────────────────────────────────────────────────────────────────────

export interface SessionForTrace {
  id: string;
  weekday: number;
  modality: string;
  title?: string | null;
  sessionType: string | null;
  durationMin: number | null;
  distanceKm: number | null;
  paceMinSec: string | null;
  structure: unknown;
}

// Resumo de UMA sessao, so' com o que a prescricao gravou (sem interpretar).
export function describeSessionForTrace(session: Omit<SessionForTrace, 'id'>): string {
  const shape = describeSessionShape(session.sessionType, session.structure);
  return [
    `${WEEKDAYS[session.weekday] ?? session.weekday}`,
    session.modality,
    shape,
    session.durationMin != null ? `${session.durationMin}min` : null,
    session.distanceKm != null ? `${Number(session.distanceKm.toFixed(2))}km` : null,
    // paceMinSec ja vem gravado como "8:00/km" nas prescricoes geradas; so completa a unidade quando faltar.
    session.paceMinSec ? `pace ${session.paceMinSec.replace(/\/km$/, '')}/km` : null,
  ].filter(Boolean).join(' | ');
}

export interface DecisionDraft {
  kind: 'week' | 'session';
  sessionId: string | null;
  weekday: number | null;
  modality: string | null;
  summary: string;
  changeFromPrevious: Record<string, unknown> | null;
  rationale: Record<string, unknown> | null;
}

export function buildSessionDecisions(params: {
  sessions: SessionForTrace[];
  // Sessoes da semana ANTERIOR (historico), para apontar o que existia no mesmo dia/modalidade.
  previousWeek: { startDate: Date; sessions: Array<SessionForTrace> } | null;
}): DecisionDraft[] {
  return params.sessions.map((session) => {
    const previous = params.previousWeek?.sessions.find((candidate) => candidate.weekday === session.weekday && candidate.modality === session.modality) ?? null;
    return {
      kind: 'session' as const,
      sessionId: session.id,
      weekday: session.weekday,
      modality: session.modality,
      summary: describeSessionForTrace(session),
      changeFromPrevious: previous
        ? { previousWeekStart: dayOf(params.previousWeek!.startDate), previousSessionId: previous.id, previousSummary: describeSessionForTrace(previous) }
        : null,
      rationale: null,
    };
  });
}

export function buildWeekDecision(params: { weekStart: Date; sessionCount: number; recommendation: string; rationale: string[]; safetyAdjustment: boolean; routineMismatch?: string | null }): DecisionDraft {
  return {
    kind: 'week',
    sessionId: null,
    weekday: null,
    modality: null,
    summary: `Semana de ${dayOf(params.weekStart)}: ${params.sessionCount} sessao(oes) prescrita(s)`,
    changeFromPrevious: null,
    // Justificativa em texto livre devolvida pela IA (DECLARADA; nao e prova de influencia — ver 1.2b).
    rationale: { recommendation: params.recommendation, rationale: params.rationale, safetyAdjustment: params.safetyAdjustment, routineMismatch: params.routineMismatch ?? null },
  };
}

// ── Retencao ─────────────────────────────────────────────────────────────────────────────────────────────────────

// Meses de retencao da entrada completa (agentInput). Configuravel; 'off'/0/negativo/invalido => sem expurgo automatico.
export function parseRetentionMonths(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw.trim() === '') return DEFAULT_AGENT_INPUT_RETENTION_MONTHS;
  if (/^(off|nunca|never|disabled)$/i.test(raw.trim())) return null;
  const months = Number(raw);
  return Number.isFinite(months) && months > 0 ? Math.floor(months) : null;
}

export function retentionCutoff(now: Date, months: number): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}
