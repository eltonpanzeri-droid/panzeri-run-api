import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PhysicalActivityIdentityService } from './physical-activity-identity.service';
import { SessionExecutionLinkService } from './session-execution-link.service';
import { observerKeyOf } from './physical-activity-identity';
import {
  activeDecisions, allPairs, decisionOf, decisionsOfEvidence, HumanDecisionActorRole, HumanDecisionKind, HumanIdentityDecision, sortedPair,
} from './physical-identity-decisions';
import { buildPendingSets, PendingIdentityView, PendingRow, pendingSetKey, toPendingView } from './physical-identity-pending';

const PENDING_ROW_SELECT = {
  id: true, userId: true, provider: true, sport: true, startedAt: true, utcOffsetMinutes: true, durationSec: true, distanceMeters: true,
  providerMetrics: true, physicalEventId: true, physicalIdentityStatus: true, physicalIdentityEvidence: true,
} as const;

// Confirmacao de identidade fisica pelo aluno (excecao) e resolucao/reversao pelo treinador. Camada FINA de orquestracao: nao decide identidade,
// nao classifica e nao reconcilia por conta propria — grava a decisao HUMANA na evidencia de identidade e aciona os servicos existentes
// (PhysicalActivityIdentityService.evaluate, SessionExecutionLinkService.reconcileAffectedByIdentity). A regra principal do produto e' que o
// sistema resolva sozinho sempre que houver evidencia; isto so' atende o que permaneceu ambiguo. Nunca altera sessoes prescritas.
@Injectable()
export class IdentityConfirmationService {
  private readonly logger = new Logger(IdentityConfirmationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: PhysicalActivityIdentityService,
    private readonly link: SessionExecutionLinkService,
  ) {}

  // Linhas necessarias para montar as pendencias do aluno: as observacoes ambiguas + as ligadas a elas por ambiguidade (ex.: fontes ja' em evento
  // confirmado) + os demais membros desses eventos. Somente leitura.
  private async ambiguousRows(client: { activityLog: PrismaService['activityLog'] }, userId: string): Promise<PendingRow[]> {
    const ambiguous = (await client.activityLog.findMany({ where: { userId, physicalIdentityStatus: 'ambiguous' }, select: PENDING_ROW_SELECT, orderBy: { startedAt: 'desc' }, take: 500 })) as PendingRow[];
    const byId = new Map(ambiguous.map((r) => [r.id, r]));
    const referenced = new Set<string>();
    for (const row of ambiguous) {
      const list = (row.physicalIdentityEvidence as { comparisons?: unknown } | null)?.comparisons;
      if (!Array.isArray(list)) continue;
      for (const c of list as Array<{ activityLogId?: unknown; verdict?: unknown }>) if (c.verdict === 'ambiguous' && typeof c.activityLogId === 'string' && !byId.has(c.activityLogId)) referenced.add(c.activityLogId);
    }
    if (referenced.size > 0) {
      const linked = (await client.activityLog.findMany({ where: { userId, id: { in: [...referenced] } }, select: PENDING_ROW_SELECT })) as PendingRow[];
      for (const row of linked) byId.set(row.id, row);
      const eventIds = [...new Set(linked.map((r) => r.physicalEventId).filter((id): id is string => Boolean(id)))];
      if (eventIds.length > 0) {
        const members = (await client.activityLog.findMany({ where: { userId, physicalEventId: { in: eventIds } }, select: PENDING_ROW_SELECT })) as PendingRow[];
        for (const row of members) byId.set(row.id, row);
      }
    }
    return [...byId.values()];
  }

  // Pendencias que o ALUNO pode resolver: so' pares recentes (a pergunta binaria so' e' segura para duas observacoes). Somente leitura.
  async pendingForStudent(userId: string, now: Date = new Date()): Promise<PendingIdentityView[]> {
    const rows = await this.ambiguousRows(this.prisma, userId);
    return buildPendingSets(rows, now).filter((set) => set.studentActionable).map(toPendingView);
  }

  // Trava por aluno (mesma chave da identidade fisica/reconciliacao): respostas concorrentes sao serializadas.
  private async locked<T>(userId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'physical-identity:' + userId}))`;
        return work(tx);
      },
      { timeout: 30_000 },
    );
  }

  // Copia a decisao na evidencia de identidade de cada observacao envolvida (rastreabilidade: quem, quando, quais observacoes).
  private async appendDecision(tx: Prisma.TransactionClient, userId: string, ids: string[], decision: HumanIdentityDecision) {
    const rows = await tx.activityLog.findMany({ where: { userId, id: { in: ids } }, select: { id: true, physicalIdentityEvidence: true } });
    for (const row of rows) {
      const evidence = row.physicalIdentityEvidence && typeof row.physicalIdentityEvidence === 'object' && !Array.isArray(row.physicalIdentityEvidence)
        ? (row.physicalIdentityEvidence as Record<string, unknown>)
        : { version: 1, comparisons: [] };
      const humanDecisions = [...decisionsOfEvidence(evidence), decision];
      await tx.activityLog.update({ where: { id: row.id }, data: { physicalIdentityEvidence: { ...evidence, humanDecisions } as unknown as Prisma.InputJsonValue } });
    }
  }

  // Depois de gravada a decisao: reavalia a identidade das observacoes envolvidas (servico existente) e reconcilia so' o que mudou (D2).
  // Falha aqui NAO desfaz a decisao (ja' gravada): a proxima avaliacao de identidade a aplica; o retorno informa reevaluated=false.
  private async reevaluateAndReconcile(ids: string[]): Promise<boolean> {
    const affected = new Set<string>();
    let ok = true;
    for (const id of ids) {
      const result = await this.identity.evaluateSafely(id);
      if (!result) ok = false;
      for (const changed of result?.affectedActivityLogIds ?? []) affected.add(changed);
    }
    // Reconcilia tambem os ids resolvidos: um evento cuja classificacao ficou preservada por ambiguidade pode nao ter mudado de estado de identidade.
    for (const id of ids) affected.add(id);
    await this.link.reconcileAffectedByIdentity({ affectedActivityLogIds: [...affected] }, null);
    return ok;
  }

  // O ALUNO responde a uma pendencia (so' pares acionaveis). 'Responder depois' nao chama a API.
  async resolveAsStudent(userId: string, body: unknown) {
    const input = body as { activityLogIds?: unknown; decision?: unknown } | null;
    const ids = Array.isArray(input?.activityLogIds) ? [...new Set((input!.activityLogIds as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0))] : [];
    if (ids.length !== 2) throw new BadRequestException('Informe as duas atividades da pendencia.');
    if (input?.decision !== 'same' && input?.decision !== 'distinct') throw new BadRequestException('Resposta invalida.');
    const kind: HumanDecisionKind = input.decision;

    const decision = await this.locked(userId, async (tx) => {
      // Pertencimento: todas as observacoes tem de ser do aluno (nada de outra conta vaza nem e' tocado).
      const owned = await tx.activityLog.findMany({ where: { userId, id: { in: ids } }, select: { id: true } });
      if (owned.length !== ids.length) throw new NotFoundException('Atividade nao encontrada.');
      // A pendencia e' recalculada DENTRO da trava: resposta repetida, concorrente ou sobre algo ja' resolvido nao encontra mais a pendencia.
      const sets = buildPendingSets(await this.ambiguousRows(tx, userId), new Date());
      const set = sets.find((s) => s.key === pendingSetKey(ids));
      if (!set) throw new ConflictException('Esta pendencia ja foi resolvida ou mudou. Atualize a tela.');
      if (!set.studentActionable) throw new ConflictException('Esta atividade sera analisada pelo treinador.');
      const created = decisionOf(allPairs(ids), { id: randomUUID(), kind, actorRole: 'student', actorId: userId, decidedAt: new Date().toISOString(), note: null });
      await this.appendDecision(tx, userId, ids, created);
      return created;
    });
    const reevaluated = await this.reevaluateAndReconcile(ids);
    return { status: 'resolved' as const, decision: kind, decisionId: decision.id, activityLogIds: ids.sort(), reevaluated };
  }

  // O TREINADOR resolve (qualquer tamanho de conjunto). 'same': todo o conjunto e' uma execucao so'. 'distinct': ESTA observacao e' diferente das demais
  // do conjunto (as demais seguem sendo avaliadas entre si). Nunca cria/move/altera sessoes prescritas.
  async resolveAsCoach(studentId: string, coach: { id: string }, activityLogId: string, kind: HumanDecisionKind, note?: string | null) {
    if (kind !== 'same' && kind !== 'distinct') throw new BadRequestException('Decisao invalida.');
    const { decision, memberIds } = await this.locked(studentId, async (tx) => {
      const sets = buildPendingSets(await this.ambiguousRows(tx, studentId), new Date());
      const set = sets.find((s) => s.members.some((m) => m.id === activityLogId));
      if (!set) throw new BadRequestException('Esta atividade nao esta com identidade ambigua pendente.');
      const memberIds = set.members.map((m) => m.id);
      const pairs = kind === 'same' ? allPairs(memberIds) : memberIds.filter((id) => id !== activityLogId).map((id) => sortedPair(activityLogId, id));
      const created = decisionOf(pairs, { id: randomUUID(), kind, actorRole: 'coach', actorId: coach.id, decidedAt: new Date().toISOString(), note: note ?? null });
      await this.appendDecision(tx, studentId, memberIds, created);
      return { decision: created, memberIds };
    });
    const reevaluated = await this.reevaluateAndReconcile(memberIds);
    return { status: 'resolved' as const, decision: kind, decisionId: decision.id, activityLogIds: [...memberIds].sort(), reevaluated };
  }

  // O TREINADOR reverte uma decisao humana ativa (do aluno ou dele) que envolve a observacao. Nada e' apagado: a decisao fica 'reverted' (quem/quando).
  async revertAsCoach(studentId: string, coach: { id: string }, activityLogId: string) {
    const { revertedIds, involved } = await this.locked(studentId, async (tx) => {
      const row = await tx.activityLog.findFirst({ where: { id: activityLogId, userId: studentId }, select: { id: true, physicalIdentityEvidence: true } });
      if (!row) throw new NotFoundException('Atividade nao encontrada.');
      const toRevert = activeDecisions(decisionsOfEvidence(row.physicalIdentityEvidence));
      if (toRevert.length === 0) throw new BadRequestException('Nao ha decisao humana ativa nesta atividade.');
      const revertIds = new Set(toRevert.map((d) => d.id));
      const involvedIds = [...new Set(toRevert.flatMap((d) => d.observationIds))];
      const rows = await tx.activityLog.findMany({ where: { userId: studentId, id: { in: involvedIds } }, select: { id: true, physicalIdentityEvidence: true } });
      const revertedAt = new Date().toISOString();
      for (const r of rows) {
        const evidence = (r.physicalIdentityEvidence ?? { version: 1, comparisons: [] }) as Record<string, unknown>;
        const humanDecisions = decisionsOfEvidence(evidence).map((d) => (revertIds.has(d.id) && d.status === 'active'
          ? { ...d, status: 'reverted' as const, revertedAt, revertedBy: { role: 'coach' as HumanDecisionActorRole, id: coach.id } }
          : d));
        await tx.activityLog.update({ where: { id: r.id }, data: { physicalIdentityEvidence: { ...evidence, humanDecisions } as unknown as Prisma.InputJsonValue } });
      }
      return { revertedIds: [...revertIds], involved: involvedIds };
    });
    const reevaluated = await this.reevaluateAndReconcile(involved);
    const normalized = await this.link.normalizeAmbiguousCluster(involved).catch((error) => {
      this.logger.warn(`Falha ao normalizar o conjunto apos reverter decisao: ${error instanceof Error ? error.message : String(error)}`);
      return { cleared: [] as string[] };
    });
    return { status: 'reverted' as const, decisionIds: revertedIds, activityLogIds: [...involved].sort(), reevaluated, cleared: normalized.cleared };
  }

  // Indicadores minimos de qualidade da identidade fisica, a partir dos dados ja' gravados (sem instrumentacao nova alem das proprias decisoes).
  // 'requestedToStudents' = pendencias abertas e acionaveis pelo aluno + as ja' respondidas por alunos (nao ha registro de "exibicao").
  async quality(days = 90, now: Date = new Date()) {
    const since = new Date(now.getTime() - Math.max(1, Math.min(days, 365)) * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.activityLog.findMany({
      where: { startedAt: { gte: since }, physicalIdentityStatus: { not: null } },
      select: { ...PENDING_ROW_SELECT, physicalEventId: true },
      take: 20000,
    });
    const typed = rows as Array<PendingRow & { physicalEventId: string | null }>;
    const byStatus = { matched: 0, unique: 0, ambiguous: 0 };
    const events = new Set<string>();
    for (const row of typed) {
      if (row.physicalIdentityStatus === 'matched') { byStatus.matched += 1; if (row.physicalEventId) events.add(row.physicalEventId); }
      else if (row.physicalIdentityStatus === 'unique') byStatus.unique += 1;
      else if (row.physicalIdentityStatus === 'ambiguous') byStatus.ambiguous += 1;
    }
    const byUser = new Map<string, PendingRow[]>();
    for (const row of typed) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
    let pendingStudent = 0;
    let pendingCoachOnly = 0;
    const combos = new Map<string, number>();
    for (const userRows of byUser.values()) {
      for (const set of buildPendingSets(userRows, now)) {
        if (set.studentActionable) pendingStudent += 1; else pendingCoachOnly += 1;
        const combo = set.members.map((m) => observerKeyOf(m.provider, m.providerMetrics)).sort().join(' + ');
        combos.set(combo, (combos.get(combo) ?? 0) + 1);
      }
    }
    const decisions = new Map<string, HumanIdentityDecision>();
    for (const row of typed) for (const d of decisionsOfEvidence(row.physicalIdentityEvidence)) if (!decisions.has(d.id)) decisions.set(d.id, d);
    const all = [...decisions.values()];
    const count = (pred: (d: HumanIdentityDecision) => boolean) => all.filter(pred).length;
    const answeredByStudents = count((d) => d.actorRole === 'student');
    return {
      windowDays: Math.round((now.getTime() - since.getTime()) / 86400000),
      observations: { ...byStatus, total: typed.length },
      autoResolved: { matchedEvents: events.size, uniqueActivities: byStatus.unique },
      ambiguous: { observations: byStatus.ambiguous, openSets: pendingStudent + pendingCoachOnly, studentActionable: pendingStudent, coachOnly: pendingCoachOnly },
      confirmations: {
        requestedToStudents: pendingStudent + answeredByStudents,
        answeredByStudents,
        answeredByStudentsSame: count((d) => d.actorRole === 'student' && d.kind === 'same'),
        answeredByStudentsDistinct: count((d) => d.actorRole === 'student' && d.kind === 'distinct'),
        resolvedByCoaches: count((d) => d.actorRole === 'coach'),
        reverted: count((d) => d.status === 'reverted'),
        suspendedByNewEvidence: count((d) => d.status === 'active' && d.state === 'suspended'),
      },
      topAmbiguousSourceCombinations: [...combos.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10).map(([combination, sets]) => ({ combination, sets })),
    };
  }
}
