import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiDataEligibility } from './ai-data-eligibility.service';
import { currentAiScope } from './ai-scope';

// Protecao FINAL antes de qualquer chamada a um fornecedor externo de IA. Fica dentro da fila unica de chamadas (AiQueueService), pelo qual passam TODOS os
// agentes — por isso um agente novo nao consegue ignora-la.
//
// Regras (fail-closed):
//  - chamada que declara dados de dispositivo precisa acontecer DENTRO de um escopo de IA (os leitores ja' excluiram os provedores nao autorizados);
//  - o escopo precisa ser do destino correto e recente (uma geracao leva minutos; passado o teto, recomputa-se);
//  - a elegibilidade e' RECALCULADA na hora: se um provedor ficou bloqueado depois que o escopo foi montado (consentimento revogado no meio da geracao),
//    a chamada e' abortada — nunca se envia com base num escopo velho.
// A mensagem de erro nunca carrega dado do aluno: so' o motivo tecnico. Cada bloqueio fica auditado (sem payload).

export const MAX_SCOPE_AGE_MS = 30 * 60_000;

export type EgressBlockReason = 'no_scope' | 'wrong_destination' | 'stale_scope' | 'consent_changed';

export class AiEgressBlockedError extends Error {
  constructor(readonly agent: string, readonly reason: EgressBlockReason, readonly providers: readonly string[] = []) {
    super(`Chamada de IA bloqueada (${agent}): ${reason}${providers.length ? ` [${providers.join(', ')}]` : ''}.`);
    this.name = 'AiEgressBlockedError';
  }
}

@Injectable()
export class AiEgressGuard {
  private readonly logger = new Logger(AiEgressGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: AiDataEligibility,
  ) {}

  async assertDeviceData(agent: string, now: number = Date.now()): Promise<void> {
    const scope = currentAiScope();
    if (!scope) return this.block(agent, 'no_scope', undefined, []);
    if (scope.destination !== 'external_ai') return this.block(agent, 'wrong_destination', scope.userId, []);
    if (now - scope.computedAt > MAX_SCOPE_AGE_MS) return this.block(agent, 'stale_scope', scope.userId, []);
    const fresh = await this.eligibility.scopeFor(scope.userId, scope.destination);
    const newlyBlocked = fresh.blocked.filter((provider) => !scope.blocked.includes(provider));
    if (newlyBlocked.length > 0) return this.block(agent, 'consent_changed', scope.userId, newlyBlocked);
  }

  private async block(agent: string, reason: EgressBlockReason, userId: string | undefined, providers: readonly string[]): Promise<never> {
    this.logger.warn(`Chamada de IA bloqueada: agente=${agent} motivo=${reason}${providers.length ? ` provedores=${providers.join(',')}` : ''}`);
    if (userId) {
      await this.prisma.providerConnectionEvent
        .create({ data: { userId, provider: 'ai_governance', type: 'ai_egress_blocked', details: { agent, reason, providers: [...providers] } } })
        .catch(() => undefined);
    }
    throw new AiEgressBlockedError(agent, reason, providers);
  }
}
