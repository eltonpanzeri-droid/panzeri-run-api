import type { RunExecutionAnalysis, RunSignature, SessionAnalysis } from '../activity-execution/execution-analysis';
import type { WeeklyExecutionIndicators } from '../activity-execution/execution-report';

// ANALISTA DE TREINOS (Etapa 2.2) — camada DETERMINISTICA que transforma os indicadores da Etapa 2.1, o historico (janelas 21/60/200 do motor
// matematico) e os relatos do aluno em achados estruturados e reutilizaveis. Nao prescreve, nao escolhe progressao, nao altera planejamento e NAO chama IA:
// todos os numeros vem do backend; cada frase e' montada a partir de um codigo + dados (nunca texto livre gerado).
//
// Quatro naturezas de informacao, sempre separadas no contrato: FATOS MEDIDOS (relogio/prescricao), RELATADO pelo aluno, INTERPRETACAO tecnica (regras
// explicitas, com grau de sustentacao e horizonte) e LACUNAS (dados ausentes/incertezas). Interpretacao nao e' prova e nao atribui intencao ao aluno.

export const ANALYST_VERSION = 1;

export type FindingSource = 'measured' | 'reported' | 'technical' | 'gap';
export type Support = 'alta' | 'media' | 'baixa';
export type Horizon = 'pontual' | 'recente' | 'consolidado' | 'historico';
export type FindingKind = 'divergencia' | 'melhora' | 'dificuldade' | 'mudanca' | 'padrao' | 'capacidade' | 'contradicao';

export interface Finding {
  id: string;
  code: string;
  source: FindingSource;
  statement: string;
  data: Record<string, number | string | boolean | null>;
  support: Support | null;
  horizon: Horizon | null;
  // Achado relevante para preservar (Prontuario): classificacao do tipo; null para fatos/relatos/lacunas comuns.
  kind: FindingKind | null;
  // Ids de outros itens do contrato em que este se apoia.
  basis: string[];
  refs: { sessionIds?: string[]; weekStart?: string };
}

export interface Capability {
  id: string;
  kind: 'formato_recorrente' | 'melhor_marca';
  family: string;
  statement: string;
  data: Record<string, number | string | boolean | null>;
  horizon: Horizon;
  sessionIds: string[];
}

export interface VariableChange { family: string; variable: string; unit: string; from: number | string | null; to: number | string | null; deltaPct: number | null; fromSessionId: string; toSessionId: string }

export interface AnalysisContract {
  schema: 'training-analysis/1';
  analystVersion: number;
  scope: 'session' | 'week' | 'longitudinal';
  period: { start: string; end: string };
  asOf: string;
  facts: Finding[];
  reported: Finding[];
  findings: Finding[];
  gaps: Finding[];
  capabilities: Capability[];
  changes: VariableChange[];
  // Numeros-resumo da semana (so' no escopo semanal): permitem comparar semanas entre si sem reler os treinos.
  summary?: WeekSummaryData;
  evidence: { sessionIds: string[]; activityLogIds: string[]; providers: string[]; windowsDays: number[]; limitations: string[]; madeWithoutAI: true };
}

export interface AnalysisRow { sessionId: string; scheduledDate: string; modality: string; isExtra: boolean; activityLogId: string | null; provider: string | null; analysis: SessionAnalysis }
export interface FeedbackInput { perceivedEffort: number | null; painFlag: string | null; executionBehavior: string | null; adjustmentReasons: string[]; hasFreeText: boolean; status: string }
export interface PrescriptionContext { structureKind: 'intervalado' | 'continuo' | null; intent: string | null; expected: string | null; traceStatus: string | null }
export interface VariableTrend { variableId: string; label: string; unit: string; current: number | null; ma21: number | null; ma60: number | null; ma200: number | null; trendRecent: string; trendMedium: string; outsideHabitualRange: boolean | null; n: number }

// ── utilitarios ─────────────────────────────────────────────────────────────────────────────────────────────────

const pace = (sec: number | null | undefined) => (sec == null ? '?' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`);
const km = (v: number | null | undefined) => (v == null ? '?' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
const num = (v: number | null | undefined, places = 1) => (v == null ? '?' : v.toLocaleString('pt-BR', { maximumFractionDigits: places }));
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); const n = s.length; return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const pctDelta = (from: number | null, to: number | null) => (from != null && to != null && from !== 0 ? Math.round(((to - from) / Math.abs(from)) * 1000) / 10 : null);

function finding(partial: Pick<Finding, 'id' | 'code' | 'source' | 'statement'> & Partial<Finding>): Finding {
  return { data: {}, support: null, horizon: null, kind: null, basis: [], refs: {}, ...partial };
}

function emptyContract(scope: AnalysisContract['scope'], period: { start: string; end: string }, asOf: string, rows: AnalysisRow[], windows: number[] = []): AnalysisContract {
  return {
    schema: 'training-analysis/1', analystVersion: ANALYST_VERSION, scope, period, asOf, facts: [], reported: [], findings: [], gaps: [], capabilities: [], changes: [],
    evidence: {
      sessionIds: rows.map((r) => r.sessionId), activityLogIds: [...new Set(rows.map((r) => r.activityLogId).filter((v): v is string => !!v))],
      providers: [...new Set(rows.map((r) => r.provider).filter((v): v is string => !!v))].sort(), windowsDays: windows, limitations: [], madeWithoutAI: true,
    },
  };
}

const runOf = (row: AnalysisRow): RunExecutionAnalysis | null => (row.analysis.kind === 'run' ? row.analysis : null);

// Estimulo que EFETIVAMENTE ocorreu (nao o prescrito): usado para comparar semelhantes.
export function stimulusClass(run: RunExecutionAnalysis): 'intervalado' | 'continuo_com_aceleracao_final' | 'continuo' | null {
  if (run.dataLevel !== 'series') return null;
  const s = run.signature;
  if (s && s.boutCount >= 2 && s.recovery.count >= 1) return 'intervalado';
  if (run.structure.executed === 'continuo_com_aceleracao_final') return 'continuo_com_aceleracao_final';
  return 'continuo';
}

const STIMULUS_LABEL = { intervalado: 'intervalado', continuo_com_aceleracao_final: 'contínuo com aceleração final', continuo: 'contínuo' } as const;

function describeSignature(s: RunSignature): string {
  const parts = [`${s.boutCount} esforços de ~${km(s.boutDistanceKm?.median)} km a ${pace(s.boutPaceSecondsKm?.median)}/km (faixa ${pace(s.boutPaceSecondsKm?.best)}–${pace(s.boutPaceSecondsKm?.worst)})`];
  if (s.recovery.count > 0) parts.push(`recuperação mediana de ${num(s.recovery.medianSec, 0)} s (${s.recovery.mode ?? '?'})`);
  parts.push(`volume rápido de ${km(s.fastVolumeKm)} km`);
  return parts.join('; ');
}

// ── análise individual ──────────────────────────────────────────────────────────────────────────────────────────

export interface IndividualInput {
  row: AnalysisRow;
  prescription: PrescriptionContext | null;
  feedback: FeedbackInput | null;
  // Sessões anteriores (qualquer origem) dentro da janela de 200 dias, já excluindo a própria.
  history: AnalysisRow[];
}

export function analyzeSessionInContext(input: IndividualInput): AnalysisContract {
  const { row, prescription, feedback, history } = input;
  const c = emptyContract('session', { start: row.scheduledDate, end: row.scheduledDate }, row.scheduledDate, [row], [21, 60, 200]);
  const refs = { sessionIds: [row.sessionId] };
  const a = row.analysis;

  // RELATADO (sempre separado do medido)
  if (feedback) {
    if (feedback.perceivedEffort != null) c.reported.push(finding({ id: `${row.sessionId}:rpe`, code: 'esforco_percebido', source: 'reported', statement: `Esforço percebido informado: ${feedback.perceivedEffort}/10.`, data: { perceivedEffort: feedback.perceivedEffort }, refs }));
    if (feedback.executionBehavior) c.reported.push(finding({ id: `${row.sessionId}:behavior`, code: 'comportamento_declarado', source: 'reported', statement: `O aluno declarou, sobre a execução: ${feedback.executionBehavior}.`, data: { executionBehavior: feedback.executionBehavior }, refs }));
    if (feedback.adjustmentReasons.length > 0) c.reported.push(finding({ id: `${row.sessionId}:adjust`, code: 'motivos_de_ajuste_declarados', source: 'reported', statement: `Motivos de ajuste declarados: ${feedback.adjustmentReasons.join(', ')}.`, data: { reasons: feedback.adjustmentReasons.join(', ') }, refs }));
    if (feedback.painFlag && feedback.painFlag !== 'none') c.reported.push(finding({ id: `${row.sessionId}:pain`, code: 'dor_relatada', source: 'reported', statement: `Dor relatada neste treino: ${feedback.painFlag}.`, data: { painFlag: feedback.painFlag }, refs }));
    if (feedback.hasFreeText) c.reported.push(finding({ id: `${row.sessionId}:text`, code: 'texto_livre_registrado', source: 'reported', statement: 'O aluno deixou um relato em texto livre (interpretado pelo Relator e entregue ao Prescritor por outro canal).', refs }));
  }
  if (prescription?.intent || prescription?.expected) {
    c.facts.push(finding({ id: `${row.sessionId}:intent`, code: 'intencao_prescrita', source: 'measured', statement: `Intenção declarada na prescrição: ${prescription.intent ?? '—'}; resultado esperado: ${prescription.expected ?? '—'}.`, data: { intent: prescription.intent, expected: prescription.expected }, refs }));
  } else if (a.kind !== 'not_done' && !row.isExtra) {
    c.gaps.push(finding({ id: `${row.sessionId}:no-intent`, code: 'intencao_da_prescricao_indisponivel', source: 'gap', statement: 'Esta sessão não tem objetivo/resultado esperado registrados pela prescrição (anterior ao registro ou não declarado).', refs }));
  }

  if (a.kind === 'not_done') {
    c.facts.push(finding({ id: `${row.sessionId}:not_done`, code: 'sessao_nao_realizada', source: 'measured', statement: a.reason === 'marcada_como_nao_feita' ? 'Sessão marcada pelo aluno como não realizada.' : 'Sessão sem registro de execução.', refs }));
    return c;
  }
  if (a.kind === 'strength') return strengthIndividual(c, row, a, feedback, history, refs);
  const run = a;

  // MEDIDO
  if (run.totals.realizedKm != null) c.facts.push(finding({ id: `${row.sessionId}:volume`, code: 'volume', source: 'measured', statement: run.totals.prescribedKm != null ? `Percorreu ${km(run.totals.realizedKm)} dos ${km(run.totals.prescribedKm)} km previstos.` : `Percorreu ${km(run.totals.realizedKm)} km (sem prescrição correspondente).`, data: { realizedKm: run.totals.realizedKm, prescribedKm: run.totals.prescribedKm, ratio: run.totals.completionRatio }, refs }));
  if (run.dataLevel !== 'series') {
    c.gaps.push(finding({ id: `${row.sessionId}:no-series`, code: 'sem_serie_temporal', source: 'gap', statement: run.dataLevel === 'summary_only' ? 'O relógio enviou só o resumo: estrutura e distribuição por faixa não puderam ser analisadas.' : 'Sem dados do relógio: só o registro manual está disponível.', refs }));
    return c;
  }
  if (run.structure.reason === 'prescricao_sem_blocos_por_distancia') c.gaps.push(finding({ id: `${row.sessionId}:time-based`, code: 'prescricao_por_tempo', source: 'gap', statement: 'A prescrição é por tempo: sem alinhamento por bloco, a comparação com as faixas não é feita.', refs }));
  if (run.intensity.status !== 'indeterminado' && run.intensity.overall) c.facts.push(finding({ id: `${row.sessionId}:intensity`, code: 'intensidade_nas_faixas', source: 'measured', statement: `Intensidade: ${run.intensity.status} (dentro ${run.intensity.overall.inPct}%, mais lento ${run.intensity.overall.slowPct}%, mais rápido ${run.intensity.overall.fastPct}% do tempo observado).`, data: { status: run.intensity.status, inPct: run.intensity.overall.inPct, slowPct: run.intensity.overall.slowPct, fastPct: run.intensity.overall.fastPct, coveragePct: run.coverage?.coveragePct ?? null }, refs }));
  const stimulus = stimulusClass(run);
  const sig = run.signature;
  if (sig) c.facts.push(finding({ id: `${row.sessionId}:stimulus`, code: 'estimulo_executado', source: 'measured', statement: stimulus === 'intervalado' ? `Estímulo executado: ${describeSignature(sig)}.` : `Estímulo executado: ${stimulus ? STIMULUS_LABEL[stimulus] : 'indeterminado'}, ritmo típico de ${pace(sig.typicalPaceSecondsKm)}/km.`, data: { stimulus, boutCount: sig.boutCount, boutPaceMedian: sig.boutPaceSecondsKm?.median ?? null, boutDistanceKmMedian: sig.boutDistanceKm?.median ?? null, fastVolumeKm: sig.fastVolumeKm, recoveryMedianSec: sig.recovery.medianSec, recoveryMode: sig.recovery.mode, typicalPace: sig.typicalPaceSecondsKm }, refs }));
  if (run.totals.avgHeartRateBpm != null || run.avgHeartRateInBandBpm != null || run.totals.avgCadenceSpm != null) c.facts.push(finding({ id: `${row.sessionId}:response`, code: 'resposta_cardiovascular', source: 'measured', statement: `FC média ${num(run.totals.avgHeartRateBpm, 0)} bpm${run.avgHeartRateInBandBpm != null ? `, ${num(run.avgHeartRateInBandBpm, 0)} bpm enquanto dentro da faixa` : ''}; cadência média ${num(run.totals.avgCadenceSpm, 0)} passos/min.`, data: { avgHr: run.totals.avgHeartRateBpm, hrInBand: run.avgHeartRateInBandBpm, cadence: run.totals.avgCadenceSpm }, refs }));

  // comparáveis: mesmo estímulo EFETIVAMENTE executado, mesma natureza (prescrita x iniciativa), janela 200 d
  const comparable = history.filter((h) => { const r = runOf(h); return r && stimulusClass(r) === stimulus && h.isExtra === row.isExtra; });
  const comparable60 = comparable.filter((h) => dayDiff(h.scheduledDate, row.scheduledDate) <= 60);
  if (comparable.length < 3) c.gaps.push(finding({ id: `${row.sessionId}:thin-history`, code: 'historico_insuficiente', source: 'gap', statement: `Há ${comparable.length} sessão(ões) comparável(is) no histórico de 200 dias; menos de 3 não sustenta comparação.`, data: { comparable: comparable.length }, refs }));

  // ATIVIDADE SEM PRESCRIÇÃO CORRESPONDENTE (por iniciativa)
  if (row.isExtra) {
    c.findings.push(finding({ id: `${row.sessionId}:extra`, code: 'atividade_sem_prescricao', source: 'technical', kind: 'padrao', statement: `Atividade por iniciativa do aluno (sem sessão prescrita correspondente): ${km(run.totals.realizedKm)} km${sig ? `, ${stimulus ? STIMULUS_LABEL[stimulus] : ''}${stimulus === 'intervalado' ? ` (${describeSignature(sig)})` : ''}` : ''}.`, support: sig ? 'media' : 'baixa', horizon: 'pontual', basis: [`${row.sessionId}:volume`], refs }));
    return c;
  }

  // DIVERGÊNCIA DE ESTRUTURA (prescrito x executado), sem presumir motivo
  const sc = run.structure.scenario;
  if (run.structure.prescribed === 'intervalado' && sc && ['B', 'C', 'D'].includes(sc)) {
    const lastIntervalWithBouts = [...history].reverse().find((h) => { const r = runOf(h); return r && stimulusClass(r) === 'intervalado'; });
    const sameBefore = comparable.length;
    const parts = [`A prescrição previa ${run.structure.evidence?.repsPrescribed ?? '?'} alternâncias; o que o relógio registra é treino ${stimulus ? STIMULUS_LABEL[stimulus] : run.structure.executed}${sig && stimulus !== 'intervalado' ? ` a ${pace(sig.typicalPaceSecondsKm)}/km` : ''}.`];
    if (sameBefore > 0) parts.push(`Esse tipo de estímulo ocorreu ${sameBefore} vez(es) no histórico de 200 dias.`);
    if (lastIntervalWithBouts) parts.push(`A última sessão com esforços intervalados reconhecidos foi há ${dayDiff(lastIntervalWithBouts.scheduledDate, row.scheduledDate)} dias.`);
    const explained = feedback?.executionBehavior && feedback.executionBehavior !== 'as_planned';
    c.findings.push(finding({ id: `${row.sessionId}:structure-differs`, code: 'estrutura_executada_difere_da_prescrita', source: 'technical', kind: 'divergencia', statement: parts.join(' '), data: { scenario: sc, executed: run.structure.executed }, support: run.structure.confidence === 'alta' ? 'alta' : 'media', horizon: 'pontual', basis: [`${row.sessionId}:stimulus`], refs }));
    if (!explained && !(feedback?.adjustmentReasons.length)) c.gaps.push(finding({ id: `${row.sessionId}:why-unknown`, code: 'motivo_da_diferenca_nao_informado', source: 'gap', statement: 'O aluno não informou por que a execução diferiu da prescrição; o relógio mostra o que aconteceu, não o motivo.', refs }));
    else c.findings.push(finding({ id: `${row.sessionId}:why-reported`, code: 'diferenca_com_declaracao_do_aluno', source: 'technical', kind: 'divergencia', statement: `O aluno declarou ${feedback?.executionBehavior ?? 'ajustes'}${feedback?.adjustmentReasons.length ? ` (motivos: ${feedback.adjustmentReasons.join(', ')})` : ''}; é uma informação relatada, não confirmada pelos dados.`, support: 'baixa', horizon: 'pontual', basis: [`${row.sessionId}:behavior`], refs }));
  }

  // INTENSIDADE fora da faixa + recorrência
  const status = run.intensity.status;
  if (status === 'mais_rapido' || status === 'mais_lento') {
    const same = comparable60.filter((h) => runOf(h)?.intensity.status === status).length;
    const horizon: Horizon = same >= 3 ? 'consolidado' : same >= 1 ? 'recente' : 'pontual';
    c.findings.push(finding({ id: `${row.sessionId}:intensity-off`, code: status === 'mais_rapido' ? 'intensidade_acima_da_faixa' : 'intensidade_abaixo_da_faixa', source: 'technical', kind: 'divergencia', statement: `${status === 'mais_rapido' ? 'Acima' : 'Abaixo'} das faixas prescritas em ${status === 'mais_rapido' ? run.intensity.overall?.fastPct : run.intensity.overall?.slowPct}% do tempo observado; o mesmo ocorreu em ${same} de ${comparable60.length} sessões comparáveis dos últimos 60 dias.`, data: { recurrence: same, comparable60: comparable60.length }, support: comparable60.length >= 3 ? 'media' : 'baixa', horizon, basis: [`${row.sessionId}:intensity`], refs }));
  }
  // VOLUME abaixo do prescrito
  if (run.totals.completionRatio != null && run.totals.completionRatio < 0.9 && feedback?.status !== 'missed') {
    const stoppedEarly = feedback?.executionBehavior === 'stopped_early';
    c.findings.push(finding({ id: `${row.sessionId}:volume-low`, code: 'volume_abaixo_do_prescrito', source: 'technical', kind: 'dificuldade', statement: `Volume ${Math.round((run.totals.completionRatio as number) * 100)}% do prescrito${stoppedEarly ? '; o aluno declarou ter interrompido antes' : ''}.`, data: { ratio: run.totals.completionRatio, declaredStoppedEarly: stoppedEarly }, support: 'media', horizon: 'pontual', basis: [`${row.sessionId}:volume`], refs }));
  }
  // RESPOSTA em condições comparáveis (mesma faixa de ritmo ±4%), nunca prova de adaptação
  if (run.avgHeartRateInBandBpm != null) {
    const band = bandMid(run);
    const priors = band == null ? [] : history.map((h) => runOf(h)).filter((r): r is RunExecutionAnalysis => !!r && r.avgHeartRateInBandBpm != null && bandMid(r) != null && band != null && Math.abs((bandMid(r) as number) - band) / band <= 0.04);
    if (priors.length >= 3) {
      const base = median(priors.map((r) => r.avgHeartRateInBandBpm as number)) as number;
      const delta = run.avgHeartRateInBandBpm - base;
      if (Math.abs(delta) >= 4) c.findings.push(finding({ id: `${row.sessionId}:hr-shift`, code: 'fc_em_ritmo_comparavel_mudou', source: 'technical', kind: delta < 0 ? 'melhora' : 'mudanca', statement: `FC dentro da faixa de ~${pace(band)}/km: ${num(run.avgHeartRateInBandBpm, 0)} bpm, ${Math.abs(Math.round(delta))} bpm ${delta < 0 ? 'abaixo' : 'acima'} da mediana de ${priors.length} sessões comparáveis (${num(base, 0)} bpm). É um achado, não prova isolada de adaptação.`, data: { hr: run.avgHeartRateInBandBpm, baseline: Math.round(base), n: priors.length, band: Math.round(band as number) }, support: priors.length >= 6 ? 'media' : 'baixa', horizon: 'recente', basis: [`${row.sessionId}:response`], refs }));
    } else c.gaps.push(finding({ id: `${row.sessionId}:hr-thin`, code: 'historico_comparavel_insuficiente_para_fc', source: 'gap', statement: `Só ${priors.length} sessão(ões) em ritmo comparável: a FC não é comparada.`, refs }));
  }
  // CONTRADIÇÕES entre fontes
  if (feedback?.perceivedEffort != null && feedback.perceivedEffort <= 3 && status === 'mais_rapido') c.findings.push(finding({ id: `${row.sessionId}:contra-rpe`, code: 'informacoes_contraditorias', source: 'technical', kind: 'contradicao', statement: `Esforço percebido baixo (${feedback.perceivedEffort}/10) com grande parte do tempo acima das faixas: as fontes divergem; nenhuma foi descartada.`, support: 'baixa', horizon: 'pontual', basis: [`${row.sessionId}:rpe`, `${row.sessionId}:intensity`], refs }));
  if (feedback?.status === 'missed') c.findings.push(finding({ id: `${row.sessionId}:contra-missed`, code: 'informacoes_contraditorias', source: 'technical', kind: 'contradicao', statement: 'Sessão marcada como não realizada, mas há atividade do relógio associada; prevalece o registro do aluno e a divergência fica sinalizada.', support: 'baixa', horizon: 'pontual', refs }));
  if (feedback && feedback.status === 'done' && run.totals.completionRatio != null && run.totals.completionRatio < 0.5) c.findings.push(finding({ id: `${row.sessionId}:contra-done`, code: 'informacoes_contraditorias', source: 'technical', kind: 'contradicao', statement: `Sessão registrada como realizada, mas o relógio mostra ${Math.round((run.totals.completionRatio as number) * 100)}% do volume prescrito.`, support: 'baixa', horizon: 'pontual', refs }));
  return c;
}

function bandMid(run: RunExecutionAnalysis): number | null {
  const bands = (run.blocks ?? []).filter((b) => b.paceFastSecondsKm != null && b.paceSlowSecondsKm != null && b.timeInBand && b.timeInBand.classifiedSec > 0 && (b.role === 'estimulo' || run.structure.prescribed === 'continuo'));
  if (bands.length === 0) return null;
  return median(bands.map((b) => ((b.paceFastSecondsKm as number) + (b.paceSlowSecondsKm as number)) / 2));
}

function strengthIndividual(c: AnalysisContract, row: AnalysisRow, a: Extract<SessionAnalysis, { kind: 'strength' }>, feedback: FeedbackInput | null, history: AnalysisRow[], refs: { sessionIds: string[] }): AnalysisContract {
  if (a.realizedDurationMin != null) c.facts.push(finding({ id: `${row.sessionId}:duration`, code: 'duracao', source: 'measured', statement: `Duração registrada ${num(a.realizedDurationMin, 0)} min${a.prescribedDurationMin != null ? ` (prevista ${num(a.prescribedDurationMin, 0)} min; ${a.durationClass})` : ''}.`, data: { realized: a.realizedDurationMin, prescribed: a.prescribedDurationMin, ratio: a.durationRatio, durationClass: a.durationClass }, refs }));
  if (a.avgHeartRateBpm != null || a.caloriesKcal != null) c.facts.push(finding({ id: `${row.sessionId}:device`, code: 'registro_do_relogio', source: 'measured', statement: `Relógio: FC média ${num(a.avgHeartRateBpm, 0)} bpm; gasto estimado ${num(a.caloriesKcal, 0)} kcal.`, data: { avgHr: a.avgHeartRateBpm, kcal: a.caloriesKcal }, refs }));
  c.gaps.push(finding({ id: `${row.sessionId}:strength-limit`, code: 'series_repeticoes_nao_inferidas', source: 'gap', statement: 'Séries, repetições e exercícios realizados não são inferidos pela duração nem pela FC.', refs }));
  const priorRpe = history.map((h) => (h.analysis.kind === 'strength' ? h.analysis.perceivedEffort : null)).filter((v): v is number => v != null);
  if (a.perceivedEffort != null && priorRpe.length >= 3) {
    const base = median(priorRpe) as number;
    if (Math.abs(a.perceivedEffort - base) >= 2) c.findings.push(finding({ id: `${row.sessionId}:rpe-shift`, code: 'esforco_percebido_fora_do_habitual', source: 'technical', kind: 'mudanca', statement: `Esforço percebido ${a.perceivedEffort}/10 contra mediana de ${num(base, 1)} em ${priorRpe.length} sessões de força anteriores.`, support: priorRpe.length >= 6 ? 'media' : 'baixa', horizon: 'pontual', basis: [`${row.sessionId}:rpe`], data: { rpe: a.perceivedEffort, baseline: base, n: priorRpe.length }, refs }));
  } else if (a.perceivedEffort != null) c.gaps.push(finding({ id: `${row.sessionId}:rpe-thin`, code: 'historico_insuficiente', source: 'gap', statement: `${priorRpe.length} sessão(ões) de força anteriores com esforço: sem base para comparar.`, refs }));
  void feedback;
  return c;
}

// ── análise longitudinal ────────────────────────────────────────────────────────────────────────────────────────

const distClass = (distKm: number) => (distKm < 0.25 ? '<250 m' : distKm < 0.5 ? '250–500 m' : distKm < 0.8 ? '500–800 m' : distKm < 1.3 ? '~1 km' : distKm < 2.2 ? '1,3–2,2 km' : '>2,2 km');

export interface LongitudinalInput { asOf: string; rows: AnalysisRow[]; trends: VariableTrend[]; rpeBySession?: Map<string, number> }

export function analyzeLongitudinal(input: LongitudinalInput): AnalysisContract {
  const { asOf, trends } = input;
  const rows = input.rows.filter((r) => dayDiff(r.scheduledDate, asOf) <= 200 && dayDiff(r.scheduledDate, asOf) >= 0).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const start = rows[0]?.scheduledDate ?? asOf;
  const c = emptyContract('longitudinal', { start, end: asOf }, asOf, rows, [21, 60, 200]);

  // famílias de estímulo intervalado (formato = distância por esforço + contexto)
  type Fam = { family: string; sessions: Array<{ row: AnalysisRow; sig: RunSignature }> };
  const families = new Map<string, Fam>();
  for (const row of rows) {
    const run = runOf(row);
    if (!run?.signature || stimulusClass(run) !== 'intervalado' || !run.signature.boutDistanceKm) continue;
    const family = `${distClass(run.signature.boutDistanceKm.median)} · ${run.signature.sessionDistanceKm >= 18 ? 'dentro de longo' : 'sessão regular'}`;
    const fam = families.get(family) ?? { family, sessions: [] };
    fam.sessions.push({ row, sig: run.signature });
    families.set(family, fam);
  }
  for (const fam of families.values()) {
    const s = fam.sessions; const n = s.length;
    const age = (x: { row: AnalysisRow }) => dayDiff(x.row.scheduledDate, asOf);
    const horizonOf = (x: { row: AnalysisRow }): Horizon => (age(x) <= 21 ? 'recente' : age(x) <= 60 ? 'consolidado' : 'historico');
    if (n >= 3) {
      const reps = s.map((x) => x.sig.boutCount); const paces = s.map((x) => x.sig.boutPaceSecondsKm?.median as number); const rec = s.map((x) => x.sig.recovery.medianSec).filter((v): v is number => v != null);
      c.capabilities.push({
        id: `cap:fmt:${fam.family}`, kind: 'formato_recorrente', family: fam.family, horizon: n >= 5 ? 'consolidado' : 'recente', sessionIds: s.map((x) => x.row.sessionId),
        statement: `Formato recorrente (${fam.family}): ${n} sessões entre ${s[0].row.scheduledDate} e ${s[n - 1].row.scheduledDate}; ${Math.min(...reps)}–${Math.max(...reps)} esforços por sessão, pace mediano dos esforços de ${pace(Math.min(...paces))} a ${pace(Math.max(...paces))}/km${rec.length ? `, recuperação mediana ${num(median(rec), 0)} s (${s[n - 1].sig.recovery.mode ?? '?'})` : ''}.`,
        data: { sessions: n, repsMin: Math.min(...reps), repsMax: Math.max(...reps), paceBest: Math.min(...paces), paceWorst: Math.max(...paces), recoveryMedianSec: rec.length ? (median(rec) as number) : null },
      });
    }
    // melhores marcas (recente x histórica), em eixos separados
    const withReps = s.filter((x) => x.sig.boutCount >= 3);
    const best = (pick: (x: { sig: RunSignature }) => number, better: 'min' | 'max', items: typeof s) => (items.length === 0 ? null : items.reduce((a, b) => ((better === 'min' ? pick(b) < pick(a) : pick(b) > pick(a)) ? b : a)));
    for (const [axis, pick, better, unit] of [['pace_mediano_dos_esforcos', (x: { sig: RunSignature }) => x.sig.boutPaceSecondsKm?.median as number, 'min', 's/km'], ['quantidade_de_esforcos', (x: { sig: RunSignature }) => x.sig.boutCount, 'max', 'esforços'], ['volume_rapido', (x: { sig: RunSignature }) => x.sig.fastVolumeKm, 'max', 'km']] as const) {
      const recent = best(pick, better, withReps.filter((x) => age(x) <= 21)); const hist = best(pick, better, withReps.filter((x) => age(x) > 21));
      for (const [label, entry] of [['recente (21 d)', recent], ['historica', hist]] as const) {
        if (!entry) continue;
        c.capabilities.push({
          id: `cap:best:${fam.family}:${axis}:${label}`, kind: 'melhor_marca', family: fam.family, horizon: horizonOf(entry), sessionIds: [entry.row.sessionId],
          statement: `Melhor ${axis.replace(/_/g, ' ')} (${label}) em ${fam.family}: ${axis === 'pace_mediano_dos_esforcos' ? `${pace(pick(entry))}/km` : `${num(pick(entry), 1)} ${unit}`} em ${entry.row.scheduledDate} (${entry.sig.boutCount} esforços de ~${km(entry.sig.boutDistanceKm?.median)} km${entry.sig.recovery.medianSec != null ? `, recuperação ${num(entry.sig.recovery.medianSec, 0)} s ${entry.sig.recovery.mode}` : ''}).`,
          data: { axis, value: pick(entry), date: entry.row.scheduledDate, reps: entry.sig.boutCount, sessionDistanceKm: entry.sig.sessionDistanceKm },
        });
      }
    }
    // mudanças ENTRE sessões da mesma família, uma variável por vez (não intercambiáveis)
    if (n >= 2) {
      const prev = s[n - 2]; const last = s[n - 1];
      const add = (variable: string, unit: string, from: number | string | null, to: number | string | null, minRel: number) => {
        if (from == null || to == null) return;
        const delta = typeof from === 'number' && typeof to === 'number' ? pctDelta(from, to) : null;
        if (typeof from === 'number' && typeof to === 'number') { if (delta == null || Math.abs(delta) < minRel) return; } else if (from === to) return;
        c.changes.push({ family: fam.family, variable, unit, from, to, deltaPct: delta, fromSessionId: prev.row.sessionId, toSessionId: last.row.sessionId });
      };
      add('distancia_por_repeticao', 'km', prev.sig.boutDistanceKm?.median ?? null, last.sig.boutDistanceKm?.median ?? null, 10);
      add('quantidade_de_repeticoes', 'esforcos', prev.sig.boutCount, last.sig.boutCount, 15);
      add('velocidade_mediana_dos_esforcos', 's/km', prev.sig.boutPaceSecondsKm?.median ?? null, last.sig.boutPaceSecondsKm?.median ?? null, 2);
      add('volume_rapido_acumulado', 'km', prev.sig.fastVolumeKm, last.sig.fastVolumeKm, 10);
      add('duracao_da_recuperacao', 's', prev.sig.recovery.medianSec, last.sig.recovery.medianSec, 15);
      add('modo_da_recuperacao', 'modo', prev.sig.recovery.mode, last.sig.recovery.mode, 0);
      add('regularidade_do_pace', '%cv', prev.sig.regularity.paceCvPct, last.sig.regularity.paceCvPct, 25);
      add('fc_nos_esforcos', 'bpm', prev.sig.avgHeartRateInBoutsBpm, last.sig.avgHeartRateInBoutsBpm, 3);
      const rp = input.rpeBySession?.get(prev.row.sessionId); const rl = input.rpeBySession?.get(last.row.sessionId);
      add('esforco_percebido', '/10', rp ?? null, rl ?? null, 20);
    }
  }
  if (families.size === 0) c.gaps.push(finding({ id: 'long:no-intervals', code: 'sem_sessoes_com_esforcos_reconhecidos', source: 'gap', statement: 'Não há, na janela de 200 dias, sessões com esforços intervalados reconhecidos pela série; capacidades por formato não são estimadas.' }));

  // intensidade recorrentemente fora da faixa em intervalados prescritos (60 d)
  const intervalPrescribed = rows.filter((r) => { const run = runOf(r); return run && !r.isExtra && run.structure.prescribed === 'intervalado' && run.intensity.status !== 'indeterminado' && dayDiff(r.scheduledDate, asOf) <= 60; });
  const fast = intervalPrescribed.filter((r) => runOf(r)?.intensity.status === 'mais_rapido');
  if (intervalPrescribed.length >= 3 && fast.length / intervalPrescribed.length >= 0.5) {
    const half = Math.ceil(fast.length / 2);
    const vol = (list: AnalysisRow[]) => median(list.map((r) => runOf(r)?.signature?.fastVolumeKm ?? 0));
    const early = vol(fast.slice(0, half)); const late = vol(fast.slice(half));
    const rpes = fast.map((r) => input.rpeBySession?.get(r.sessionId)).filter((v): v is number => v != null);
    c.findings.push(finding({ id: 'long:fast-recurrent', code: 'intensidade_acima_da_faixa_recorrente', source: 'technical', kind: 'padrao', statement: `Em ${fast.length} de ${intervalPrescribed.length} intervalados prescritos (60 dias) o tempo ficou predominantemente acima das faixas${late != null && early != null && fast.length >= 4 ? `; o volume rápido mediano passou de ${km(early)} para ${km(late)} km` : ''}${rpes.length >= 2 ? `; esforço percebido nessas sessões entre ${Math.min(...rpes)} e ${Math.max(...rpes)}/10` : ''}.`, data: { fast: fast.length, total: intervalPrescribed.length }, support: intervalPrescribed.length >= 5 ? 'media' : 'baixa', horizon: fast.length >= 4 ? 'consolidado' : 'recente', refs: { sessionIds: fast.map((r) => r.sessionId) } }));
  }
  const asContinuous = rows.filter((r) => { const run = runOf(r); return run && !r.isExtra && run.structure.prescribed === 'intervalado' && ['B', 'D'].includes(run.structure.scenario ?? '') && dayDiff(r.scheduledDate, asOf) <= 60; });
  if (intervalPrescribed.length + asContinuous.length >= 3 && asContinuous.length >= 2) {
    c.findings.push(finding({ id: 'long:interval-as-continuous', code: 'intervalado_executado_como_continuo', source: 'technical', kind: 'padrao', statement: `${asContinuous.length} dos últimos intervalados prescritos (60 dias) foram executados como contínuo; o relógio não informa o motivo.`, data: { count: asContinuous.length }, support: asContinuous.length >= 3 ? 'media' : 'baixa', horizon: 'recente', refs: { sessionIds: asContinuous.map((r) => r.sessionId) } }));
  }

  // tendências por variável (reaproveita as janelas 21/60/200 do motor matemático; nada recalculado aqui)
  for (const t of trends) {
    if (t.n < 6 || t.ma21 == null || t.ma60 == null) { if (t.n > 0) c.gaps.push(finding({ id: `trend:${t.variableId}:thin`, code: 'historico_insuficiente', source: 'gap', statement: `${t.label}: ${t.n} observações — insuficiente para separar tendência de oscilação.`, data: { n: t.n } })); continue; }
    const rel = t.ma60 !== 0 ? (t.ma21 - t.ma60) / Math.abs(t.ma60) : 0;
    const rel2 = t.ma200 != null && t.ma200 !== 0 ? (t.ma60 - t.ma200) / Math.abs(t.ma200) : null;
    const recentChange = Math.abs(rel) >= 0.08;
    const consolidated = recentChange && rel2 != null && Math.sign(rel2) === Math.sign(rel) && Math.abs(rel2) >= 0.05;
    const horizon: Horizon = consolidated ? 'consolidado' : recentChange ? 'recente' : 'pontual';
    if (!recentChange && !t.outsideHabitualRange) continue;
    c.findings.push(finding({
      id: `trend:${t.variableId}`, code: recentChange ? 'tendencia_recente' : 'oscilacao_pontual', source: 'technical', kind: 'mudanca',
      statement: `${t.label}: média de 21 dias ${num(t.ma21, 1)}, de 60 dias ${num(t.ma60, 1)}${t.ma200 != null ? `, de 200 dias ${num(t.ma200, 1)}` : ''} (${t.trendRecent}).${t.outsideHabitualRange ? ' Valor atual fora da faixa habitual do aluno.' : ''}${recentChange ? '' : ' Sem mudança sustentada nas médias.'}`,
      data: { ma21: t.ma21, ma60: t.ma60, ma200: t.ma200, current: t.current, outside: t.outsideHabitualRange }, support: t.n >= 12 ? 'media' : 'baixa', horizon,
    }));
  }
  c.evidence.limitations.push('Capacidades e padrões vêm de séries do relógio e de indicadores já calculados; não provam adaptação fisiológica isoladamente.');
  return c;
}

// ── análise da semana ───────────────────────────────────────────────────────────────────────────────────────────

export interface WeekInput {
  weekStart: string;
  indicators: WeeklyExecutionIndicators | null;
  rows: AnalysisRow[];
  // Resumo das semanas anteriores já analisadas (mais recente primeiro), para comparar a semana com o seu próprio histórico.
  previousWeeks: Array<{ weekStart: string; realizedKm: number | null; fastVolumeKm: number | null; frequencyPct: number | null; rpeAvg: number | null; hrInBand: number | null }>;
  trends: VariableTrend[];
  feedbackBySession: Map<string, FeedbackInput>;
  // Atividades de OUTRAS modalidades (nao corrida/esteira) registradas pelos dispositivos na semana e sem prescricao correspondente: carga fisica adicional.
  // So' contagem e minutos reais por modalidade — nunca convertidos em km de corrida nem em carga fisiologica estimada.
  otherActivities?: Array<{ modality: string; count: number; minutes: number }>;
}

const OTHER_MODALITY_LABEL: Record<string, string> = { forca: 'musculação', funcional: 'treino funcional/misto', bike: 'ciclismo', natacao: 'natação', caminhada: 'caminhada', outra: 'outra modalidade' };

export interface WeekSummaryData { realizedKm: number | null; fastVolumeKm: number | null; frequencyPct: number | null; rpeAvg: number | null; hrInBand: number | null }

export function weekSummaryOf(input: Pick<WeekInput, 'indicators' | 'rows' | 'feedbackBySession'>): WeekSummaryData {
  const runs = input.rows.map(runOf).filter((r): r is RunExecutionAnalysis => !!r);
  const fast = runs.map((r) => r.signature?.fastVolumeKm).filter((v): v is number => v != null);
  const rpes = [...input.feedbackBySession.values()].map((f) => f.perceivedEffort).filter((v): v is number => v != null);
  const hr = runs.map((r) => r.avgHeartRateInBandBpm).filter((v): v is number => v != null);
  const realized = runs.map((r) => r.totals.realizedKm).filter((v): v is number => v != null);
  return {
    realizedKm: realized.length ? Math.round(realized.reduce((a, b) => a + b, 0) * 10) / 10 : null, fastVolumeKm: fast.length ? Math.round(fast.reduce((a, b) => a + b, 0) * 10) / 10 : null,
    frequencyPct: input.indicators?.overview.frequencyPct ?? null, rpeAvg: rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null, hrInBand: hr.length ? Math.round(hr.reduce((a, b) => a + b, 0) / hr.length) : null,
  };
}

export function analyzeWeekInContext(input: WeekInput): AnalysisContract {
  const end = new Date(Date.parse(input.weekStart) + 6 * 86_400_000).toISOString().slice(0, 10);
  const c = emptyContract('week', { start: input.weekStart, end }, end, input.rows, [21, 60, 200]);
  const ind = input.indicators; const cur = weekSummaryOf(input);
  const refs = { weekStart: input.weekStart };
  if (!ind && input.rows.length === 0 && !(input.otherActivities?.length)) { c.gaps.push(finding({ id: `week:${input.weekStart}:empty`, code: 'semana_sem_dados', source: 'gap', statement: 'Sem treinos analisáveis na semana.', refs })); return c; }

  if (ind) {
    c.facts.push(finding({ id: `week:${input.weekStart}:adherence`, code: 'frequencia_e_adesao', source: 'measured', statement: `Realizou ${ind.overview.performed} de ${ind.overview.prescribed} treinos previstos (${ind.overview.frequencyPct ?? '?'}%); ${ind.overview.noRecord} sem registro.`, data: { performed: ind.overview.performed, prescribed: ind.overview.prescribed, noRecord: ind.overview.noRecord }, refs }));
    if (ind.run) {
      c.facts.push(finding({ id: `week:${input.weekStart}:volume`, code: 'volume_de_corrida', source: 'measured', statement: `Corrida: ${km(ind.run.realizedKm)} de ${km(ind.run.prescribedKmAll)} km previstos.`, data: { realizedKm: ind.run.realizedKm, prescribedKm: ind.run.prescribedKmAll }, refs }));
      const stim = ind.run.intensityByRole.estimulo ?? ind.run.intensityByRole.continuo;
      if (stim?.inPct != null) c.facts.push(finding({ id: `week:${input.weekStart}:distribution`, code: 'distribuicao_nas_faixas', source: 'measured', statement: `Tempo nas faixas prescritas (soma de ${ind.run.sessionsWithBands} treino(s)): ${stim.inPct}% dentro, ${stim.slowPct}% mais lento, ${stim.fastPct}% mais rápido.`, data: { inPct: stim.inPct, slowPct: stim.slowPct, fastPct: stim.fastPct, sessions: ind.run.sessionsWithBands }, refs }));
      if (ind.run.fidelity.analyzable > 0) c.facts.push(finding({ id: `week:${input.weekStart}:fidelity`, code: 'fidelidade_de_execucao', source: 'measured', statement: `Fidelidade (distinta da frequência): ${ind.run.fidelity.intensityWithin} de ${ind.run.fidelity.analyzable} treinos analisáveis dentro das faixas; ${ind.run.fidelity.structureCompatible} com estrutura compatível.`, data: { ...ind.run.fidelity }, refs }));
    }
    if (ind.strength) c.facts.push(finding({ id: `week:${input.weekStart}:strength`, code: 'musculacao', source: 'measured', statement: `Musculação: ${ind.strength.performed}/${ind.strength.prescribed}; durações ${ind.strength.durationClasses.proxima} próximas, ${ind.strength.durationClasses.mais_curta} mais curtas, ${ind.strength.durationClasses.mais_longa} mais longas.`, data: { performed: ind.strength.performed, effortAvg: ind.strength.effortAvg }, refs }));
  }
  // fatos do relógio por estímulo
  const intervalSessions = input.rows.filter((r) => { const run = runOf(r); return run && stimulusClass(run) === 'intervalado'; });
  if (cur.fastVolumeKm != null) c.facts.push(finding({ id: `week:${input.weekStart}:fast-volume`, code: 'volume_rapido_da_semana', source: 'measured', statement: `Volume em esforços rápidos reconhecidos: ${km(cur.fastVolumeKm)} km em ${intervalSessions.length} sessão(ões) com alternâncias.`, data: { fastVolumeKm: cur.fastVolumeKm, sessions: intervalSessions.length }, refs }));
  if (input.otherActivities && input.otherActivities.length > 0) {
    const text = input.otherActivities.map((o) => `${OTHER_MODALITY_LABEL[o.modality] ?? o.modality}: ${o.count} atividade(s), ${num(o.minutes, 0)} min`).join('; ');
    c.findings.push(finding({ id: `week:${input.weekStart}:other-modalities`, code: 'atividades_de_outras_modalidades', source: 'measured', kind: 'padrao', statement: `Atividades de outras modalidades registradas pelos dispositivos na semana, sem treino prescrito correspondente (carga física adicional; sem equivalência em km de corrida): ${text}.`, support: 'alta', horizon: 'pontual', basis: [], refs }));
  }
  const extras = input.rows.filter((r) => r.isExtra);
  if (extras.length > 0) {
    const extraKm = extras.reduce((s, r) => s + (runOf(r)?.totals.realizedKm ?? 0), 0);
    c.findings.push(finding({ id: `week:${input.weekStart}:extras`, code: 'atividades_sem_prescricao', source: 'technical', kind: 'padrao', statement: `${extras.length} atividade(s) por iniciativa do aluno na semana (${km(Math.round(extraKm * 10) / 10)} km), sem sessão prescrita correspondente.`, data: { count: extras.length, km: Math.round(extraKm * 10) / 10 }, support: 'media', horizon: 'pontual', refs }));
  }
  // relatos agregados
  const rpe = [...input.feedbackBySession.values()].map((f) => f.perceivedEffort).filter((v): v is number => v != null);
  if (rpe.length > 0) c.reported.push(finding({ id: `week:${input.weekStart}:rpe`, code: 'esforco_percebido_da_semana', source: 'reported', statement: `Esforço percebido: média ${cur.rpeAvg}/10 (${rpe.length} registro(s); de ${Math.min(...rpe)} a ${Math.max(...rpe)}).`, data: { avg: cur.rpeAvg, n: rpe.length }, refs }));
  const pains = [...input.feedbackBySession.values()].filter((f) => f.painFlag && f.painFlag !== 'none').length;
  if (pains > 0) c.reported.push(finding({ id: `week:${input.weekStart}:pain`, code: 'dor_relatada_na_semana', source: 'reported', statement: `Dor relatada em ${pains} treino(s) da semana.`, data: { count: pains }, refs }));
  const changed = [...input.feedbackBySession.values()].filter((f) => f.executionBehavior && f.executionBehavior !== 'as_planned').length;
  if (changed > 0) c.reported.push(finding({ id: `week:${input.weekStart}:behavior`, code: 'execucao_declarada_diferente', source: 'reported', statement: `O aluno declarou execução diferente do prescrito em ${changed} treino(s).`, data: { count: changed }, refs }));

  // comparação com as próprias semanas anteriores (até 4)
  const prev = input.previousWeeks.slice(0, 4);
  const prevKm = prev.map((p) => p.realizedKm).filter((v): v is number => v != null);
  if (cur.realizedKm != null && prevKm.length >= 2) {
    const base = prevKm.reduce((a, b) => a + b, 0) / prevKm.length;
    const rel = base > 0 ? (cur.realizedKm - base) / base : 0;
    if (Math.abs(rel) >= 0.2) c.findings.push(finding({ id: `week:${input.weekStart}:volume-change`, code: rel > 0 ? 'volume_acima_das_semanas_anteriores' : 'volume_abaixo_das_semanas_anteriores', source: 'technical', kind: 'mudanca', statement: `Volume de corrida de ${km(cur.realizedKm)} km, ${Math.abs(Math.round(rel * 100))}% ${rel > 0 ? 'acima' : 'abaixo'} da média das ${prevKm.length} semanas anteriores (${km(Math.round(base * 10) / 10)} km).`, data: { current: cur.realizedKm, baseline: Math.round(base * 10) / 10, weeks: prevKm.length }, support: prevKm.length >= 3 ? 'media' : 'baixa', horizon: 'recente', basis: [`week:${input.weekStart}:volume`], refs }));
  } else if (cur.realizedKm != null) c.gaps.push(finding({ id: `week:${input.weekStart}:thin`, code: 'historico_insuficiente', source: 'gap', statement: `${prevKm.length} semana(s) anterior(es) com volume: sem base para comparar a semana.`, refs }));
  const prevFast = prev.map((p) => p.fastVolumeKm).filter((v): v is number => v != null);
  if (cur.fastVolumeKm != null && prevFast.length >= 2) {
    const base = prevFast.reduce((a, b) => a + b, 0) / prevFast.length;
    if (base > 0 && Math.abs(cur.fastVolumeKm - base) / base >= 0.25) c.findings.push(finding({ id: `week:${input.weekStart}:fast-change`, code: 'volume_rapido_mudou', source: 'technical', kind: 'mudanca', statement: `Volume em esforços rápidos de ${km(cur.fastVolumeKm)} km contra média de ${km(Math.round(base * 10) / 10)} km nas ${prevFast.length} semanas anteriores.`, support: 'baixa', horizon: 'recente', basis: [`week:${input.weekStart}:fast-volume`], data: { current: cur.fastVolumeKm, baseline: Math.round(base * 10) / 10 }, refs }));
  }
  const prevHr = prev.map((p) => p.hrInBand).filter((v): v is number => v != null);
  if (cur.hrInBand != null && prevHr.length >= 3) {
    const base = median(prevHr) as number;
    if (Math.abs(cur.hrInBand - base) >= 4) c.findings.push(finding({ id: `week:${input.weekStart}:hr`, code: 'fc_em_faixa_mudou_na_semana', source: 'technical', kind: cur.hrInBand < base ? 'melhora' : 'mudanca', statement: `FC média dentro das faixas: ${cur.hrInBand} bpm contra mediana de ${Math.round(base)} bpm nas ${prevHr.length} semanas anteriores; faixas podem diferir entre semanas, então é um indício, não conclusão.`, support: 'baixa', horizon: 'recente', basis: [], data: { current: cur.hrInBand, baseline: Math.round(base) }, refs }));
  }
  // recuperação/sono/fadiga/dor: só sinaliza o que esta fora da faixa habitual (variaveis do motor matematico)
  for (const t of input.trends.filter((x) => x.outsideHabitualRange)) c.findings.push(finding({ id: `week:${input.weekStart}:out:${t.variableId}`, code: 'indicador_fora_da_faixa_habitual', source: 'technical', kind: 'dificuldade', statement: `${t.label} fora da faixa habitual do aluno (atual ${num(t.current, 1)}; média de 60 dias ${num(t.ma60, 1)}).`, support: t.n >= 12 ? 'media' : 'baixa', horizon: 'recente', data: { current: t.current, ma60: t.ma60 }, refs }));
  // co-ocorrência (nunca causalidade)
  const volUp = c.findings.some((f) => f.code === 'volume_acima_das_semanas_anteriores' || (f.code === 'volume_rapido_mudou' && (f.data.current as number) > (f.data.baseline as number)));
  const rpePrev = prev.map((p) => p.rpeAvg).filter((v): v is number => v != null);
  if (volUp && cur.rpeAvg != null && rpePrev.length >= 2 && cur.rpeAvg - rpePrev.reduce((a, b) => a + b, 0) / rpePrev.length >= 1) c.findings.push(finding({ id: `week:${input.weekStart}:co`, code: 'co_ocorrencia_volume_e_esforco', source: 'technical', kind: 'padrao', statement: 'Na mesma semana o volume subiu e o esforço percebido médio também; é uma coincidência de séries, sem evidência de que uma coisa causou a outra.', support: 'baixa', horizon: 'recente', basis: [], refs }));
  c.summary = cur;
  c.evidence.limitations.push('Comparações entre semanas usam as faixas prescritas de cada semana; faixas diferentes não são equivalentes.');
  return c;
}

// Resumo de cada semana anterior a partir das linhas de indicadores (sem reler series): segunda-feira como inicio.
export function summarizePreviousWeeks(rows: AnalysisRow[], feedbacks: Map<string, FeedbackInput>, beforeWeekStart: string, maxWeeks = 4): WeekInput['previousWeeks'] {
  const mondayOf = (date: string) => { const d = new Date(Date.parse(date)); const shift = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - shift * 86_400_000).toISOString().slice(0, 10); };
  const byWeek = new Map<string, AnalysisRow[]>();
  for (const r of rows) { const w = mondayOf(r.scheduledDate); if (w < beforeWeekStart) byWeek.set(w, [...(byWeek.get(w) ?? []), r]); }
  return [...byWeek.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, maxWeeks).map(([weekStart, weekRows]) => {
    const fbs = new Map(weekRows.filter((r) => feedbacks.has(r.sessionId)).map((r) => [r.sessionId, feedbacks.get(r.sessionId) as FeedbackInput]));
    const s = weekSummaryOf({ indicators: null, rows: weekRows, feedbackBySession: fbs });
    return { weekStart, realizedKm: s.realizedKm, fastVolumeKm: s.fastVolumeKm, frequencyPct: null, rpeAvg: s.rpeAvg, hrInBand: s.hrInBand };
  });
}

// ── evidências para o Prescritor (seleção enxuta; nenhuma decisão) ───────────────────────────────────────────────

const SUPPORT_RANK: Record<Support, number> = { alta: 3, media: 2, baixa: 1 };
const rank = (f: Finding) => (f.support ? SUPPORT_RANK[f.support] : 0) * 10 + (f.horizon === 'consolidado' ? 3 : f.horizon === 'recente' ? 2 : 1);

// Contexto que orienta a SELECAO (nunca os calculos): objetivo, diretrizes do treinador e tipo da sessao que sera prescrita.
export interface EvidenceFocus {
  goal?: string | null;
  directives?: string[];
  sessionKind?: 'intervalado' | 'continuo' | 'forca' | null;
}

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const FOCUS_STOPWORDS = new Set(['para', 'com', 'como', 'mais', 'muito', 'treino', 'treinos', 'sessao', 'sessoes', 'semana', 'aluno', 'aluna', 'correr', 'corrida', 'quero', 'minha', 'meu', 'fazer', 'tempo', 'sobre', 'quando', 'durante', 'esta', 'este', 'essa', 'esse', 'ainda', 'apenas', 'evoluir', 'consistencia']);
const keywordsOf = (texts: string[]) => [...new Set(texts.flatMap((t) => fold(t).split(/[^a-z0-9]+/)).filter((w) => w.length >= 4 && !FOCUS_STOPWORDS.has(w)))].slice(0, 40);
const SESSION_TERMS: Record<'intervalado' | 'continuo' | 'forca', RegExp> = {
  intervalado: /interval|altern|repeti|tiro|rapid|esforco/,
  continuo: /long|continu|ritmo|regularidade|aceleracao/,
  forca: /forca|musculac|forcalecimento/,
};
const KIND_WEIGHT: Record<string, number> = { dificuldade: 3, divergencia: 2, padrao: 2, contradicao: 1 };

// Pontuacao de relevancia: sustentacao e horizonte (ja existentes) + tipo do achado (dificuldade/divergencia/padrao), recorrencia, aderencia ao
// objetivo e as diretrizes (palavras-chave) e ao tipo da sessao. So' ordena o que ja foi calculado; nada e recalculado nem descartado por regra de treino.
function relevanceOf(text: string, focus: EvidenceFocus | undefined, keywords: string[], base: number, extra = 0): number {
  const folded = fold(text);
  let score = base + extra;
  const hits = keywords.filter((k) => folded.includes(k)).length;
  score += Math.min(hits, 3) * 4;
  if (focus?.sessionKind && SESSION_TERMS[focus.sessionKind].test(folded)) score += 5;
  return score;
}

export function toPrescriberEvidence(parts: { week: AnalysisContract | null; longitudinal: AnalysisContract | null; sessions: AnalysisContract[] }, focus?: EvidenceFocus): Record<string, unknown> | null {
  const keywords = keywordsOf([focus?.goal ?? '', ...(focus?.directives ?? [])]);
  const findingScore = (f: Finding) => relevanceOf(`${f.code} ${f.statement}`, focus, keywords, rank(f), (f.kind ? KIND_WEIGHT[f.kind] ?? 0 : 0) + (/recorrente|recorrencia/.test(f.code) || Number(f.data?.count ?? 0) >= 3 ? 3 : 0));
  const pick = (list: Finding[], n: number) => [...list].sort((a, b) => findingScore(b) - findingScore(a)).slice(0, n).map((f) => ({ codigo: f.code, texto: f.statement, sustentacao: f.support, horizonte: f.horizon }));
  const horizonScore = (h: Horizon) => (h === 'consolidado' ? 3 : h === 'recente' ? 2 : 1) * 4;
  const sessionFindings = parts.sessions.flatMap((s) => s.findings).filter((f) => f.kind === 'divergencia' || f.kind === 'dificuldade' || f.kind === 'contradicao');
  const capabilities = parts.longitudinal
    ? [...parts.longitudinal.capabilities].sort((a, b) => relevanceOf(`${b.family} ${b.statement}`, focus, keywords, horizonScore(b.horizon)) - relevanceOf(`${a.family} ${a.statement}`, focus, keywords, horizonScore(a.horizon))).slice(0, 5)
    : [];
  const changes = parts.longitudinal
    ? [...parts.longitudinal.changes].sort((a, b) => relevanceOf(`${b.family} ${b.variable}`, focus, keywords, Math.min(Math.abs(b.deltaPct ?? 0) / 10, 3)) - relevanceOf(`${a.family} ${a.variable}`, focus, keywords, Math.min(Math.abs(a.deltaPct ?? 0) / 10, 3))).slice(0, 6)
    : [];
  const out = {
    natureza: 'Achados do Analista de Treinos: fatos medidos, relatos e interpretacoes tecnicas com grau de sustentacao. Nao sao prescricao nem prova de causa; sem historico suficiente o item aparece como lacuna.',
    semana: parts.week ? { achados: pick(parts.week.findings, 5), lacunas: parts.week.gaps.slice(0, 2).map((g) => g.statement) } : null,
    treinosDaSemana: pick(sessionFindings, 5),
    evolucao: parts.longitudinal ? {
      achados: pick(parts.longitudinal.findings, 5),
      capacidades: capabilities.map((cap) => ({ tipo: cap.kind, texto: cap.statement, horizonte: cap.horizon })),
      mudancasEntreSessoesSemelhantes: changes.map((ch) => ({ formato: ch.family, variavel: ch.variable, de: ch.from, para: ch.to, variacaoPct: ch.deltaPct })),
      lacunas: parts.longitudinal.gaps.slice(0, 2).map((g) => g.statement),
    } : null,
  };
  const empty = !out.semana?.achados.length && !out.treinosDaSemana.length && !out.evolucao?.achados.length && !out.evolucao?.capacidades.length && !out.evolucao?.mudancasEntreSessoesSemelhantes.length;
  return empty && !out.semana?.lacunas.length && !out.evolucao?.lacunas.length ? null : out;
}

// Todos os provedores de que o contrato deriva (para a exclusão de dados de provedor).
export const contractProviders = (c: AnalysisContract) => c.evidence.providers;

// Etapa 3 — resumo CURTO do conhecimento longitudinal para o Prontuario: so' o que e' capacidade demonstrada, mudanca entre sessoes semelhantes ou
// padrao/dificuldade com sustentacao pelo menos media. Nao e' o relatorio: sao poucas linhas datadas, para o agente de condensacao integrar (ou nao).
export const PRONTUARIO_DIGEST_MAX_CHARS = 900;
export function prontuarioDigest(longitudinal: AnalysisContract | null): string | null {
  if (!longitudinal) return null;
  const lines: string[] = [];
  for (const cap of longitudinal.capabilities.slice(0, 4)) lines.push(`Capacidade (${cap.horizon}): ${cap.statement}`);
  for (const ch of longitudinal.changes.slice(0, 3)) lines.push(`Mudanca em ${ch.family}: ${ch.variable} de ${ch.from ?? '?'} para ${ch.to ?? '?'}${ch.deltaPct != null ? ` (${ch.deltaPct}%)` : ''}`);
  for (const f of longitudinal.findings.filter((x) => (x.kind === 'padrao' || x.kind === 'dificuldade') && (x.support === 'alta' || x.support === 'media')).slice(0, 3)) lines.push(`${f.kind === 'dificuldade' ? 'Dificuldade' : 'Padrao'} (${f.horizon ?? 'pontual'}): ${f.statement}`);
  if (lines.length === 0) return null;
  const text = `Achados do Analista de Treinos (medidos pelo relogio e pelos registros, calculo deterministico; dados ate ${longitudinal.asOf}): ${lines.join(' | ')}`;
  return text.length > PRONTUARIO_DIGEST_MAX_CHARS ? `${text.slice(0, PRONTUARIO_DIGEST_MAX_CHARS - 1)}…` : text;
}
