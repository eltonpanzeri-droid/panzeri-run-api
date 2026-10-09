import { createHash } from 'crypto';
import { describeSessionShape } from './agent-context-format';
import type { ContextGap } from './student-information-context';
import type { MethodologyInput } from './training-methodology';
import { getVariableDefinition } from '../training-intelligence/variable-registry';

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
  // Itens AGREGADOS (variaveis longitudinais calculadas a partir de atividades de dispositivo): provedores cujos dados podem ter
  // entrado no calculo. Nao e' um provedor unico, mas a exclusao de dados de qualquer um deles precisa alcancar o item.
  providers?: string[];
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
  // Proveniencia por provedor dos agregados derivados de dispositivo (atividade objetiva e carga semanal).
  provenance?: ProviderProvenance;
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
      const derivedProviders = providersForVariable(variableId, p.provenance);
      items.push(item({
        ref: `variable:${variableId}`, kind: 'athlete_state_variable',
        source: isDeviceDerivedVariable(variableId) ? 'ActivityLog' : variableId in LOAD_VARIABLE_DERIVATION ? 'TrainingSession|WorkoutCompletion|SessionExecutionLink' : 'WorkoutCompletion|WeeklyCheckIn|...',
        asOf: variable.evidence.lastObservationAt ? dayOf(variable.evidence.lastObservationAt) : null,
        label: `Variavel longitudinal ${variableId}`, storage: 'reference_only', storageNote: `n=${n}; estado completo em agentInput.`,
        // providers presente (mesmo vazio) = proveniencia CONHECIDA; ausente = nao derivada de dispositivo OU item anterior a este campo.
        ...(derivedProviders ? { providers: derivedProviders } : {}),
      }));
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

// Variavel longitudinal calculada diretamente de atividades de dispositivo (registro: source = 'activity_objective').
export const isDeviceDerivedVariable = (variableId: string) => getVariableDefinition(variableId)?.source === 'activity_objective';

// Carga semanal (source = 'weekly_training_load'): decisoes de Elton de 10/10/2026 (D1-D3). Cada variavel depende de um ou dois tipos de
// contribuicao de dispositivo; `training.volumePrescribedKm` NAO esta aqui de proposito: vem so' da prescricao e e' sempre preservada.
//  - 'extra': sessao extra criada a partir de atividade do relogio (device_extra);
//  - 'prescribed_copy': registro de sessao prescrita cujo valor e' COPIA do relogio (mesmo nao editado — D2). Valor diferente = do aluno.
// O ACWR (D3) e' invalidado quando QUALQUER componente da janela depende do provedor; o agregado e' invalidado, nunca recalculado (D1).
export type LoadContributionKind = 'extra' | 'prescribed_copy';
export const LOAD_VARIABLE_DERIVATION: Record<string, LoadContributionKind[]> = {
  'training.volumeExtraKm': ['extra'],
  'training.volumeCompletedPrescribedOnlyKm': ['prescribed_copy'],
  'training.adherencePercent': ['prescribed_copy'],
  'training.volumeCompletedTotalKm': ['extra', 'prescribed_copy'],
  'training.volumeDiffAbsoluteKm': ['extra', 'prescribed_copy'],
  'training.volumeRatioCompletedPrescribed': ['extra', 'prescribed_copy'],
  'training.acwr': ['extra', 'prescribed_copy'],
};

// Qualquer variavel cujo valor pode conter contribuicao de um provedor de dispositivo.
export const isProviderDerivedVariable = (variableId: string) => isDeviceDerivedVariable(variableId) || variableId in LOAD_VARIABLE_DERIVATION;

export interface ProviderProvenance {
  // provedores com atividade na janela (agregados activity.*)
  activity: string[];
  // provedores cujas sessoes extras (device_extra) existem na janela
  extra: string[];
  // provedores cujos valores foram copiados para o registro de sessoes prescritas na janela
  prescribedCopy: string[];
}

export const EMPTY_PROVENANCE: ProviderProvenance = { activity: [], extra: [], prescribedCopy: [] };

// Provedores de que uma variavel pode derivar (lista possivelmente vazia = proveniencia conhecida e sem contribuicao); null = nao derivada de dispositivo.
export function providersForVariable(variableId: string, provenance: ProviderProvenance = EMPTY_PROVENANCE): string[] | null {
  if (isDeviceDerivedVariable(variableId)) return [...new Set(provenance.activity)].sort();
  const kinds = LOAD_VARIABLE_DERIVATION[variableId];
  if (!kinds) return null;
  return [...new Set([...(kinds.includes('extra') ? provenance.extra : []), ...(kinds.includes('prescribed_copy') ? provenance.prescribedCopy : [])])].sort();
}

// Provedores a registrar no pacote: uniao dos provedores das variaveis derivadas de dispositivo COM dados (n > 0) presentes no prompt.
export function sourceProvidersOf(input: MethodologyInput, provenance: ProviderProvenance): string[] {
  const variables = input.athleteStateContext?.variables ?? {};
  const providers = new Set<string>();
  for (const [id, variable] of Object.entries(variables)) {
    if ((variable.evidence?.n ?? 0) <= 0) continue;
    (providersForVariable(id, provenance) ?? []).forEach((provider) => providers.add(provider));
  }
  return [...providers].sort();
}

export interface SessionForLoadProvenance {
  origin: string | null;
  structure: unknown;
  completion: Record<string, unknown> | null;
  // vinculos ATIVOS com atividade do relogio
  links: Array<{ activity: { provider: string; startedAt: Date; distanceMeters: number | null; durationSec: number | null; avgHeartRateBpm: number | null; maxHeartRateBpm: number | null } }>;
}

// Classifica, deterministicamente (sem formula de treino), quais provedores contribuem para os agregados de carga da janela.
// `copiesOf` e' a MESMA comparacao tolerante usada na exclusao viva (classifyMaterializedCompletion): devolve as colunas do registro que ainda
// sao copia da atividade. `providerOfActivityId` resolve o provedor da atividade que originou uma sessao device_extra.
export function classifyLoadProvenance(
  sessions: SessionForLoadProvenance[],
  copiesOf: (completion: Record<string, unknown>, activity: SessionForLoadProvenance['links'][number]['activity']) => string[],
  providerOfActivityId: (activityLogId: string) => string | null,
): { extra: string[]; prescribedCopy: string[] } {
  const extra = new Set<string>();
  const prescribedCopy = new Set<string>();
  for (const session of sessions) {
    if (session.origin === 'device_extra') {
      const structure = (session.structure ?? {}) as { activityLogId?: string; provider?: string };
      // Sessao sintetica do relogio: sempre derivada. Provedor desconhecido => marcador '?' (nunca casa com um provedor real, mas mantem o agregado ligado a dispositivo).
      extra.add((structure.activityLogId ? providerOfActivityId(structure.activityLogId) : null) ?? (typeof structure.provider === 'string' ? structure.provider : '?'));
      continue;
    }
    if (!session.completion) continue;
    for (const link of session.links) {
      if (copiesOf(session.completion, link.activity).length > 0) prescribedCopy.add(link.activity.provider);
    }
  }
  return { extra: [...extra].sort(), prescribedCopy: [...prescribedCopy].sort() };
}

// O pacote pode conter dados do provedor? Proveniencia desconhecida (null) => sim, por seguranca. Proveniencia conhecida => so' se o provedor consta
// nela OU algum item do indice de evidencias o cita (diretamente ou como origem de um agregado).
export function packageMayContainProvider(sourceProviders: unknown, provider: string, evidence?: unknown): boolean {
  if (!Array.isArray(sourceProviders)) return true;
  if (sourceProviders.includes(provider) || sourceProviders.includes('?')) return true;
  return Array.isArray(evidence) && (evidence as EvidenceItem[]).some((entry) => entry?.provider === provider || (Array.isArray(entry?.providers) && (entry.providers.includes(provider) || entry.providers.includes('?'))));
}

// Remove valores e referencias dos itens de evidencia derivados de atividades do provedor (so' em exclusao explicita pelo aluno;
// desconectar NAO chama isto): itens diretos (provider === X) e itens AGREGADOS cuja proveniencia inclui X (providers).
// `assumeAll`: proveniencia do pacote desconhecida (anterior ao campo) => todo item de variavel derivavel de dispositivo e' redigido.
export function redactEvidenceForProvider(evidence: unknown, provider: string, options: { assumeAll?: boolean } = {}): { evidence: EvidenceItem[]; redacted: number } {
  const list = Array.isArray(evidence) ? (evidence as EvidenceItem[]) : [];
  let redacted = 0;
  const next = list.map((entry) => {
    if (!entry || entry.redacted) return entry;
    const derivesFromProvider = entry.provider === provider
      || (Array.isArray(entry.providers) && (entry.providers.includes(provider) || entry.providers.includes('?')))
      // item de variavel derivavel de dispositivo SEM lista de provedores (anterior a este campo): proveniencia desconhecida => conservador
      || ((entry.providers === undefined || options.assumeAll === true) && typeof entry.ref === 'string' && entry.ref.startsWith('variable:') && isProviderDerivedVariable(entry.ref.slice('variable:'.length)));
    if (!derivesFromProvider) return entry;
    redacted++;
    // Marcador auditavel: continua existindo UM item no lugar, dizendo o que foi removido, de onde e por que — sem valor, sem data, sem referencia.
    return { ...entry, ref: `redacted:${provider}`, sourceId: null, asOf: null, excerpt: null, providers: undefined, label: `Evidencia removida (dados do provedor ${provider} excluidos a pedido do aluno)`, storage: 'reference_only' as const, storageNote: 'Removida por exclusao explicita de dados do provedor.', redacted: true };
  });
  return { evidence: next, redacted };
}

export interface AgentInputRedaction {
  provider: string;
  at: string;
  reason: 'provider_data_deleted';
  // So' metadados: quais variaveis e em quantas chamadas — nunca o conteudo removido.
  removedVariableIds: string[];
  callsChanged: number;
  callsUnparseableRemoved: number;
}

// Remove, do texto EXATO guardado em agentInput, os agregados derivados de atividade de dispositivo (variaveis "activity_objective" do
// athleteStateContext, com legenda e referencias de dominio). Todo o resto do prompt (relatos, diretrizes, entrevista, historico, outros
// agregados) permanece. Um prompt que nao e' JSON valido nao pode ser editado com seguranca: o texto daquela chamada e' removido por
// inteiro (marcado). Os hashes originais ficam (impressao digital de conteudo que nao existe mais) e o hash do texto resultante e' gravado.
// `variableIds`: ids a remover (derivados do indice do pacote); null = proveniencia desconhecida => todas as variaveis derivaveis de dispositivo.
export function redactAgentInputForProvider(agentInput: unknown, provider: string, now: Date = new Date(), variableIds: Set<string> | null = null): { agentInput: unknown; redaction: AgentInputRedaction | null } {
  const calls = (agentInput as { calls?: Array<Record<string, unknown>> } | null)?.calls;
  if (!Array.isArray(calls)) return { agentInput, redaction: null };
  const removedIds = new Set<string>();
  let callsChanged = 0;
  let callsUnparseableRemoved = 0;
  const nextCalls = calls.map((call) => {
    // Uma chamada ja redigida por OUTRO provedor continua editavel (exclusoes sucessivas); so' o texto removido por inteiro nao tem o que editar.
    if (call.userPromptRedacted === 'removed_unparseable' || typeof call.userPrompt !== 'string') return call;
    let parsed: unknown;
    try { parsed = JSON.parse(call.userPrompt); } catch {
      callsUnparseableRemoved++;
      return { ...call, userPrompt: null, userPromptRedacted: 'removed_unparseable' };
    }
    const removed = stripDeviceAggregates(parsed, variableIds);
    if (removed.length === 0) return call;
    removed.forEach((id) => removedIds.add(id));
    callsChanged++;
    const text = JSON.stringify(parsed);
    return { ...call, userPrompt: text, userPromptRedacted: true, userPromptSha256AfterRedaction: sha256(text) };
  });
  if (callsChanged === 0 && callsUnparseableRemoved === 0) return { agentInput, redaction: null };
  return {
    agentInput: { ...(agentInput as object), calls: nextCalls },
    redaction: { provider, at: now.toISOString(), reason: 'provider_data_deleted', removedVariableIds: [...removedIds].sort(), callsChanged, callsUnparseableRemoved },
  };
}

// Percorre o JSON do prompt e, em cada athleteStateContext, remove as variaveis derivadas de dispositivo. Devolve os ids removidos (muta o objeto).
function stripDeviceAggregates(node: unknown, only: Set<string> | null): string[] {
  const removed: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const state = record.athleteStateContext as Record<string, unknown> | null | undefined;
    if (state && typeof state === 'object') {
      const variables = state.variables as Record<string, unknown> | undefined;
      const ids = variables && typeof variables === 'object' ? Object.keys(variables).filter((id) => isProviderDerivedVariable(id) && (only === null || only.has(id))) : [];
      if (ids.length > 0) {
        for (const id of ids) {
          delete (variables as Record<string, unknown>)[id];
          const legend = state.variableLegend as Record<string, unknown> | undefined;
          if (legend && typeof legend === 'object') delete legend[id];
          removed.push(id);
        }
        const idSet = new Set(ids);
        const dropRefs = (container: unknown) => {
          if (!container || typeof container !== 'object') return;
          for (const [key, child] of Object.entries(container as Record<string, unknown>)) {
            if ((key === 'variableIds' || key === 'variablesWithComparabilityWarning') && Array.isArray(child)) (container as Record<string, unknown>)[key] = child.filter((entry) => !idSet.has(String(entry)));
            else if (child && typeof child === 'object') dropRefs(child);
          }
        };
        dropRefs(state);
      }
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(node);
  return removed;
}

// ── Decisoes deterministicas ─────────────────────────────────────────────────────────────────────────────────────

export interface SessionForTrace {
  id: string;
  weekday: number;
  modality: string;
  title?: string | null;
  notes?: string | null;
  sessionType: string | null;
  durationMin: number | null;
  distanceKm: number | null;
  paceMinSec: string | null;
  structure: unknown;
}

// JSON canonico (chaves ordenadas): o jsonb do Postgres reordena chaves, entao o hash de uma versao precisa independer da ordem.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// ESTADO COMPLETO da sessao prescrita (a estrutura da prescricao, nao um resumo). Cada decisao guarda o seu; nada e' sobrescrito.
export function snapshotOfSession(session: Omit<SessionForTrace, 'id'>): { snapshot: Record<string, unknown>; sha256: string } {
  const snapshot = {
    weekday: session.weekday, modality: session.modality, title: session.title ?? null, notes: session.notes ?? null, sessionType: session.sessionType,
    durationMin: session.durationMin, distanceKm: session.distanceKm, paceMinSec: session.paceMinSec, structure: session.structure ?? null,
  };
  return { snapshot, sha256: sha256(canonicalJson(JSON.parse(JSON.stringify(snapshot)))) };
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
  sessionSnapshot: Record<string, unknown> | null;
  sessionSnapshotSha256: string | null;
}

export function buildSessionDecisions(params: {
  sessions: SessionForTrace[];
  // Sessoes da semana ANTERIOR (historico), para apontar o que existia no mesmo dia/modalidade.
  previousWeek: { startDate: Date; sessions: Array<SessionForTrace> } | null;
}): DecisionDraft[] {
  return params.sessions.map((session) => {
    const previous = params.previousWeek?.sessions.find((candidate) => candidate.weekday === session.weekday && candidate.modality === session.modality) ?? null;
    const { snapshot, sha256: snapshotSha } = snapshotOfSession(session);
    return {
      sessionSnapshot: snapshot,
      sessionSnapshotSha256: snapshotSha,
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
    sessionSnapshot: null,
    sessionSnapshotSha256: null,
    // Justificativa em texto livre devolvida pela IA (DECLARADA; nao e prova de influencia — ver 1.2b).
    rationale: { recommendation: params.recommendation, rationale: params.rationale, safetyAdjustment: params.safetyAdjustment, routineMismatch: params.routineMismatch ?? null },
  };
}

// ── Versoes de uma sessao prescrita ──────────────────────────────────────────────────────────────────────────────

export interface VersionDecisionInput {
  decisionId: string;
  packageId: string;
  packageKind: string;
  createdAt: Date;
  summary: string;
  sessionSnapshot: unknown;
  sessionSnapshotSha256: string | null;
  changeFromPrevious: unknown;
}

export interface SessionExecutionForTrace {
  sessionCreatedAt: Date | null;
  // WorkoutCompletion nao tem instante de criacao confiavel (completedAt e' escolhido pelo aluno/dispositivo). A atribuicao do registro do aluno
  // usa o INVARIANTE de ciclo de vida: sessao com registro nao pode ser regenerada (checado na mesma transacao, com a linha da sessao travada).
  // Logo o registro e' posterior a ultima regeneracao e pertence a ULTIMA versao.
  completion: { status: string; [key: string]: unknown } | null;
  // Edicoes manuais do treinador DEPOIS do registro (TrainingSession.prescriptionHistory): a prescricao vista pelo aluno pode ter mudado sem trilha.
  coachEditsAfterRegistration: number;
  objectiveActivities: Array<{ startedAt: Date; [key: string]: unknown }>;
}

export type VersionOutcomeStatus = 'executed' | 'missed' | 'objective_only' | 'no_record';

export interface SessionVersion {
  version: number;
  // false = versao anterior ao primeiro registro de trilha da sessao, reconstruida a partir do estado preservado na regeneracao.
  traced: boolean;
  decisionId: string | null;
  packageId: string | null;
  packageKind: string | null;
  summary: string | null;
  snapshot: unknown;
  snapshotSha256: string | null;
  validFrom: string | null;
  validUntil: string | null;
  supersededBy: string | null;
  // true quando a sessao foi alterada fora de uma regeneracao registrada entre a versao anterior e esta (edicao manual, por exemplo).
  untracedChangeBefore: boolean | null;
  outcome: {
    status: VersionOutcomeStatus;
    // Criterio de atribuicao, explicito: o registro do aluno pertence a ULTIMA versao (invariante: sessao registrada nao e' regenerada); a atividade
    // objetiva, a versao vigente quando COMECOU.
    completion: SessionExecutionForTrace['completion'];
    completionAttribution: 'recorded_after_last_regeneration' | null;
    coachEditsAfterRegistration: number;
    objectiveActivities: SessionExecutionForTrace['objectiveActivities'];
    objectiveAttribution: 'activity_started_during_validity';
  };
}

const withinWindow = (at: Date, from: Date | null, until: Date | null) => (from === null || at.getTime() >= from.getTime()) && (until === null || at.getTime() < until.getTime());

// Monta as versoes de UMA sessao (decisoes em ordem cronologica) e atribui a cada uma SO' o resultado ocorrido na sua vigencia.
// Nada e' atribuido retroativamente: um resultado fora de todas as vigencias fica em outsideVersions.
export function buildSessionVersions(decisions: VersionDecisionInput[], execution: SessionExecutionForTrace): { versions: SessionVersion[]; outsideVersions: { completion: SessionExecutionForTrace['completion']; objectiveActivities: SessionExecutionForTrace['objectiveActivities'] } } {
  const ordered = [...decisions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.decisionId.localeCompare(b.decisionId));
  type Draft = Omit<SessionVersion, 'outcome' | 'version'> & { from: Date | null; until: Date | null };
  const drafts: Draft[] = [];

  const first = ordered[0];
  const firstChange = first?.changeFromPrevious as { previousSnapshot?: unknown; previousSnapshotSha256?: string; previousVersionTraced?: boolean } | null | undefined;
  if (first && first.packageKind === 'day_regeneration' && firstChange?.previousVersionTraced === false && firstChange.previousSnapshot) {
    drafts.push({
      traced: false, decisionId: null, packageId: null, packageKind: null, summary: null, snapshot: firstChange.previousSnapshot, snapshotSha256: firstChange.previousSnapshotSha256 ?? null,
      validFrom: execution.sessionCreatedAt ? execution.sessionCreatedAt.toISOString() : null, validUntil: first.createdAt.toISOString(), supersededBy: first.decisionId, untracedChangeBefore: null,
      from: execution.sessionCreatedAt, until: first.createdAt,
    });
  }
  ordered.forEach((decision, index) => {
    const next = ordered[index + 1];
    const change = decision.changeFromPrevious as { untracedChangeSincePreviousVersion?: boolean | null } | null;
    drafts.push({
      traced: true, decisionId: decision.decisionId, packageId: decision.packageId, packageKind: decision.packageKind, summary: decision.summary, snapshot: decision.sessionSnapshot, snapshotSha256: decision.sessionSnapshotSha256,
      validFrom: decision.createdAt.toISOString(), validUntil: next ? next.createdAt.toISOString() : null, supersededBy: next ? next.decisionId : null,
      untracedChangeBefore: change?.untracedChangeSincePreviousVersion ?? null, from: decision.createdAt, until: next ? next.createdAt : null,
    });
  });

  const claimedActivities = new Set<unknown>();
  let completionClaimed = false;
  const versions: SessionVersion[] = drafts.map((draft, index) => {
    const { from, until, ...rest } = draft;
    const completion = execution.completion && index === drafts.length - 1 ? execution.completion : null;
    if (completion) completionClaimed = true;
    const activities = execution.objectiveActivities.filter((activity) => withinWindow(activity.startedAt, from, until));
    activities.forEach((activity) => claimedActivities.add(activity));
    const status: VersionOutcomeStatus = completion ? (completion.status === 'missed' ? 'missed' : 'executed') : activities.length > 0 ? 'objective_only' : 'no_record';
    return {
      version: index + 1, ...rest,
      outcome: { status, completion, completionAttribution: completion ? 'recorded_after_last_regeneration' : null, coachEditsAfterRegistration: completion ? execution.coachEditsAfterRegistration : 0, objectiveActivities: activities, objectiveAttribution: 'activity_started_during_validity' },
    };
  });
  return {
    versions,
    outsideVersions: {
      completion: execution.completion && !completionClaimed ? execution.completion : null,
      objectiveActivities: execution.objectiveActivities.filter((activity) => !claimedActivities.has(activity)),
    },
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
