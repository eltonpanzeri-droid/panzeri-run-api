import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import {
  AgentCallTrace, buildAgentInputRecord, buildSessionDecisions, buildWeekDecision, DecisionDraft, describeSessionForTrace, EvidenceItem,
  parseRetentionMonths, retentionCutoff, SessionForTrace, TRACE_SCHEMA_VERSION,
} from './prescription-trace';
import type { ContextGap } from './student-information-context';

const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

type Tx = Prisma.TransactionClient;

export interface PersistWeeklyParams {
  userId: string;
  planId: string;
  weekStart: Date;
  methodologyVersion: string;
  createdSessions: SessionForTrace[];
  previousWeek: { startDate: Date; sessions: SessionForTrace[] } | null;
  evidence: EvidenceItem[];
  contextGaps: ContextGap[];
  agentTrace: AgentCallTrace[];
  recommendation: string;
  rationale: string[];
  safetyAdjustment: boolean;
  routineMismatch?: string | null;
}

export interface PersistDayParams {
  userId: string;
  planId: string;
  methodologyVersion: string;
  session: SessionForTrace;
  previousSummary: string;
  evidence: EvidenceItem[];
  contextGaps: ContextGap[];
  agentTrace: AgentCallTrace[];
}

@Injectable()
export class PrescriptionTraceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PrescriptionTraceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // Gravado NA MESMA TRANSACAO que cria o plano: nenhuma prescricao nova existe sem trilha. Registros imutaveis.
  async persistWeekly(tx: Tx, p: PersistWeeklyParams): Promise<{ packageId: string }> {
    const record = buildAgentInputRecord(p.agentTrace);
    const pkg = await tx.prescriptionEvidencePackage.create({
      data: {
        userId: p.userId, planId: p.planId, kind: 'weekly', schemaVersion: TRACE_SCHEMA_VERSION, methodologyVersion: p.methodologyVersion,
        modelIds: record.modelIds, agentInputHash: record.agentInputHash,
        evidence: p.evidence as unknown as Prisma.InputJsonValue, contextGaps: p.contextGaps as unknown as Prisma.InputJsonValue,
        agentInput: record.agentInput === null ? Prisma.DbNull : (record.agentInput as Prisma.InputJsonValue),
      },
    });
    const decisions: DecisionDraft[] = [
      buildWeekDecision({ weekStart: p.weekStart, sessionCount: p.createdSessions.length, recommendation: p.recommendation, rationale: p.rationale, safetyAdjustment: p.safetyAdjustment, routineMismatch: p.routineMismatch }),
      ...buildSessionDecisions({ sessions: p.createdSessions, previousWeek: p.previousWeek }),
    ];
    await tx.prescriptionDecision.createMany({ data: decisions.map((d) => this.toRow(pkg.id, p.userId, p.planId, d)) });
    return { packageId: pkg.id };
  }

  // Regeneracao de UM dia: pacote proprio (kind = day_regeneration) + uma decisao, com o resumo da prescricao anterior.
  async persistDayRegeneration(tx: Tx, p: PersistDayParams): Promise<{ packageId: string }> {
    const record = buildAgentInputRecord(p.agentTrace);
    const pkg = await tx.prescriptionEvidencePackage.create({
      data: {
        userId: p.userId, planId: p.planId, sessionId: p.session.id, kind: 'day_regeneration', schemaVersion: TRACE_SCHEMA_VERSION, methodologyVersion: p.methodologyVersion,
        modelIds: record.modelIds, agentInputHash: record.agentInputHash,
        evidence: p.evidence as unknown as Prisma.InputJsonValue, contextGaps: p.contextGaps as unknown as Prisma.InputJsonValue,
        agentInput: record.agentInput === null ? Prisma.DbNull : (record.agentInput as Prisma.InputJsonValue),
      },
    });
    const [decision] = buildSessionDecisions({ sessions: [p.session], previousWeek: null });
    decision.changeFromPrevious = { previousSummary: p.previousSummary, newSummary: describeSessionForTrace(p.session) };
    await tx.prescriptionDecision.createMany({ data: [this.toRow(pkg.id, p.userId, p.planId, decision)] });
    return { packageId: pkg.id };
  }

  private toRow(packageId: string, userId: string, planId: string, d: DecisionDraft): Prisma.PrescriptionDecisionCreateManyInput {
    return {
      packageId, userId, planId, sessionId: d.sessionId, kind: d.kind, weekday: d.weekday, modality: d.modality, summary: d.summary,
      changeFromPrevious: d.changeFromPrevious === null ? Prisma.DbNull : (d.changeFromPrevious as Prisma.InputJsonValue),
      rationale: d.rationale === null ? Prisma.DbNull : (d.rationale as Prisma.InputJsonValue),
      traceStatus: 'absent',
    };
  }

  // Reconstrucao: pacote(s) + decisoes + RESULTADO lido por vinculo (nada e copiado; sempre consistente com o dado atual).
  async getTrace(userId: string, query: { planId?: string; sessionId?: string; includeAgentInput?: boolean }) {
    const packages = await this.prisma.prescriptionEvidencePackage.findMany({
      where: { userId, ...(query.planId ? { planId: query.planId } : {}), ...(query.sessionId ? { OR: [{ sessionId: query.sessionId }, { decisions: { some: { sessionId: query.sessionId } } }] } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { decisions: { orderBy: { createdAt: 'asc' } } },
    });
    const result = [];
    for (const pkg of packages) {
      const { agentInput, ...rest } = pkg;
      const decisions = [];
      for (const decision of pkg.decisions) {
        decisions.push({ ...decision, outcome: decision.sessionId ? await this.outcomeOf(userId, decision.sessionId) : null });
      }
      result.push({
        ...rest,
        decisions,
        agentInputAvailable: agentInput !== null,
        ...(query.includeAgentInput ? { agentInput: this.withParsedInput(agentInput) } : {}),
      });
    }
    return { userId, packages: result };
  }

  // Conveniencia de leitura: cada chamada ganha userInput (o prompt parseado). O texto exato continua em userPrompt.
  private withParsedInput(agentInput: Prisma.JsonValue | null) {
    const calls = (agentInput as { calls?: Array<{ userPrompt?: string }> } | null)?.calls;
    if (!Array.isArray(calls)) return agentInput;
    return { calls: calls.map((call) => { let userInput: unknown = null; try { userInput = JSON.parse(call.userPrompt ?? ''); } catch { /* texto nao-JSON */ } return { ...call, userInput }; }) };
  }

  // Resultado observado de uma sessao: o registro do aluno e a execucao OBJETIVA (atividade canonica do evento fisico).
  async outcomeOf(userId: string, sessionId: string) {
    const session = await this.prisma.trainingSession.findFirst({
      where: { id: sessionId, userId },
      select: {
        id: true, scheduledDate: true,
        completion: { select: { status: true, completedAt: true, durationMin: true, distanceKm: true, avgPaceSecondsKm: true, avgHeartRate: true, perceivedEffort: true, painFlag: true } },
        executionLinks: { where: { status: 'active' }, select: { activityLog: true } },
      },
    });
    if (!session) return { status: 'session_not_found' as const, completion: null, objectiveActivities: [] };
    const picks = await pickCanonicalPerEvent(session.executionLinks.map((link) => link.activityLog), (ids) => this.prisma.activityLog.findMany({ where: { userId, id: { in: ids } } }));
    const objectiveActivities = picks.map((pick) => ({
      activityLogId: pick.row.id, provider: pick.row.provider, startedAt: pick.row.startedAt,
      distanceKm: pick.row.distanceMeters != null ? pick.row.distanceMeters / 1000 : null,
      durationMin: pick.row.durationSec != null ? pick.row.durationSec / 60 : null,
      avgHeartRateBpm: pick.row.avgHeartRateBpm,
    }));
    const status = session.completion ? (session.completion.status === 'missed' ? ('missed' as const) : ('executed' as const)) : objectiveActivities.length > 0 ? ('objective_only' as const) : ('no_record' as const);
    return { status, completion: session.completion, objectiveActivities };
  }

  // Retencao da ENTRADA COMPLETA enviada a IA (configuravel). O indice de evidencias e as decisoes permanecem.
  retentionMonths(): number | null {
    return parseRetentionMonths(this.config.get<string>('PRESCRIPTION_TRACE_INPUT_RETENTION_MONTHS'));
  }

  async purgeExpiredAgentInputs(now: Date = new Date()): Promise<number> {
    const months = this.retentionMonths();
    if (months === null) return 0;
    const result = await this.prisma.prescriptionEvidencePackage.updateMany({
      where: { createdAt: { lt: retentionCutoff(now, months) }, agentInputPurgedAt: null, NOT: { agentInput: { equals: Prisma.DbNull } } },
      data: { agentInput: Prisma.DbNull, agentInputPurgedAt: now },
    });
    return result.count;
  }

  // O intervalo de 24 h so dispara depois de 24 h de processo: como cada deploy reinicia a API, tambem roda UMA vez logo depois da subida.
  onApplicationBootstrap() {
    setTimeout(() => { void this.runRetention(); }, 2 * 60 * 1000).unref();
  }

  @Interval(RETENTION_INTERVAL_MS)
  async runRetention(): Promise<void> {
    try {
      const purged = await this.purgeExpiredAgentInputs();
      if (purged > 0) this.logger.log(`Retencao da rastreabilidade: ${purged} entrada(s) completa(s) da IA expurgada(s) (indice e decisoes mantidos).`);
    } catch (error) {
      this.logger.warn(`Retencao da rastreabilidade falhou: ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
    }
  }
}
