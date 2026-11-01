import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiCostRecord, setAiCostSink } from '../common/ai-cost-sink';

// Grava o custo real de cada chamada de IA (01/11/2026). Gravacao em segundo plano e protegida: falha aqui vira aviso no log e NUNCA afeta a geracao,
// nunca roda dentro de transacao e nao faz chamada de rede. So' numeros/metadados (ver AiCostRecord).
@Injectable()
export class AiCostRecorderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiCostRecorderService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    setAiCostSink((record) => { void this.save(record); });
  }

  onModuleDestroy(): void {
    setAiCostSink(null);
  }

  async save(record: AiCostRecord): Promise<void> {
    try {
      await this.prisma.aiGenerationCost.create({ data: this.toRow(record) });
    } catch (error) {
      this.logger.warn(`Nao consegui gravar o custo da chamada de IA (${record.agent}): ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
    }
  }

  toRow(record: AiCostRecord): Prisma.AiGenerationCostUncheckedCreateInput {
    return {
      userId: record.userId,
      agent: record.agent,
      model: record.model,
      effort: record.effort,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cacheReadTokens: record.cacheReadTokens,
      cacheCreationTokens: record.cacheCreationTokens,
      costUsd: record.costUsd,
      costWithoutCacheUsd: record.costWithoutCacheUsd,
      inputUsd: record.inputUsd,
      cacheWriteUsd: record.cacheWriteUsd,
      cacheReadUsd: record.cacheReadUsd,
      outputUsd: record.outputUsd,
      durationMs: record.durationMs,
      detail: (record.detail ?? undefined) as Prisma.InputJsonValue | undefined,
    };
  }
}
