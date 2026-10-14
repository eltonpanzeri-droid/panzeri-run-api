import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_SYNC_LIMIT, markPending, processPendingReevaluation, ProcessResult, waitForPendingContinuations } from './pending-reevaluation';

// Atualizacao das analises de execucao depois de uma correcao (15/10/2026). So' recalcula indicadores DETERMINISTICOS (ExecutionAnalysisService.analyzeSession:
// sem IA, sem Prescritor, sem regeneracao de treino). A pendencia e' DURAVEL (CorrectionReevaluation, ver pending-reevaluation.ts): o que nao termina na
// requisicao continua pelo banco — reinicio do servidor nao perde nada.
//
// Consistencia: (1) as sessoes mais recentes (syncLimit) sao refeitas antes de devolver; (2) o restante segue em segundo plano e pelo varredor; (3) enquanto a
// linha de analise nao e' refeita, a defesa de leitura (analysis-validity.ts) a descarta e quem le ve o estado pendente (provisorio) — nunca a linha antiga como
// atual. Sessao sem feedback e sem vinculo ativo NAO e' reanalisada (gravaria "sem registro" so' por ter sido desvinculada); a linha antiga fica no historico.

export { DEFAULT_SYNC_LIMIT };

const logger = new Logger('AnalysisRecompute');
const HEAL_COOLDOWN_MS = 60_000;
const lastHeal = new Map<string, number>();

export interface RecomputeOptions {
  // Sessoes que o chamador sabe afetadas (alem das descobertas pelo historico de vinculos).
  sessionIds?: string[];
  // Sessoes cuja analise deve ser refeita mesmo com a mesma impressao digital (ex.: treinador mudou a modalidade, que nao entra na impressao digital).
  forceSessionIds?: string[];
  // Quantas sessoes (mais recentes primeiro) sao refeitas antes de devolver; o resto segue pela pendencia duravel.
  syncLimit?: number;
}

export interface RecomputeResult {
  sessionIds: string[];
  recomputedSessionIds: string[];
  failedSessionIds: string[];
  // Ainda pendentes (na linha duravel) quando a funcao devolveu.
  deferredSessionIds: string[];
}

/** Fase 1: marca o retrato vivo como desatualizado e REGISTRA a pendencia (duravel) das sessoes com fonte. Nao processa. */
export async function prepareAnalysisRecompute(prisma: PrismaService, userId: string, sessionIds: string[], options: Pick<RecomputeOptions, 'forceSessionIds'> = {}): Promise<string[]> {
  const all = [...new Set(sessionIds)];
  if (all.length === 0) return [];
  const sessions = await prisma.trainingSession.findMany({
    where: { id: { in: all }, userId },
    select: { id: true, completion: { select: { id: true } }, executionLinks: { where: { status: 'active' }, select: { id: true }, take: 1 } },
  });
  const withSource = sessions.filter((s) => s.completion != null || s.executionLinks.length > 0).map((s) => s.id);
  // Retrato VIVO do Analista das sessoes afetadas (nunca o entregue com o programa): marcado como desatualizado de imediato; o proximo upsertSession o reativa.
  await prisma.trainingAnalysis.updateMany({
    where: { userId, scope: 'session', refKey: { in: all }, deliveredWithPlanId: null, status: 'active' },
    data: { status: 'stale' },
  });
  if (withSource.length > 0) await markPending(prisma, userId, { analysisSessionIds: withSource, forceSessionIds: (options.forceSessionIds ?? []).filter((id) => withSource.includes(id)) });
  return withSource;
}

export function toRecomputeResult(all: string[], process: ProcessResult): RecomputeResult {
  return { sessionIds: [...new Set(all)], recomputedSessionIds: process.recomputedSessionIds, failedSessionIds: process.failedSessionIds, deferredSessionIds: process.remainingSessionIds };
}

/** Marca e processa (sincrono limitado; o resto pela pendencia duravel). */
export async function recomputeSessionAnalyses(prisma: PrismaService, userId: string, sessionIds: string[], options: RecomputeOptions = {}): Promise<RecomputeResult> {
  const withSource = await prepareAnalysisRecompute(prisma, userId, sessionIds, options);
  if (withSource.length === 0) return { sessionIds: [...new Set(sessionIds)], recomputedSessionIds: [], failedSessionIds: [], deferredSessionIds: [] };
  const process = await processPendingReevaluation(prisma, userId, { syncLimit: options.syncLimit ?? DEFAULT_SYNC_LIMIT });
  return toRecomputeResult(sessionIds, process);
}

/**
 * Leituras das variaveis execution.* que encontraram linha obsoleta: registra a pendencia (duravel) das sessoes que ainda tem fonte e processa em segundo
 * plano, com intervalo minimo por aluno. Nunca lanca e nunca bloqueia a leitura.
 */
export function scheduleStaleHeal(prisma: PrismaService, userId: string, staleSessionIds: string[]): void {
  if (staleSessionIds.length === 0) return;
  const now = Date.now();
  if (now - (lastHeal.get(userId) ?? 0) < HEAL_COOLDOWN_MS) return;
  lastHeal.set(userId, now);
  void (async () => {
    try {
      const withSource = await prepareAnalysisRecompute(prisma, userId, staleSessionIds);
      if (withSource.length > 0) await processPendingReevaluation(prisma, userId, { syncLimit: DEFAULT_SYNC_LIMIT });
    } catch (error) {
      logger.warn(`Recuperacao de analises obsoletas (aluno ${userId}) falhou: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
}

/** Aguarda continuacoes em segundo plano (testes e encerramento ordenado). */
export function waitForBackgroundRecompute(userId?: string): Promise<void> {
  void userId; // a fila e' unica por processo; o parametro existe so' por compatibilidade com quem aguarda por aluno
  return waitForPendingContinuations();
}
