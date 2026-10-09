import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutionAnalysisService } from '../activity-execution/execution-analysis.service';
import { EXECUTION_ANALYSIS_VERSION, SessionAnalysis } from '../activity-execution/execution-analysis';
import { WeeklyExecutionIndicators } from '../activity-execution/execution-report';
import { TrainingIntelligenceQueryService } from '../training-intelligence/training-intelligence-query.service';
import { getVariableDefinition } from '../training-intelligence/variable-registry';
import {
  ANALYST_VERSION, AnalysisContract, AnalysisRow, analyzeLongitudinal, analyzeSessionInContext, analyzeWeekInContext, FeedbackInput, PrescriptionContext,
  EvidenceFocus, prontuarioDigest, summarizePreviousWeeks, toPrescriberEvidence, VariableTrend,
} from './training-analyst';

// Servico do Analista de Treinos (Etapa 2.2): carrega o que ja existe (indicadores da 2.1, janelas 21/60/200 do motor matematico, feedbacks, intencao da 1.2b),
// chama as funcoes puras e persiste o contrato. NENHUMA chamada de IA. Leituras apenas + gravacao dos proprios contratos.

const LONGITUDINAL_VARIABLES = ['execution.timeInBandPct', 'execution.distanceCompletionRatio', 'execution.intervalStructureMatch', 'execution.avgHeartRateInBandBpm', 'workout.perceivedEffort'];
const RECOVERY_VARIABLES = ['workout.preSleepQuality', 'workout.prePhysicalFatigue', 'workout.preMentalFatigue'];
const WINDOW_DAYS = 200;
const BACKFILL_LIMIT = 30;
const RUN = ['corrida', 'esteira'];
const ANALYZED = ['corrida', 'esteira', 'forca', 'fortalecimento_corredores'];

export interface AnalystDraft {
  asOf: string;
  week: AnalysisContract | null;
  longitudinal: AnalysisContract;
  sessions: AnalysisContract[];
  // O que e' enviado ao Prescritor (selecao enxuta) e os provedores de que deriva.
  promptEvidence: Record<string, unknown> | null;
  providers: string[];
  sessionIds: string[];
}

const day = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class TrainingAnalystService {
  private readonly logger = new Logger(TrainingAnalystService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executionAnalysis: ExecutionAnalysisService,
    private readonly intelligence: TrainingIntelligenceQueryService,
  ) {}

  private fingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 40); }

  // Garante indicadores (2.1) atualizados para as sessoes da janela que tem atividade/registro; recalcula no maximo BACKFILL_LIMIT por chamada
  // (as linhas antigas sem a assinatura do estimulo sao refeitas aos poucos, sem atrasar a geracao).
  private async ensureRows(userId: string, since: Date, until: Date, extraSessionIds: string[]) {
    const candidates = await this.prisma.trainingSession.findMany({
      where: { userId, scheduledDate: { gte: since, lt: until }, modality: { in: ANALYZED }, OR: [{ completion: { isNot: null } }, { executionLinks: { some: { status: 'active' } } }] },
      select: { id: true }, orderBy: { scheduledDate: 'desc' },
    });
    const existing = await this.prisma.sessionExecutionAnalysis.findMany({ where: { userId, trainingSessionId: { in: candidates.map((c) => c.id) }, algorithmVersion: EXECUTION_ANALYSIS_VERSION }, select: { trainingSessionId: true, indicators: true } });
    const ok = new Set(existing.filter((r) => { const a = r.indicators as { kind?: string; signature?: unknown }; return a?.kind !== 'run' || a.signature !== undefined; }).map((r) => r.trainingSessionId));
    const todo = [...new Set([...extraSessionIds, ...candidates.map((c) => c.id).filter((id) => !ok.has(id))])].slice(0, BACKFILL_LIMIT + extraSessionIds.length);
    for (const id of todo) await this.executionAnalysis.analyzeSession(userId, id).catch((error) => this.logger.warn(`Analise da sessao ${id} falhou: ${error instanceof Error ? error.message : error}`));
  }

  private async loadRows(userId: string, since: Date, until: Date): Promise<AnalysisRow[]> {
    const rows = await this.prisma.sessionExecutionAnalysis.findMany({ where: { userId, algorithmVersion: EXECUTION_ANALYSIS_VERSION, scheduledDate: { gte: since, lt: until } }, orderBy: { scheduledDate: 'asc' } });
    const sessions = await this.prisma.trainingSession.findMany({ where: { id: { in: rows.map((r) => r.trainingSessionId) } }, select: { id: true, origin: true } });
    const origin = new Map(sessions.map((s) => [s.id, s.origin]));
    return rows.map((r) => ({
      sessionId: r.trainingSessionId, scheduledDate: day(r.scheduledDate), modality: r.modality, isExtra: ['device_extra', 'student_extra'].includes(origin.get(r.trainingSessionId) ?? ''),
      activityLogId: r.activityLogId, provider: r.provider, analysis: r.indicators as unknown as SessionAnalysis,
    }));
  }

  private async loadFeedback(userId: string, sessionIds: string[]): Promise<Map<string, FeedbackInput>> {
    if (sessionIds.length === 0) return new Map();
    const completions = await this.prisma.workoutCompletion.findMany({
      where: { userId, sessionId: { in: sessionIds } },
      select: { sessionId: true, status: true, perceivedEffort: true, painFlag: true, executionBehavior: true, adjustmentReasons: true, notes: true, adjustmentComment: true },
    });
    return new Map(completions.filter((c) => c.sessionId).map((c) => [c.sessionId as string, {
      perceivedEffort: c.perceivedEffort, painFlag: c.painFlag, executionBehavior: c.executionBehavior, adjustmentReasons: c.adjustmentReasons ?? [],
      hasFreeText: Boolean((c.notes ?? '').trim() || (c.adjustmentComment ?? '').trim()), status: c.status,
    }]));
  }

  // Janelas 21/60/200 e tendencias JA calculadas pelo motor matematico (getVariableSnapshot) — nada e recalculado aqui.
  private async loadTrends(userId: string, ids: string[]): Promise<VariableTrend[]> {
    const out: VariableTrend[] = [];
    for (const id of ids) {
      const def = getVariableDefinition(id);
      if (!def) continue;
      try {
        const s = await this.intelligence.getVariableSnapshot(userId, id);
        out.push({
          variableId: id, label: def.constructLabel ?? id, unit: def.scale?.unit ?? '', current: s.current, n: s.mean?.n ?? 0,
          ma21: s.movingAverages?.short_21d?.value ?? null, ma60: s.movingAverages?.medium_60d?.value ?? null, ma200: s.movingAverages?.long_200d?.value ?? null,
          trendRecent: s.trend?.short_21d?.direction ?? 'insufficient_data', trendMedium: s.trend?.medium_60d?.direction ?? 'insufficient_data',
          outsideHabitualRange: s.persistence?.currentlyOutsideHabitualRange ?? null,
        });
      } catch (error) {
        this.logger.warn(`Janelas da variavel ${id} indisponiveis para a analise: ${error instanceof Error ? error.message : error}`);
      }
    }
    return out;
  }

  private async prescriptionContexts(userId: string, rows: AnalysisRow[]): Promise<Map<string, PrescriptionContext>> {
    const ids = rows.filter((r) => !r.isExtra).map((r) => r.sessionId);
    if (ids.length === 0) return new Map();
    const decisions = await this.prisma.prescriptionDecision.findMany({ where: { userId, kind: 'session', sessionId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { sessionId: true, intent: true, expected: true, traceStatus: true } });
    const map = new Map<string, PrescriptionContext>();
    for (const d of decisions) {
      if (!d.sessionId || map.has(d.sessionId)) continue;
      const row = rows.find((r) => r.sessionId === d.sessionId);
      map.set(d.sessionId, { structureKind: row?.analysis.kind === 'run' ? row.analysis.structure.prescribed : null, intent: d.intent, expected: (d.expected as { text?: string } | null)?.text ?? null, traceStatus: d.traceStatus });
    }
    return map;
  }

  // Analise do conjunto para a geracao semanal. `previousWeek` = semana imediatamente anterior ao programa que vai ser gerado.
  async buildForGeneration(userId: string, weekStart: Date, previousWeek: { startDate: Date; sessionIds: string[]; indicators: WeeklyExecutionIndicators | null } | null): Promise<AnalystDraft | null> {
    const asOf = day(new Date(weekStart.getTime() - 86_400_000));
    const since = new Date(weekStart.getTime() - WINDOW_DAYS * 86_400_000);
    const prevStart = previousWeek?.startDate ?? new Date(weekStart.getTime() - 7 * 86_400_000);
    // sessoes extras da semana anterior (iniciativa do aluno/relogio) tambem entram
    const extras = await this.prisma.trainingSession.findMany({ where: { userId, scheduledDate: { gte: prevStart, lt: weekStart }, origin: { in: ['device_extra', 'student_extra'] }, modality: { in: RUN } }, select: { id: true } });
    await this.ensureRows(userId, since, weekStart, [...(previousWeek?.sessionIds ?? []), ...extras.map((e) => e.id)]);

    const rows = await this.loadRows(userId, since, weekStart);
    if (rows.length === 0) return null;
    const feedbacks = await this.loadFeedback(userId, rows.map((r) => r.sessionId));
    const prescriptions = await this.prescriptionContexts(userId, rows);
    const trends = await this.loadTrends(userId, [...LONGITUDINAL_VARIABLES, ...RECOVERY_VARIABLES]);
    const rpeBySession = new Map([...feedbacks.entries()].filter(([, f]) => f.perceivedEffort != null).map(([id, f]) => [id, f.perceivedEffort as number]));

    const weekRows = rows.filter((r) => r.scheduledDate >= day(prevStart) && r.scheduledDate < day(weekStart));
    const sessions = weekRows.map((r) => analyzeSessionInContext({
      row: r, prescription: prescriptions.get(r.sessionId) ?? null, feedback: feedbacks.get(r.sessionId) ?? null,
      history: rows.filter((h) => h.scheduledDate < r.scheduledDate && h.sessionId !== r.sessionId),
    }));
    const weekFeedback = new Map(weekRows.filter((r) => feedbacks.has(r.sessionId)).map((r) => [r.sessionId, feedbacks.get(r.sessionId) as FeedbackInput]));
    const week = weekRows.length > 0 || previousWeek?.indicators
      ? analyzeWeekInContext({ weekStart: day(prevStart), indicators: previousWeek?.indicators ?? null, rows: weekRows, previousWeeks: summarizePreviousWeeks(rows, feedbacks, day(prevStart)), trends: trends.filter((t) => RECOVERY_VARIABLES.includes(t.variableId)), feedbackBySession: weekFeedback })
      : null;
    const longitudinal = analyzeLongitudinal({ asOf, rows, trends: trends.filter((t) => LONGITUDINAL_VARIABLES.includes(t.variableId)), rpeBySession });

    // persiste o indicador VIVO de cada sessao analisada (recalculado quando a fonte muda)
    for (const [index, contract] of sessions.entries()) await this.upsertSession(userId, weekRows[index], contract).catch((error) => this.logger.warn(`Persistencia da analise da sessao falhou: ${error instanceof Error ? error.message : error}`));

    const providers = [...new Set([week, longitudinal, ...sessions].flatMap((c) => c?.evidence.providers ?? []))].sort();
    return { asOf, week, longitudinal, sessions, promptEvidence: toPrescriberEvidence({ week, longitudinal, sessions }), providers, sessionIds: weekRows.map((r) => r.sessionId) };
  }

  private async upsertSession(userId: string, row: AnalysisRow, contract: AnalysisContract) {
    const fingerprint = this.fingerprint({ a: ANALYST_VERSION, c: contract });
    const existing = await this.prisma.trainingAnalysis.findFirst({ where: { userId, scope: 'session', refKey: row.sessionId, analystVersion: ANALYST_VERSION, deliveredWithPlanId: null } });
    const data = { userId, scope: 'session', refKey: row.sessionId, analystVersion: ANALYST_VERSION, periodStart: new Date(row.scheduledDate), periodEnd: new Date(row.scheduledDate), status: 'active', contract: contract as unknown as Prisma.InputJsonValue, sources: contract.evidence as unknown as Prisma.InputJsonValue, sourceFingerprint: fingerprint };
    if (existing) { if (existing.sourceFingerprint !== fingerprint || existing.status !== 'active') await this.prisma.trainingAnalysis.update({ where: { id: existing.id }, data }); } else await this.prisma.trainingAnalysis.create({ data });
  }

  // RETRATO entregue com o programa novo (chamar DENTRO da transacao). Nunca reescrito por dados posteriores.
  async persistSnapshots(tx: Prisma.TransactionClient, userId: string, draft: AnalystDraft, deliveredWithPlanId: string): Promise<void> {
    const rows: Array<[string, string, AnalysisContract]> = [['longitudinal', draft.asOf, draft.longitudinal]];
    if (draft.week) rows.push(['week', draft.week.period.start, draft.week]);
    for (const [scope, refKey, contract] of rows) {
      await tx.trainingAnalysis.create({
        data: {
          userId, scope, refKey, analystVersion: ANALYST_VERSION, periodStart: new Date(contract.period.start), periodEnd: new Date(contract.period.end), status: 'active',
          contract: contract as unknown as Prisma.InputJsonValue, sources: contract.evidence as unknown as Prisma.InputJsonValue, sourceFingerprint: this.fingerprint(contract), deliveredWithPlanId,
        },
      });
    }
  }

  // Etapa 3 (ajuste 1): regeneracao de UM dia. Reaproveita o RETRATO entregue com o programa desta semana (semana anterior + evolucao, ja calculados na
  // geracao semanal, com a data de referencia dela): nenhuma recomputacao, nenhuma escrita, nenhuma chamada de IA, e nada posterior a esse retrato entra.
  // Retrato invalidado (exclusao de dados do provedor) ou ausente (programa anterior a 2.2) => null.
  async forDayRegeneration(userId: string, planId: string, focus?: EvidenceFocus): Promise<{ promptEvidence: Record<string, unknown> | null; providers: string[] } | null> {
    const rows = await this.prisma.trainingAnalysis.findMany({ where: { userId, deliveredWithPlanId: planId, status: 'active', scope: { in: ['week', 'longitudinal'] } } });
    const week = (rows.find((r) => r.scope === 'week')?.contract ?? null) as unknown as AnalysisContract | null;
    const longitudinal = (rows.find((r) => r.scope === 'longitudinal')?.contract ?? null) as unknown as AnalysisContract | null;
    if (!week && !longitudinal) return null;
    const providers = [...new Set([week, longitudinal].flatMap((c) => c?.evidence.providers ?? []))].sort();
    return { promptEvidence: toPrescriberEvidence({ week, longitudinal, sessions: [] }, focus), providers };
  }

  // Etapa 3: texto para o Prontuario (evento TRAINING_ANALYSIS_FINDINGS). Null quando nao ha nada relevante OU quando e' identico ao ultimo registrado.
  async prontuarioEvent(userId: string, draft: AnalystDraft): Promise<string | null> {
    const text = prontuarioDigest(draft.longitudinal);
    if (!text) return null;
    const last = await this.prisma.studentProfileEvent.findFirst({ where: { userId, code: 'TRAINING_ANALYSIS_FINDINGS' }, orderBy: { createdAt: 'desc' }, select: { content: true } });
    const body = (value: string) => value.replace(/dados ate \d{4}-\d{2}-\d{2}/, '');
    return last && body(last.content) === body(text) ? null : text;
  }

  // Leitura para o painel do treinador/Prontuario.
  async read(userId: string, query: { scope?: string; planId?: string; sessionId?: string; limit?: number }) {
    return this.prisma.trainingAnalysis.findMany({
      where: { userId, ...(query.scope ? { scope: query.scope } : {}), ...(query.planId ? { deliveredWithPlanId: query.planId } : {}), ...(query.sessionId ? { scope: 'session', refKey: query.sessionId } : {}) },
      orderBy: { periodEnd: 'desc' }, take: Math.min(query.limit ?? 30, 100),
    });
  }
}
