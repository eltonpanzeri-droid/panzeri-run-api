import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import {
  AgentCallTrace, buildAgentInputRecord, buildSessionDecisions, buildSessionVersions, buildWeekDecision, DecisionDraft, describeSessionForTrace, EvidenceItem,
  parseRetentionMonths, retentionCutoff, SessionForTrace, snapshotOfSession, TRACE_SCHEMA_VERSION,
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
  // Provedores de dispositivo cujos dados alimentaram agregados do prompt (proveniencia, usada na exclusao de dados de um provedor).
  sourceProviders: string[];
  recommendation: string;
  rationale: string[];
  safetyAdjustment: boolean;
  routineMismatch?: string | null;
}

export interface PersistDayParams {
  userId: string;
  planId: string;
  methodologyVersion: string;
  // Estado da sessao DEPOIS da regeneracao e ANTES dela (ambos lidos na mesma transacao que reescreve o treino).
  session: SessionForTrace;
  previous: SessionForTrace;
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
        sourceProviders: p.sourceProviders as unknown as Prisma.InputJsonValue,
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
        // O prompt de regeneracao de UM dia nao leva agregados de dispositivo: proveniencia conhecida e vazia.
        sourceProviders: [] as unknown as Prisma.InputJsonValue,
      },
    });
    const [decision] = buildSessionDecisions({ sessions: [p.session], previousWeek: null });
    // PRESERVA a prescricao anterior por inteiro (nao so o resumo) e diz se ela era a ultima versao registrada ou se houve mudanca fora da trilha.
    const lastVersion = await tx.prescriptionDecision.findFirst({
      where: { userId: p.userId, sessionId: p.session.id, kind: 'session' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, sessionSnapshotSha256: true },
    });
    const previous = snapshotOfSession(p.previous);
    decision.changeFromPrevious = {
      previousSummary: describeSessionForTrace(p.previous),
      previousSnapshot: previous.snapshot,
      previousSnapshotSha256: previous.sha256,
      previousDecisionId: lastVersion?.id ?? null,
      previousVersionTraced: lastVersion !== null,
      untracedChangeSincePreviousVersion: lastVersion ? lastVersion.sessionSnapshotSha256 !== previous.sha256 : null,
      newSummary: describeSessionForTrace(p.session),
    };
    await tx.prescriptionDecision.createMany({ data: [this.toRow(pkg.id, p.userId, p.planId, decision)] });
    return { packageId: pkg.id };
  }

  private toRow(packageId: string, userId: string, planId: string, d: DecisionDraft): Prisma.PrescriptionDecisionCreateManyInput {
    return {
      packageId, userId, planId, sessionId: d.sessionId, kind: d.kind, weekday: d.weekday, modality: d.modality, summary: d.summary,
      changeFromPrevious: d.changeFromPrevious === null ? Prisma.DbNull : (d.changeFromPrevious as Prisma.InputJsonValue),
      rationale: d.rationale === null ? Prisma.DbNull : (d.rationale as Prisma.InputJsonValue),
      sessionSnapshot: d.sessionSnapshot === null ? Prisma.DbNull : (d.sessionSnapshot as Prisma.InputJsonValue),
      sessionSnapshotSha256: d.sessionSnapshotSha256,
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
    // Versoes de cada sessao citada: TODAS as decisoes da sessao (em qualquer pacote), cada uma com a sua vigencia e o resultado ocorrido nela.
    const sessionIds = query.sessionId
      ? [query.sessionId]
      : [...new Set(packages.flatMap((pkg) => pkg.decisions.map((d) => d.sessionId).filter((id): id is string => !!id)))];
    const versionsBySession = new Map<string, ReturnType<typeof buildSessionVersions>>();
    for (const sessionId of sessionIds) versionsBySession.set(sessionId, await this.versionsOf(userId, sessionId));

    const result = [];
    for (const pkg of packages) {
      const { agentInput, ...rest } = pkg;
      const decisions = pkg.decisions.map((decision) => {
        const versions = decision.sessionId ? versionsBySession.get(decision.sessionId)?.versions : undefined;
        // outcome = SO' o que ocorreu na vigencia DESTA decisao (nao o estado atual da sessao).
        const outcome = versions?.find((version) => version.decisionId === decision.id)?.outcome ?? null;
        return { ...decision, outcome };
      });
      result.push({
        ...rest,
        decisions,
        agentInputAvailable: agentInput !== null,
        ...(query.includeAgentInput ? { agentInput: this.withParsedInput(agentInput) } : {}),
      });
    }
    const sessions = sessionIds.map((sessionId) => ({ sessionId, ...versionsBySession.get(sessionId)! }));
    return { userId, packages: result, sessions };
  }

  // Todas as versoes registradas de UMA sessao (decisoes em ordem) + a execucao observada, repartida por vigencia.
  async versionsOf(userId: string, sessionId: string) {
    const decisions = await this.prisma.prescriptionDecision.findMany({
      where: { userId, sessionId, kind: 'session' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, packageId: true, createdAt: true, summary: true, sessionSnapshot: true, sessionSnapshotSha256: true, changeFromPrevious: true, package: { select: { kind: true } } },
    });
    const execution = await this.executionOf(userId, sessionId);
    return buildSessionVersions(decisions.map((d) => ({
      decisionId: d.id, packageId: d.packageId, packageKind: d.package.kind, createdAt: d.createdAt, summary: d.summary, sessionSnapshot: d.sessionSnapshot,
      sessionSnapshotSha256: d.sessionSnapshotSha256, changeFromPrevious: d.changeFromPrevious,
    })), execution);
  }

  // Conveniencia de leitura: cada chamada ganha userInput (o prompt parseado). O texto exato continua em userPrompt.
  private withParsedInput(agentInput: Prisma.JsonValue | null) {
    const calls = (agentInput as { calls?: Array<{ userPrompt?: string }> } | null)?.calls;
    if (!Array.isArray(calls)) return agentInput;
    return { calls: calls.map((call) => { let userInput: unknown = null; try { userInput = JSON.parse(call.userPrompt ?? ''); } catch { /* texto nao-JSON */ } return { ...call, userInput }; }) };
  }

  // Execucao observada de uma sessao (registro do aluno + atividade objetiva canonica do evento fisico), COM os instantes que permitem
  // atribui-la a uma versao: createdAt do registro e startedAt da atividade. Sessao inexistente (apagada) => sem execucao.
  async executionOf(userId: string, sessionId: string) {
    const session = await this.prisma.trainingSession.findFirst({
      where: { id: sessionId, userId },
      select: {
        id: true, createdAt: true, prescriptionHistory: true,
        completion: { select: { status: true, completedAt: true, durationMin: true, distanceKm: true, avgPaceSecondsKm: true, avgHeartRate: true, perceivedEffort: true, painFlag: true } },
        executionLinks: { where: { status: 'active' }, select: { activityLog: true } },
      },
    });
    if (!session) return { sessionCreatedAt: null, completion: null, coachEditsAfterRegistration: 0, objectiveActivities: [] };
    const picks = await pickCanonicalPerEvent(session.executionLinks.map((link) => link.activityLog), (ids) => this.prisma.activityLog.findMany({ where: { userId, id: { in: ids } } }));
    const objectiveActivities = picks.map((pick) => ({
      activityLogId: pick.row.id, provider: pick.row.provider, startedAt: pick.row.startedAt,
      distanceKm: pick.row.distanceMeters != null ? pick.row.distanceMeters / 1000 : null,
      durationMin: pick.row.durationSec != null ? pick.row.durationSec / 60 : null,
      avgHeartRateBpm: pick.row.avgHeartRateBpm,
    }));
    return {
      sessionCreatedAt: session.createdAt, completion: session.completion, objectiveActivities,
      coachEditsAfterRegistration: session.completion && Array.isArray(session.prescriptionHistory) ? session.prescriptionHistory.length : 0,
    };
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
