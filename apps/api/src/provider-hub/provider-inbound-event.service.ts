import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorRegistry } from './connector-registry';
import { ProviderConsentService } from './provider-consent.service';
import { EventOutcome, InboundEventDraft } from './provider-connector';

// Caixa de entrada duravel de eventos de provedores (Passo 1). Fluxo: o webhook autentica -> record() grava e o endpoint responde -> processDue() (rotina)
// reivindica com trava e entrega ao conector. Garantias:
//  - Idempotencia: (provider, dedupeKey) unico; reenvio devolve created=false.
//  - Entrega "ao menos uma vez" com trava (lease): processador que cai libera o evento ao expirar a trava.
//  - Cerca (fencing): o desfecho so' grava se o evento ainda e' DESTA execucao (mesmo numero de tentativa) — um processador lento nao sobrescreve o que outro refez.
//  - Falha: espera crescente e, ao esgotar as tentativas, estado 'dead' (nunca descartado em silencio).
//  - Privacidade: ao concluir/descartar, o payload e' ZERADO (a fila e' fila de trabalho, nao arquivo); linhas antigas sao apagadas em purgeFinished().
export const MAX_ATTEMPTS = 8;
export const LOCK_LEASE_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 6 * 3_600_000;
const FINISHED_RETENTION_DAYS = 7;
const DEAD_RETENTION_DAYS = 30;
const DEDUPE_KEY_MAX = 200;
const ERROR_MAX = 300;

export interface RecordResult { created: boolean; id: string | null }
export interface ProcessSummary { claimed: number; done: number; discarded: number; retried: number; dead: number }

export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS);
}

function briefError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX);
}

@Injectable()
export class ProviderInboundEventService {
  private readonly logger = new Logger(ProviderInboundEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectorRegistry,
    // Consentimento por categoria (Passo 2b). Ausente => sem verificacao (so' os testes do Passo 1 constroem assim); no app real o modulo sempre injeta.
    private readonly consent?: ProviderConsentService,
  ) {}

  async record(provider: string, draft: InboundEventDraft, userId?: string | null): Promise<RecordResult> {
    if (!provider || !draft.dedupeKey || !draft.eventType || !draft.category) throw new Error('Evento invalido: provider, dedupeKey, eventType e category sao obrigatorios.');
    if (draft.dedupeKey.length > DEDUPE_KEY_MAX) throw new Error('dedupeKey longa demais.');
    try {
      const row = await this.prisma.providerInboundEvent.create({
        data: {
          provider,
          dedupeKey: draft.dedupeKey,
          eventType: draft.eventType,
          category: draft.category,
          userId: userId ?? null,
          externalAccountId: draft.externalAccountId ?? null,
          payload: draft.payload as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return { created: true, id: row.id };
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'P2002') return { created: false, id: null };
      throw error;
    }
  }

  private dueWhere(now: Date): Prisma.ProviderInboundEventWhereInput {
    return {
      OR: [
        { status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: now } },
        { status: 'processing', lockedUntil: { lt: now } },
      ],
    };
  }

  async processDue(limit = 20, now: Date = new Date()): Promise<ProcessSummary> {
    const summary: ProcessSummary = { claimed: 0, done: 0, discarded: 0, retried: 0, dead: 0 };
    const candidates = await this.prisma.providerInboundEvent.findMany({
      where: this.dueWhere(now),
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    for (const candidate of candidates) {
      // Reivindicacao atomica: so' uma execucao ganha; a condicao de elegibilidade e' reavaliada no proprio UPDATE.
      const claim = await this.prisma.providerInboundEvent.updateMany({
        where: { id: candidate.id, ...this.dueWhere(now) },
        data: { status: 'processing', lockedUntil: new Date(now.getTime() + LOCK_LEASE_MS), attempts: { increment: 1 } },
      });
      if (claim.count !== 1) continue;
      summary.claimed++;
      const event = await this.prisma.providerInboundEvent.findUnique({ where: { id: candidate.id } });
      if (!event) continue;
      const result = await this.runHandler(event, now);
      summary[result]++;
    }
    return summary;
  }

  private async runHandler(
    event: { id: string; provider: string; eventType: string; category: string | null; userId: string | null; externalAccountId: string | null; payload: Prisma.JsonValue; attempts: number },
    now: Date,
  ): Promise<'done' | 'discarded' | 'retried' | 'dead'> {
    const connector = this.registry.get(event.provider);
    const handler = connector?.events;
    let outcome: EventOutcome;
    // Consentimento: provedor com documento de consentimento so' entrega ao conector eventos de categoria AUTORIZADA por um aluno com conexao ativa.
    // Fail-closed: sem categoria, conta desconhecida/desconectada ou categoria nao marcada => descarta (payload zerado), nunca processa.
    let resolvedUserId = event.userId;
    let denied: string | null = null;
    if (connector?.consent && this.consent) {
      if (!event.category) denied = 'evento sem categoria de dado';
      else {
        resolvedUserId = event.userId ?? (event.externalAccountId ? await this.consent.resolveActiveUserId(event.provider, event.externalAccountId) : null);
        if (!resolvedUserId) denied = 'conta desconhecida ou desconectada';
        else if (!(await this.consent.isAllowed(event.provider, resolvedUserId, event.category))) denied = 'categoria nao autorizada pelo aluno';
      }
    }
    if (denied) {
      outcome = { status: 'discard', reason: denied };
    } else if (!handler) {
      outcome = { status: 'retry', reason: `nenhum conector com processamento de eventos registrado para "${event.provider}"` };
    } else {
      try {
        outcome = await handler.handle({
          id: event.id,
          provider: event.provider,
          eventType: event.eventType,
          userId: resolvedUserId,
          externalAccountId: event.externalAccountId,
          payload: event.payload,
          attempt: event.attempts,
        });
      } catch (error) {
        outcome = { status: 'retry', reason: briefError(error) };
      }
    }
    // Cerca: so' grava o desfecho se o evento continua sendo desta execucao.
    const mine = { id: event.id, status: 'processing', attempts: event.attempts };
    if (outcome.status === 'done' || outcome.status === 'discard') {
      await this.prisma.providerInboundEvent.updateMany({
        where: mine,
        data: {
          status: outcome.status === 'done' ? 'done' : 'discarded',
          processedAt: now,
          lockedUntil: null,
          lastError: outcome.status === 'discard' ? briefError(outcome.reason) : null,
          payload: {},
        },
      });
      return outcome.status === 'done' ? 'done' : 'discarded';
    }
    if (event.attempts >= MAX_ATTEMPTS) {
      await this.prisma.providerInboundEvent.updateMany({ where: mine, data: { status: 'dead', lockedUntil: null, lastError: briefError(outcome.reason) } });
      this.logger.error(`Evento ${event.id} (${event.provider}/${event.eventType}) esgotou ${MAX_ATTEMPTS} tentativas: ${briefError(outcome.reason)}`);
      return 'dead';
    }
    await this.prisma.providerInboundEvent.updateMany({
      where: mine,
      data: { status: 'failed', lockedUntil: null, nextAttemptAt: new Date(now.getTime() + backoffMs(event.attempts)), lastError: briefError(outcome.reason) },
    });
    return 'retried';
  }

  // Conexao revogada/excluida: nada pendente deste usuario neste provedor deve virar dado depois. Zera o payload.
  async discardPendingForUser(provider: string, userId: string, reason = 'conexao revogada'): Promise<number> {
    const result = await this.prisma.providerInboundEvent.updateMany({
      where: { provider, userId, status: { in: ['pending', 'failed', 'processing'] } },
      data: { status: 'discarded', processedAt: new Date(), lockedUntil: null, lastError: reason, payload: {} },
    });
    return result.count;
  }

  async purgeFinished(now: Date = new Date()): Promise<number> {
    const day = 86_400_000;
    const result = await this.prisma.providerInboundEvent.deleteMany({
      where: {
        OR: [
          { status: { in: ['done', 'discarded'] }, updatedAt: { lt: new Date(now.getTime() - FINISHED_RETENTION_DAYS * day) } },
          { status: 'dead', updatedAt: { lt: new Date(now.getTime() - DEAD_RETENTION_DAYS * day) } },
        ],
      },
    });
    return result.count;
  }
}
