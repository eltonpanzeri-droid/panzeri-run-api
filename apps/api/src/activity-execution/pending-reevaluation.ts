import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutionAnalysisService } from './execution-analysis.service';

// Reavaliacao PENDENTE (15/10/2026): estado DURAVEL do que ainda precisa ser atualizado depois de uma correcao (analises de execucao por sessao e/ou medalhas).
// Substitui a fila em memoria: uma linha por aluno em CorrectionReevaluation sobrevive a reinicio do servidor e e' retomada por (1) a propria requisicao da
// correcao (tentativa sincrona limitada), (2) uma continuacao imediata em segundo plano, (3) qualquer leitura de medalhas/indicadores afetados (settle) e
// (4) o varredor periodico. Nada aqui gera treino nem aciona agente: so' recalculo deterministico e reavaliacao de medalhas.
//
// Ordem (sem corrida): a correcao e' gravada -> ganchos marcam o que mudou (markPending, ainda ANTES de qualquer processamento) -> processPending reivindica a
// linha (lease por CAS) e processa -> so' remove a linha se NADA foi marcado enquanto processava (version igual); senao a linha fica e e' reprocessada
// (idempotente). Enquanto a linha existe, quem le deve tratar os dados afetados como provisorios (getPendingView).

export const DEFAULT_SYNC_LIMIT = 25;
export const BACKGROUND_LIMIT = 200;
const LEASE_MS = 2 * 60_000;
const MAX_ROUNDS = 3;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

const logger = new Logger('PendingReevaluation');

export interface MedalScope {
  weeks: string[];
  months: string[];
  countsChanged: boolean;
  // Exclusao de dados do provedor: ausencia de dado nao e' prova — a reavaliacao nunca revoga nem ajusta por isso.
  absenceOfData: boolean;
  categories: string[];
  causes: Array<Record<string, unknown>>;
}

export interface PendingState {
  userId: string;
  version: number;
  dirtySince: Date;
  analysisSessionIds: string[];
  forceSessionIds: string[];
  medalsPending: boolean;
  medalScope: MedalScope | null;
  leaseUntil: Date | null;
  attempts: number;
  lastAttemptAt: Date | null;
  lastError: string | null;
}

export interface MarkInput {
  analysisSessionIds?: string[];
  forceSessionIds?: string[];
  medals?: Partial<MedalScope> & { categories: string[] };
}

export interface MedalProcessorResult {
  // true = reavaliacao concluida (nenhum conflito); false = ficou algo para tentar de novo.
  complete: boolean;
  error?: string;
}
export type MedalProcessor = (userId: string, scope: MedalScope) => Promise<MedalProcessorResult>;

let medalProcessor: MedalProcessor | null = null;
/** O modulo de medalhas registra aqui como reavaliar (evita dependencia circular). */
export function registerMedalProcessor(processor: MedalProcessor | null): void {
  medalProcessor = processor;
}

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
const union = (a: string[], b: string[] = []) => [...new Set([...a, ...b])];

function toScope(value: unknown): MedalScope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return {
    weeks: asStrings(v.weeks), months: asStrings(v.months), countsChanged: v.countsChanged === true, absenceOfData: v.absenceOfData === true,
    categories: asStrings(v.categories), causes: Array.isArray(v.causes) ? (v.causes as Array<Record<string, unknown>>) : [],
  };
}

function toState(row: Record<string, any>): PendingState {
  return {
    userId: row.userId, version: row.version, dirtySince: row.dirtySince, analysisSessionIds: asStrings(row.analysisSessionIds), forceSessionIds: asStrings(row.forceSessionIds),
    medalsPending: row.medalsPending === true, medalScope: toScope(row.medalScope), leaseUntil: row.leaseUntil ?? null, attempts: row.attempts ?? 0,
    lastAttemptAt: row.lastAttemptAt ?? null, lastError: row.lastError ?? null,
  };
}

const MAX_CAUSES = 20;
function mergeScope(current: MedalScope | null, incoming: (Partial<MedalScope> & { categories: string[] }) | undefined): MedalScope | null {
  if (!incoming) return current;
  return {
    weeks: union(current?.weeks ?? [], incoming.weeks ?? []).sort(),
    months: union(current?.months ?? [], incoming.months ?? []).sort(),
    countsChanged: (current?.countsChanged ?? false) || incoming.countsChanged === true,
    // conservador: se qualquer causa pendente foi so' ausencia de dado, a reavaliacao inteira nao revoga (nunca revoga por ausencia)
    absenceOfData: (current?.absenceOfData ?? false) || incoming.absenceOfData === true,
    categories: union(current?.categories ?? [], incoming.categories),
    causes: [...(current?.causes ?? []), ...(incoming.causes ?? [])].slice(-MAX_CAUSES),
  };
}

// Trava curta por aluno (so' para ler-e-mesclar a linha de forma atomica; o processamento pesado roda FORA dela).
async function withLock<T>(prisma: PrismaService, userId: string, work: (db: PrismaService) => Promise<T>): Promise<T> {
  if (typeof (prisma as { $transaction?: unknown }).$transaction !== 'function') return work(prisma);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pending-reevaluation:' + userId}))`;
    return work(tx as unknown as PrismaService);
  }, { timeout: 15_000 });
}

/** Registra (ou mescla na linha existente) o que precisa ser reavaliado. Sempre ANTES de processar. Sobe a versao. */
export async function markPending(prisma: PrismaService, userId: string, input: MarkInput): Promise<PendingState> {
  return withLock(prisma, userId, async (db) => {
    const existing = await db.correctionReevaluation.findUnique({ where: { userId } });
    if (!existing) {
      const created = await db.correctionReevaluation.create({
        data: {
          userId, analysisSessionIds: union(input.analysisSessionIds ?? []), forceSessionIds: union(input.forceSessionIds ?? []),
          medalsPending: input.medals != null, medalScope: (mergeScope(null, input.medals) as unknown as object) ?? undefined,
        },
      });
      return toState(created);
    }
    const state = toState(existing);
    const updated = await db.correctionReevaluation.update({
      where: { userId },
      data: {
        version: { increment: 1 },
        analysisSessionIds: union(state.analysisSessionIds, input.analysisSessionIds),
        forceSessionIds: union(state.forceSessionIds, input.forceSessionIds),
        medalsPending: state.medalsPending || input.medals != null,
        medalScope: (mergeScope(state.medalScope, input.medals) as unknown as object) ?? undefined,
        lastError: null,
      },
    });
    return toState(updated);
  });
}

export async function readPending(prisma: PrismaService, userId: string): Promise<PendingState | null> {
  const row = await prisma.correctionReevaluation.findUnique({ where: { userId } });
  return row ? toState(row) : null;
}

export interface PendingView {
  updating: boolean;
  since: Date | null;
  medalCategories: string[];
  analysisSessions: number;
}

/** O que a interface precisa saber para marcar dados como provisorios. */
export function viewOf(state: PendingState | null): PendingView {
  if (!state) return { updating: false, since: null, medalCategories: [], analysisSessions: 0 };
  return {
    updating: state.medalsPending || state.analysisSessionIds.length > 0,
    since: state.dirtySince,
    medalCategories: state.medalsPending ? (state.medalScope?.categories ?? []) : [],
    analysisSessions: state.analysisSessionIds.length,
  };
}

async function analyzeOne(analysis: ExecutionAnalysisService, userId: string, sessionId: string, force: boolean): Promise<boolean> {
  try {
    await analysis.analyzeSession(userId, sessionId, { force });
    return true;
  } catch (error) {
    logger.error(`Recalculo falhou para a sessao ${sessionId} (aluno ${userId}); a linha anterior segue descartada pela leitura e a sessao continua pendente: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export interface ProcessOptions {
  // Quantas sessoes (mais recentes primeiro) sao refeitas nesta chamada; o restante continua na linha.
  syncLimit?: number;
  leaseMs?: number;
}

export interface ProcessResult {
  status: 'idle' | 'busy' | 'done' | 'partial';
  recomputedSessionIds: string[];
  failedSessionIds: string[];
  remainingSessionIds: string[];
  medals: 'none' | 'done' | 'pending';
}

const scheduledUsers = new Set<string>();
const inFlight = new Set<Promise<void>>();

// Continuacao imediata (aceleracao): a DURABILIDADE vem da linha no banco; isto so' evita esperar o varredor.
function scheduleContinuation(prisma: PrismaService, userId: string): void {
  if (scheduledUsers.has(userId)) return;
  scheduledUsers.add(userId);
  const job: Promise<void> = new Promise<void>((resolve) => {
    setImmediate(() => {
      scheduledUsers.delete(userId); // a propria continuacao pode agendar a seguinte
      processPendingReevaluation(prisma, userId, { syncLimit: BACKGROUND_LIMIT })
        .then(() => undefined)
        .catch((error) => logger.error(`Continuacao da reavaliacao (aluno ${userId}) falhou: ${error instanceof Error ? error.message : String(error)}`))
        .finally(resolve);
    });
  });
  inFlight.add(job);
  void job.finally(() => inFlight.delete(job));
}

/** Aguarda as continuacoes em segundo plano, inclusive as encadeadas (testes e encerramento ordenado). */
export async function waitForPendingContinuations(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}

export async function processPendingReevaluation(prisma: PrismaService, userId: string, options: ProcessOptions = {}): Promise<ProcessResult> {
  const result: ProcessResult = { status: 'idle', recomputedSessionIds: [], failedSessionIds: [], remainingSessionIds: [], medals: 'none' };
  const syncLimit = Math.max(0, options.syncLimit ?? DEFAULT_SYNC_LIMIT);
  const analysis = new ExecutionAnalysisService(prisma);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Reivindica a linha (lease por CAS): quem nao conseguir sabe que outro processamento esta em andamento (sem duplicar).
    const now = new Date();
    const claimed = await prisma.correctionReevaluation.updateMany({
      where: { userId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + (options.leaseMs ?? LEASE_MS)), attempts: { increment: 1 }, lastAttemptAt: now },
    });
    const row = await prisma.correctionReevaluation.findUnique({ where: { userId } });
    if (!row) { result.status = round === 0 ? 'idle' : 'done'; return result; }
    if (claimed.count === 0) { result.status = 'busy'; result.remainingSessionIds = asStrings(row.analysisSessionIds); return result; }
    const state = toState(row);

    const recomputedBefore = result.recomputedSessionIds.length;
    // 1) Analises de execucao: so' sessoes que ainda tem fonte (feedback ou vinculo ativo); sem fonte nao ha o que atualizar.
    let remaining: string[] = [];
    let lastError: string | null = null;
    if (state.analysisSessionIds.length > 0) {
      const sessions = await prisma.trainingSession.findMany({
        where: { id: { in: state.analysisSessionIds }, userId },
        select: { id: true, scheduledDate: true, completion: { select: { id: true } }, executionLinks: { where: { status: 'active' }, select: { id: true }, take: 1 } },
      });
      const ordered = sessions.filter((s) => s.completion != null || s.executionLinks.length > 0).sort((a, b) => b.scheduledDate.getTime() - a.scheduledDate.getTime()).map((s) => s.id);
      const force = new Set(state.forceSessionIds);
      const now25 = ordered.slice(0, syncLimit);
      for (const sessionId of now25) {
        if (await analyzeOne(analysis, userId, sessionId, force.has(sessionId))) result.recomputedSessionIds.push(sessionId);
        else { result.failedSessionIds.push(sessionId); lastError = 'falha no recalculo de analise de execucao'; }
      }
      remaining = [...ordered.slice(syncLimit), ...result.failedSessionIds.filter((id) => now25.includes(id))];
    }

    // 2) Medalhas (registradas pelo modulo de medalhas).
    let medalsPending = state.medalsPending;
    if (state.medalsPending && state.medalScope) {
      if (!medalProcessor) { lastError = lastError ?? 'processador de medalhas nao registrado'; }
      else {
        try {
          const done = await medalProcessor(userId, state.medalScope);
          medalsPending = !done.complete;
          if (!done.complete) lastError = done.error ?? 'reavaliacao de medalhas incompleta';
        } catch (error) {
          lastError = `medalhas: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(`Reavaliacao de medalhas falhou (aluno ${userId}): ${lastError}`);
        }
      }
      result.medals = medalsPending ? 'pending' : 'done';
    }

    // 3) Fecha: so' remove a linha se NADA foi marcado enquanto processava e nada ficou pendente.
    const finished = await withLock(prisma, userId, async (db) => {
      const current = await db.correctionReevaluation.findUnique({ where: { userId } });
      if (!current) return 'gone' as const;
      if (current.version !== state.version) {
        await db.correctionReevaluation.update({ where: { userId }, data: { leaseUntil: null } }); // nova marcacao: reprocessa tudo (idempotente)
        return 'changed' as const;
      }
      if (remaining.length === 0 && !medalsPending) {
        await db.correctionReevaluation.deleteMany({ where: { userId, version: state.version } });
        return 'done' as const;
      }
      await db.correctionReevaluation.update({ where: { userId }, data: { analysisSessionIds: remaining, medalsPending, leaseUntil: null, lastError } });
      return 'partial' as const;
    });
    result.remainingSessionIds = remaining;
    if (finished === 'gone' || finished === 'done') { result.status = 'done'; return result; }
    if (finished === 'partial') {
      result.status = 'partial';
      // Continua em segundo plano SO' se houve progresso (evita laco apertado em falha persistente: ai quem retoma e' o varredor, com espera crescente).
      if (result.recomputedSessionIds.length > recomputedBefore) scheduleContinuation(prisma, userId);
      return result;
    }
    // 'changed': nova rodada
  }
  result.status = 'partial';
  scheduleContinuation(prisma, userId); // varias marcacoes seguidas durante o processamento: ainda ha trabalho
  return result;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Leitura consistente: antes de responder, tenta concluir a reavaliacao pendente do aluno dentro de um orcamento de tempo. Devolve o estado que SOBROU (null =
 * nada pendente: o dado lido e' definitivo). Nunca lanca.
 */
export async function settlePendingReevaluation(prisma: PrismaService, userId: string, budgetMs = 4000): Promise<PendingState | null> {
  try {
    const state = await readPending(prisma, userId);
    if (!state) return null;
    const work = processPendingReevaluation(prisma, userId, { syncLimit: DEFAULT_SYNC_LIMIT }).catch((error) => logger.warn(`Conclusao da reavaliacao na leitura falhou (aluno ${userId}): ${error instanceof Error ? error.message : String(error)}`));
    await Promise.race([work, sleep(budgetMs)]);
    return await readPending(prisma, userId);
  } catch (error) {
    logger.warn(`Leitura do estado pendente falhou (aluno ${userId}): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

const backoffMs = (attempts: number) => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);

/** Varredor periodico: retoma linhas devidas (sem lease ativo, respeitando espera crescente apos falhas). Nunca lanca. */
export async function processDueReevaluations(prisma: PrismaService, options: { limit?: number; now?: Date } = {}): Promise<{ examined: number; processed: number }> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 20;
  try {
    const rows = await prisma.correctionReevaluation.findMany({
      where: { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      orderBy: { dirtySince: 'asc' },
      take: limit * 3,
    });
    const due = rows.filter((row) => !row.lastAttemptAt || now.getTime() - row.lastAttemptAt.getTime() >= backoffMs(row.attempts)).slice(0, limit);
    let processed = 0;
    for (const row of due) {
      const result = await processPendingReevaluation(prisma, row.userId, { syncLimit: BACKGROUND_LIMIT }).catch((error) => {
        logger.error(`Varredura: aluno ${row.userId} falhou: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      if (result && result.status !== 'busy') processed++;
    }
    return { examined: rows.length, processed };
  } catch (error) {
    logger.error(`Varredura de reavaliacoes pendentes falhou: ${error instanceof Error ? error.message : String(error)}`);
    return { examined: 0, processed: 0 };
  }
}
