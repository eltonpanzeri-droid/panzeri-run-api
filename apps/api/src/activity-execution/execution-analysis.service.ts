import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NORMALIZATION_VERSION } from '../activity-timeseries/activity-timeseries.service';
import { pickCanonicalPerEvent } from './canonical-observation';
import {
  analyzeRunExecution, analyzeStrengthExecution, EXECUTION_ANALYSIS_VERSION, NotDoneAnalysis, SessionAnalysis,
} from './execution-analysis';
import { buildWeeklyExecutionIndicators, renderSessionReport, renderWeeklyReport, WeeklyExecutionIndicators, WeeklySessionInput } from './execution-report';

// Persistencia e consolidacao da analise de execucao (Etapa 2.1). So' LE atividade, vinculo e serie; grava apenas INDICADORES derivados (nunca duplica a
// atividade bruta nem a serie). A associacao sessao<->atividade e' a existente (SessionExecutionLink ativo) e nao e' alterada aqui.

// Revisao do CONTEUDO calculado (nao muda o formato do contrato): 2 = assinatura do estimulo (Etapa 2.2). Entra na impressao digital: linhas antigas sao recalculadas.
const ANALYSIS_REVISION = 2;
const RUN = new Set(['corrida', 'esteira']);
const STRENGTH = new Set(['forca', 'fortalecimento_corredores']);
const EXTRA_ORIGINS = new Set(['device_extra', 'student_extra']);

export interface WeeklyReportDraft {
  weekStartDate: Date;
  analyzedPlanId: string;
  indicators: WeeklyExecutionIndicators;
  textLines: string[];
  // Versao compacta, so' com numeros, enviada ao Prescritor (sem o texto do aluno).
  promptIndicators: Record<string, unknown>;
}

@Injectable()
export class ExecutionAnalysisService {
  private readonly logger = new Logger(ExecutionAnalysisService.name);

  constructor(private readonly prisma: PrismaService) {}

  private fingerprint(parts: unknown): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40);
  }

  // Analisa UMA sessao e grava/atualiza a linha de indicadores (idempotente: so' recalcula quando a fonte mudou). Devolve null para modalidades que esta
  // etapa nao analisa.
  async analyzeSession(userId: string, sessionId: string, options: { force?: boolean } = {}): Promise<{ analysis: SessionAnalysis; activityLogId: string | null; provider: string | null; kind: 'run' | 'strength' } | null> {
    const session = await this.prisma.trainingSession.findFirst({
      where: { id: sessionId, userId },
      include: { completion: true, executionLinks: { where: { status: 'active' }, include: { activityLog: true } } },
    });
    if (!session) return null;
    const kind = RUN.has(session.modality) ? 'run' : STRENGTH.has(session.modality) ? 'strength' : null;
    if (!kind) return null;
    // Atividades por iniciativa do aluno/relogio (sem prescricao correspondente): analisadas SO' como assinatura do estimulo (Etapa 2.2); nada e comparado com prescricao.
    const isExtra = EXTRA_ORIGINS.has(session.origin ?? '');
    if (isExtra && kind !== 'run') return null;

    const picks = await pickCanonicalPerEvent(session.executionLinks.map((link) => link.activityLog), (ids) => this.prisma.activityLog.findMany({ where: { userId, id: { in: ids } } }));
    const activity = picks[0]?.row ?? null;
    // Impressao digital da serie SEM carregar os pontos (contagem e extremos): a serie completa so' e' lida quando a analise precisa ser recalculada.
    const seriesWhere = activity ? { activityLogId: activity.id, normalizationVersion: NORMALIZATION_VERSION } : null;
    const seriesStats = kind === 'run' && seriesWhere
      ? await this.prisma.activityTimeSeriesPoint.aggregate({ where: seriesWhere, _count: { _all: true }, _min: { offsetSec: true }, _max: { offsetSec: true, distanceMeters: true } })
      : null;
    const completion = session.completion;
    const fingerprint = this.fingerprint({
      v: EXECUTION_ANALYSIS_VERSION, r: ANALYSIS_REVISION,
      a: activity ? [activity.id, activity.distanceMeters, activity.durationSec, activity.avgHeartRateBpm, activity.cadenceAvg, activity.caloriesKcal] : null,
      p: seriesStats ? [seriesStats._count._all, seriesStats._min.offsetSec, seriesStats._max.offsetSec, seriesStats._max.distanceMeters] : null,
      c: completion ? [completion.status, completion.distanceKm, completion.durationMin, completion.perceivedEffort, completion.avgHeartRate] : null,
      s: [session.distanceKm, session.durationMin, this.fingerprint(session.structure)],
    });
    const existing = await this.prisma.sessionExecutionAnalysis.findUnique({ where: { trainingSessionId_algorithmVersion: { trainingSessionId: sessionId, algorithmVersion: EXECUTION_ANALYSIS_VERSION } } });
    if (existing && existing.sourceFingerprint === fingerprint && !options.force) {
      return { analysis: existing.indicators as unknown as SessionAnalysis, activityLogId: existing.activityLogId, provider: existing.provider, kind };
    }

    const points = kind === 'run' && seriesWhere && (seriesStats?._count._all ?? 0) > 0
      ? await this.prisma.activityTimeSeriesPoint.findMany({ where: seriesWhere, orderBy: { offsetSec: 'asc' }, select: { offsetSec: true, distanceMeters: true, heartRateBpm: true, cadenceSpm: true } })
      : [];
    let analysis: SessionAnalysis;
    if (completion?.status === 'missed') analysis = this.notDone(session, 'marcada_como_nao_feita');
    else if (!completion && !activity) analysis = this.notDone(session, 'sem_registro');
    else if (kind === 'run') {
      analysis = analyzeRunExecution({
        structure: isExtra ? null : session.structure, prescribedDistanceKm: isExtra ? null : session.distanceKm, prescribedDurationMin: isExtra ? null : session.durationMin, points,
        activity: activity ? { distanceMeters: activity.distanceMeters, durationSec: activity.durationSec, avgHeartRateBpm: activity.avgHeartRateBpm, cadenceAvg: activity.cadenceAvg } : null,
        completion: completion ? { status: completion.status, distanceKm: completion.distanceKm, durationMin: completion.durationMin, avgHeartRate: completion.avgHeartRate, perceivedEffort: completion.perceivedEffort } : null,
      });
    } else {
      analysis = analyzeStrengthExecution({
        prescribedDurationMin: session.durationMin,
        completion: completion ? { status: completion.status, durationMin: completion.durationMin, avgHeartRate: completion.avgHeartRate, perceivedEffort: completion.perceivedEffort, details: completion.details } : null,
        activity: activity ? { durationSec: activity.durationSec, avgHeartRateBpm: activity.avgHeartRateBpm, caloriesKcal: activity.caloriesKcal } : null,
      });
    }

    const status = analysis.kind === 'not_done' ? 'not_done' : analysis.kind === 'run' ? (analysis.dataLevel === 'series' ? 'analyzed' : analysis.dataLevel === 'summary_only' ? 'summary_only' : analysis.dataLevel === 'manual_only' ? 'manual_only' : 'no_data') : (analysis.dataLevel === 'none' ? 'no_data' : analysis.dataLevel === 'manual_only' ? 'manual_only' : 'analyzed');
    const data = {
      userId, trainingSessionId: sessionId, activityLogId: activity?.id ?? null, provider: activity?.provider ?? null, modality: session.modality,
      scheduledDate: session.scheduledDate, algorithmVersion: EXECUTION_ANALYSIS_VERSION, status, sourceFingerprint: fingerprint, indicators: analysis as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.sessionExecutionAnalysis.upsert({
      where: { trainingSessionId_algorithmVersion: { trainingSessionId: sessionId, algorithmVersion: EXECUTION_ANALYSIS_VERSION } },
      create: data, update: { ...data, computedAt: new Date() },
    });
    return { analysis, activityLogId: activity?.id ?? null, provider: activity?.provider ?? null, kind };
  }

  private notDone(session: { modality: string; distanceKm: number | null; durationMin: number | null }, reason: NotDoneAnalysis['reason']): NotDoneAnalysis {
    return { kind: 'not_done', version: EXECUTION_ANALYSIS_VERSION, modality: session.modality, reason, prescribedKm: session.distanceKm, prescribedDurationMin: session.durationMin };
  }

  // Consolida a SEMANA anterior (sessoes prescritas do plano autoritativo daquela semana). Atualiza as linhas de indicadores vivas e monta o relatorio.
  // Nao grava o relatorio (isso e' feito na transacao que cria o programa novo: persistWeeklyReport).
  async prepareWeeklyReport(userId: string, week: { startDate: Date; planId: string; sessionIds: string[] }): Promise<WeeklyReportDraft | null> {
    const inputs: WeeklySessionInput[] = [];
    for (const sessionId of week.sessionIds) {
      const result = await this.analyzeSession(userId, sessionId).catch((error) => {
        this.logger.warn(`Analise da sessao ${sessionId} falhou: ${error instanceof Error ? error.message : error}`);
        return null;
      });
      if (!result) continue;
      const row = await this.prisma.trainingSession.findUnique({ where: { id: sessionId }, select: { modality: true, scheduledDate: true } });
      inputs.push({ sessionId, scheduledDate: (row?.scheduledDate ?? week.startDate).toISOString().slice(0, 10), modality: row?.modality ?? 'corrida', kind: result.kind, analysis: result.analysis, activityLogId: result.activityLogId, provider: result.provider });
    }
    if (inputs.length === 0) return null;
    const weekStartDate = week.startDate.toISOString().slice(0, 10);
    const indicators = buildWeeklyExecutionIndicators(weekStartDate, inputs);
    return { weekStartDate: week.startDate, analyzedPlanId: week.planId, indicators, textLines: renderWeeklyReport(indicators), promptIndicators: this.toPromptIndicators(indicators) };
  }

  // Forma compacta enviada ao Prescritor: so' numeros e contagens (sem ids de fonte nem texto do aluno).
  toPromptIndicators(ind: WeeklyExecutionIndicators): Record<string, unknown> {
    return {
      semanaIniciadaEm: ind.weekStartDate,
      sessoes: { prescritas: ind.overview.prescribed, realizadas: ind.overview.performed, naoFeitas: ind.overview.notPerformed, semRegistro: ind.overview.noRecord, frequenciaPct: ind.overview.frequencyPct },
      musculacao: ind.strength && {
        realizadas: ind.strength.performed, duracaoProximaDaPrevista: ind.strength.durationClasses.proxima, maisCurtas: ind.strength.durationClasses.mais_curta, maisLongas: ind.strength.durationClasses.mais_longa,
        esforcoPercebidoMedio: ind.strength.effortAvg, esforcoMin: ind.strength.effortMin, esforcoMax: ind.strength.effortMax, gastoEnergeticoEstimadoKcal: ind.strength.caloriesTotalKcal,
      },
      corrida: ind.run && {
        realizadas: ind.run.performed, kmPrevistosNaSemana: ind.run.prescribedKmAll, kmRealizados: ind.run.realizedKm, treinosComDistanciaConhecida: ind.run.sessionsWithDistance,
        tempoPorFaixaPrescrita: Object.fromEntries(Object.entries(ind.run.intensityByRole).map(([role, t]) => [role, { dentroPct: t.inPct, maisLentoPct: t.slowPct, maisRapidoPct: t.fastPct, segundosClassificados: t.classifiedSec }])),
        treinosComFaixa: ind.run.sessionsWithBands,
        estruturaIntervalados: { previstos: ind.run.structure.intervalPrescribed, avaliados: ind.run.structure.classified, cenarios: ind.run.structure.scenarios },
        fidelidade: ind.run.fidelity,
      },
      observacoes: ind.completeness.notes,
    };
  }

  // Grava o RETRATO do relatorio junto com o programa recem-criado (chamar DENTRO da transacao). Nunca reescrito por dados posteriores.
  async persistWeeklyReport(tx: Prisma.TransactionClient, userId: string, draft: WeeklyReportDraft, deliveredWithPlanId: string): Promise<string> {
    const row = await tx.weeklyExecutionReport.create({
      data: {
        userId, weekStartDate: draft.weekStartDate, analyzedPlanId: draft.analyzedPlanId, deliveredWithPlanId, algorithmVersion: EXECUTION_ANALYSIS_VERSION,
        indicators: draft.indicators as unknown as Prisma.InputJsonValue, textLines: draft.textLines as unknown as Prisma.InputJsonValue, sources: draft.indicators.sources as unknown as Prisma.InputJsonValue,
      },
    });
    return row.id;
  }

  // Leitura para a apresentacao ao aluno: relatorio semanal entregue com o programa + relatorio curto de cada sessao (das linhas vivas).
  async presentationFor(userId: string, planId: string, sessionIds: string[], candidateIds: string[] = []) {
    // Sessoes com registro ou atividade vinculada: garante que a linha de indicadores exista e esteja atual (impressao digital; barato quando nada mudou).
    for (const id of candidateIds.slice(0, 14)) {
      await this.analyzeSession(userId, id).catch((error) => this.logger.warn(`Analise da sessao ${id} falhou: ${error instanceof Error ? error.message : error}`));
    }
    const [weekly, rows] = await Promise.all([
      this.prisma.weeklyExecutionReport.findFirst({ where: { userId, deliveredWithPlanId: planId, status: 'active' }, orderBy: { createdAt: 'desc' } }),
      sessionIds.length === 0 ? [] : this.prisma.sessionExecutionAnalysis.findMany({ where: { userId, trainingSessionId: { in: sessionIds }, algorithmVersion: EXECUTION_ANALYSIS_VERSION } }),
    ]);
    const sessionReports: Record<string, { lines: string[]; status: string; scenario: string | null }> = {};
    for (const row of rows) {
      if (row.status === 'not_done' || row.status === 'no_data') continue;
      const analysis = row.indicators as unknown as SessionAnalysis;
      sessionReports[row.trainingSessionId] = { lines: renderSessionReport(analysis), status: row.status, scenario: analysis.kind === 'run' ? analysis.structure.scenario : null };
    }
    return {
      weeklyReport: weekly ? { id: weekly.id, weekStartDate: weekly.weekStartDate, lines: weekly.textLines as unknown as string[], createdAt: weekly.createdAt } : null,
      sessionReports,
    };
  }
}
