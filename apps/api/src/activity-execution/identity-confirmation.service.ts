import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PhysicalActivityIdentityService } from './physical-activity-identity.service';
import { SessionExecutionLinkService } from './session-execution-link.service';
import { observerKeyOf } from './physical-activity-identity';
import {
  activeDecisions, allPairs, decisionOf, decisionsOfEvidence, HumanDecisionActorRole, HumanDecisionKind, HumanIdentityDecision, isUnprocessed, pairKey, sortedPair,
} from './physical-identity-decisions';
import { buildPendingSets, PendingIdentityView, PendingRow, pendingSetKey, toPendingView, toProcessingView } from './physical-identity-pending';

// Decisoes (de qualquer status) ainda sem o carimbo de efeito concluido, sem repeticao, nas linhas dadas.
function unprocessedDecisions(rows: Array<{ physicalIdentityEvidence?: unknown }>): HumanIdentityDecision[] {
  const byId = new Map<string, HumanIdentityDecision>();
  for (const row of rows) for (const d of decisionsOfEvidence(row.physicalIdentityEvidence)) if (isUnprocessed(d) && !byId.has(d.id)) byId.set(d.id, d);
  return [...byId.values()];
}

// Maximo de decisoes reprocessadas por leitura (limita o trabalho de uma abertura de tela).
const MAX_HEAL_PER_READ = 3;

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

  // Linhas do aluno que carregam alguma decisao humana na evidencia, em QUALQUER estado de identidade (apos aplicar a decisao a linha deixa de ser
  // 'ambiguous'). Filtro no proprio banco (JSON path): so' linhas com decisoes sao lidas.
  private async rowsWithDecisions(client: { activityLog: PrismaService['activityLog'] }, userId: string): Promise<PendingRow[]> {
    return (await client.activityLog.findMany({
      where: { userId, physicalIdentityEvidence: { path: ['humanDecisions'], not: Prisma.JsonNull } },
      select: PENDING_ROW_SELECT,
      orderBy: { startedAt: 'desc' },
      take: 200,
    })) as PendingRow[];
  }

  // Pendencias que o ALUNO pode resolver: so' pares recentes (a pergunta binaria so' e' segura para duas observacoes). 'processing' = resposta ja'
  // registrada cujo efeito ainda nao foi concluido. Ao ler, REPROCESSA sozinha as decisoes sem carimbo (idempotente; sem fila nem cron): uma falha
  // transitoria se recupera na proxima abertura da tela, sem depender de uma nova atividade chegar.
  async pendingForStudent(userId: string, now: Date = new Date()): Promise<PendingIdentityView[]> {
    let rows = await this.ambiguousRows(this.prisma, userId);
    let decisionRows = await this.rowsWithDecisions(this.prisma, userId);
    const stuck = unprocessedDecisions(decisionRows);
    if (stuck.length > 0) {
      await this.healDecisions(userId, stuck);
      rows = await this.ambiguousRows(this.prisma, userId);
      decisionRows = await this.rowsWithDecisions(this.prisma, userId);
    }
    const pending = buildPendingSets(rows, now).filter((set) => set.studentActionable).map(toPendingView);
    const processing: PendingIdentityView[] = [];
    for (const d of unprocessedDecisions(decisionRows).filter((x) => x.status === 'active')) {
      const view = toProcessingView(d.observationIds, decisionRows);
      if (view && !processing.some((p) => p.key === view.key)) processing.push(view);
    }
    return [...pending, ...processing];
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

  // Aplica uma transformacao as copias das decisoes indicadas na evidencia de cada observacao envolvida (todas as copias mudam juntas).
  private async patchDecisions(tx: Prisma.TransactionClient, userId: string, ids: string[], decisionIds: Set<string>, patch: (d: HumanIdentityDecision) => HumanIdentityDecision) {
    const rows = await tx.activityLog.findMany({ where: { userId, id: { in: ids } }, select: { id: true, physicalIdentityEvidence: true } });
    for (const row of rows) {
      const evidence = (row.physicalIdentityEvidence && typeof row.physicalIdentityEvidence === 'object' && !Array.isArray(row.physicalIdentityEvidence)
        ? row.physicalIdentityEvidence
        : { version: 1, comparisons: [] }) as Record<string, unknown>;
      const humanDecisions = decisionsOfEvidence(evidence).map((d) => (decisionIds.has(d.id) ? patch(d) : d));
      await tx.activityLog.update({ where: { id: row.id }, data: { physicalIdentityEvidence: { ...evidence, humanDecisions } as unknown as Prisma.InputJsonValue } });
    }
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

  // Reavalia a identidade das observacoes envolvidas (servico existente) e reconcilia so' o que mudou (D2). true = identidade E reconciliacao concluidas.
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
    const reconciled = await this.link.reconcileAffectedByIdentity({ affectedActivityLogIds: [...affected] }, null);
    return ok && reconciled !== false;
  }

  // Conclui o EFEITO de uma decisao (criacao ou reversao) e SO' ENTAO grava o carimbo processedAt: identidade reavaliada + contabilizacao reconciliada
  // (na reversao, tambem volta a uma so' execucao contando). Idempotente: repetir nao duplica nada. Sem o carimbo a decisao segue "em processamento".
  private async processDecision(userId: string, decision: Pick<HumanIdentityDecision, 'id' | 'status' | 'observationIds'> & Partial<Pick<HumanIdentityDecision, 'actorRole' | 'actorId'>>): Promise<{ ok: boolean; cleared: string[] }> {
    let cleared: string[] = [];
    const since = new Date();
    // Pos-correcao centralizado: a decisao humana pode ter refeito/desfeito vinculos (inclusive ao normalizar o conjunto na reversao); as analises das
    // sessoes afetadas sao recalculadas ao fim, qualquer que seja o desfecho (nunca lanca).
    try {
      const ok = await this.reevaluateAndReconcile(decision.observationIds);
      if (!ok) return { ok: false, cleared };
      if (decision.status === 'reverted') {
        try {
          cleared = (await this.link.normalizeAmbiguousCluster(decision.observationIds)).cleared;
        } catch (error) {
          this.logger.warn(`Falha ao normalizar o conjunto apos reverter decisao: ${error instanceof Error ? error.message : String(error)}`);
          return { ok: false, cleared };
        }
      }
    } finally {
      await this.link.recomputeAfterCorrection(userId, since, {
        kind: 'identity_correction', origin: decision.actorRole === 'coach' ? 'coach' : decision.actorRole === 'student' ? 'student' : 'system', actorId: decision.actorId ?? null, activityLogIds: decision.observationIds,
      });
    }
    const processedAt = new Date().toISOString();
    await this.locked(userId, (tx) => this.patchDecisions(tx, userId, decision.observationIds, new Set([decision.id]), (d) => ({ ...d, processedAt })));
    return { ok: true, cleared };
  }

  // Reprocessa decisoes sem carimbo (melhor esforco, nunca lanca): usado nas leituras para recuperar falhas transitorias sozinho.
  private async healDecisions(userId: string, decisions: HumanIdentityDecision[]): Promise<void> {
    for (const decision of decisions.slice(0, MAX_HEAL_PER_READ)) {
      try {
        await this.processDecision(userId, decision);
      } catch (error) {
        this.logger.warn(`Falha ao reprocessar a decisao ${decision.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Reprocessa, para o treinador, as decisoes ainda sem carimbo de um aluno (usado ao listar as atividades). Devolve true se algo foi reprocessado.
  async healForCoachView(studentId: string, rows: Array<{ physicalIdentityEvidence?: unknown }>): Promise<boolean> {
    const stuck = unprocessedDecisions(rows);
    if (stuck.length === 0) return false;
    await this.healDecisions(studentId, stuck);
    return true;
  }

  // O ALUNO responde a uma pendencia (so' pares acionaveis). 'Responder depois' nao chama a API. Resposta repetida do MESMO tipo enquanto o efeito ainda nao
  // foi concluido reaproveita a decisao (idempotente, sem duplicar) e tenta concluir; qualquer outra resposta a algo ja' resolvido recebe 409.
  async resolveAsStudent(userId: string, body: unknown) {
    const input = body as { activityLogIds?: unknown; decision?: unknown } | null;
    const ids = Array.isArray(input?.activityLogIds) ? [...new Set((input!.activityLogIds as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0))] : [];
    if (ids.length !== 2) throw new BadRequestException('Informe as duas atividades da pendencia.');
    if (input?.decision !== 'same' && input?.decision !== 'distinct') throw new BadRequestException('Resposta invalida.');
    const kind: HumanDecisionKind = input.decision;

    const { decision, retried } = await this.locked(userId, async (tx) => {
      // Pertencimento: todas as observacoes tem de ser do aluno (nada de outra conta vaza nem e' tocado).
      const owned = await tx.activityLog.findMany({ where: { userId, id: { in: ids } }, select: { id: true } });
      if (owned.length !== ids.length) throw new NotFoundException('Atividade nao encontrada.');
      // A pendencia e' recalculada DENTRO da trava: resposta repetida, concorrente ou sobre algo ja' resolvido nao encontra mais a pendencia.
      const rows = await this.ambiguousRows(tx, userId);
      const set = buildPendingSets(rows, new Date()).find((s) => s.key === pendingSetKey(ids));
      if (!set) {
        const key = pairKey(ids[0], ids[1]);
        const sameAnswer = unprocessedDecisions(await this.rowsWithDecisions(tx, userId)).find((d) => d.status === 'active' && d.actorRole === 'student' && d.kind === kind && d.pairs.some(([a, b]) => pairKey(a, b) === key));
        if (sameAnswer) return { decision: sameAnswer, retried: true };
        throw new ConflictException('Esta pendencia ja foi resolvida ou mudou. Atualize a tela.');
      }
      if (!set.studentActionable) throw new ConflictException('Esta atividade sera analisada pelo treinador.');
      const created = decisionOf(allPairs(ids), { id: randomUUID(), kind, actorRole: 'student', actorId: userId, decidedAt: new Date().toISOString(), note: null });
      await this.appendDecision(tx, userId, ids, created);
      return { decision: created, retried: false };
    });
    const { ok } = await this.processDecision(userId, decision);
    // applied=false: a resposta esta registrada mas as estatisticas ainda NAO foram atualizadas (o app nao pode dizer o contrario); conclui sozinho depois.
    return { status: 'resolved' as const, decision: kind, decisionId: decision.id, activityLogIds: [...ids].sort(), reevaluated: ok, applied: ok, retried };
  }

  // O aluno declara que DUAS atividades suas sao a mesma execucao (registro duplicado), mesmo sem pendencia aberta (Conciliacao, 30/10/2026). Mesmo mecanismo de
  // decisao humana 'same' (nada e' apagado; a execucao passa a contar uma vez, pela observacao canonica). Se a avaliacao de identidade mantiver as duas separadas
  // (ex.: modalidades incompativeis ou horarios sem sobreposicao), a decisao fica registrada mas 'applied' vem false e o app diz isso, sem fingir que juntou.
  async declareSameAsStudent(userId: string, activityLogIds: unknown) {
    const ids = Array.isArray(activityLogIds) ? [...new Set((activityLogIds as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0))] : [];
    if (ids.length !== 2) throw new BadRequestException('Informe as duas atividades.');
    const { decision, retried } = await this.locked(userId, async (tx) => {
      const owned = await tx.activityLog.findMany({ where: { userId, id: { in: ids } }, select: { id: true } });
      if (owned.length !== ids.length) throw new NotFoundException('Atividade nao encontrada.');
      const key = pairKey(ids[0], ids[1]);
      const already = unprocessedDecisions(await this.rowsWithDecisions(tx, userId)).find((d) => d.status === 'active' && d.actorRole === 'student' && d.kind === 'same' && d.pairs.some(([a, b]) => pairKey(a, b) === key));
      if (already) return { decision: already, retried: true };
      const created = decisionOf(allPairs(ids), { id: randomUUID(), kind: 'same', actorRole: 'student', actorId: userId, decidedAt: new Date().toISOString(), note: 'student_declared_duplicate' });
      await this.appendDecision(tx, userId, ids, created);
      return { decision: created, retried: false };
    });
    const { ok } = await this.processDecision(userId, decision);
    return { status: 'resolved' as const, decision: 'same' as const, decisionId: decision.id, activityLogIds: [...ids].sort(), reevaluated: ok, applied: ok, retried };
  }

  // O TREINADOR resolve (qualquer tamanho de conjunto). 'same': todo o conjunto e' uma execucao so'. 'distinct': ESTA observacao e' diferente das demais
  // do conjunto (as demais seguem sendo avaliadas entre si). Nunca cria/move/altera sessoes prescritas. Repetir enquanto o efeito nao foi concluido e' idempotente.
  async resolveAsCoach(studentId: string, coach: { id: string }, activityLogId: string, kind: HumanDecisionKind, note?: string | null) {
    if (kind !== 'same' && kind !== 'distinct') throw new BadRequestException('Decisao invalida.');
    const { decision, retried } = await this.locked(studentId, async (tx) => {
      const rows = await this.ambiguousRows(tx, studentId);
      const set = buildPendingSets(rows, new Date()).find((s) => s.members.some((m) => m.id === activityLogId));
      if (!set) {
        const sameAnswer = unprocessedDecisions(await this.rowsWithDecisions(tx, studentId)).find((d) => d.status === 'active' && d.actorRole === 'coach' && d.kind === kind && d.observationIds.includes(activityLogId));
        if (sameAnswer) return { decision: sameAnswer, retried: true };
        throw new BadRequestException('Esta atividade nao esta com identidade ambigua pendente.');
      }
      const memberIds = set.members.map((m) => m.id);
      const pairs = kind === 'same' ? allPairs(memberIds) : memberIds.filter((id) => id !== activityLogId).map((id) => sortedPair(activityLogId, id));
      const created = decisionOf(pairs, { id: randomUUID(), kind, actorRole: 'coach', actorId: coach.id, decidedAt: new Date().toISOString(), note: note ?? null });
      await this.appendDecision(tx, studentId, memberIds, created);
      return { decision: created, retried: false };
    });
    const { ok } = await this.processDecision(studentId, decision);
    return { status: 'resolved' as const, decision: kind, decisionId: decision.id, activityLogIds: [...decision.observationIds].sort(), reevaluated: ok, applied: ok, retried };
  }

  // O TREINADOR reverte uma decisao humana ativa (do aluno ou dele) que envolve a observacao. Nada e' apagado: a decisao fica 'reverted' (quem/quando).
  // BLOQUEIA (409, sem alterar nada) quando a reversao deixaria duas execucoes contando em duplicidade por haver feedback do aluno/sessao materializada/
  // decisao manual nas duas (nao se des-conta em silencio o que o aluno registrou). Repetir uma reversao ainda nao concluida e' idempotente.
  async revertAsCoach(studentId: string, coach: { id: string }, activityLogId: string) {
    const { decisions, involved } = await this.locked(studentId, async (tx) => {
      const row = await tx.activityLog.findFirst({ where: { id: activityLogId, userId: studentId }, select: { id: true, physicalIdentityEvidence: true } });
      if (!row) throw new NotFoundException('Atividade nao encontrada.');
      const all = decisionsOfEvidence(row.physicalIdentityEvidence);
      const toRevert = activeDecisions(all);
      if (toRevert.length === 0) {
        // Sem decisao ativa: so' faz sentido retomar uma reversao anterior que nao terminou (idempotencia); senao nao ha o que reverter.
        const unfinished = all.filter((d) => d.status === 'reverted' && isUnprocessed(d));
        if (unfinished.length === 0) throw new BadRequestException('Nao ha decisao humana ativa nesta atividade.');
        return { decisions: unfinished, involved: [...new Set(unfinished.flatMap((d) => d.observationIds))] };
      }
      const revertIds = new Set(toRevert.map((d) => d.id));
      const involvedIds = [...new Set(toRevert.flatMap((d) => d.observationIds))];
      // Pre-checagem (somente leitura, ANTES de gravar qualquer coisa): duas execucoes que voltariam a contar sem poder des-contar nenhuma.
      const preview = await new SessionExecutionLinkService(tx as never).previewUncount(involvedIds);
      if (preview.conflict) {
        throw new ConflictException({
          message: 'Nao e possivel reverter esta decisao agora: as duas atividades ja tem registros do aluno (feedback, sessao do treino ou decisao manual) e voltariam a contar em duplicidade. Nada foi alterado. Resolva antes o registro de uma delas (ex.: vinculo/feedback) e tente de novo.',
          code: 'revert_blocked_by_student_records',
          activityLogIds: preview.protectedIds,
        });
      }
      const revertedAt = new Date().toISOString();
      await this.patchDecisions(tx, studentId, involvedIds, revertIds, (d) => (d.status === 'active'
        ? { ...d, status: 'reverted' as const, revertedAt, revertedBy: { role: 'coach' as HumanDecisionActorRole, id: coach.id }, processedAt: null }
        : d));
      return { decisions: toRevert.map((d) => ({ ...d, status: 'reverted' as const })), involved: involvedIds };
    });
    let ok = true;
    let cleared: string[] = [];
    for (const decision of decisions) {
      const result = await this.processDecision(studentId, decision);
      ok = ok && result.ok;
      cleared = [...new Set([...cleared, ...result.cleared])];
    }
    return { status: 'reverted' as const, decisionIds: decisions.map((d) => d.id), activityLogIds: [...involved].sort(), reevaluated: ok, applied: ok, cleared };
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
        awaitingReprocess: count((d) => isUnprocessed(d)), // decisoes registradas cujo efeito ainda nao foi concluido (reprocessadas sozinhas nas leituras)
        suspendedByNewEvidence: count((d) => d.status === 'active' && d.state === 'suspended'),
      },
      topAmbiguousSourceCombinations: [...combos.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10).map(([combination, sets]) => ({ combination, sets })),
    };
  }
}
