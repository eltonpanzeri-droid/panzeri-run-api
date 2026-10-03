import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PolarActivityIngestionService } from './polar-activity-ingestion.service';

// Fallback de recuperacao (03/10/2026) — caminho principal de chegada de atividade sera' o webhook
// da Polar; este cron so' cobre atividades que eventualmente nao entrarem por ele. Reaproveita o
// mesmo sync() ja existente (idempotente: upsert por externalId, retomada de transaction) — nao cria
// um segundo pipeline. Frequencia conservadora: a cada 6h, so' conexoes que nao sincronizaram nesse
// intervalo, respeitando os limites oficiais (500 + usuarios*20 por 15min, 5000 + usuarios*100 por
// 24h, ver RateLimit-* headers da AccessLink).
const FALLBACK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_CONNECTIONS_PER_RUN = 50;

@Injectable()
export class PolarSyncFallbackSchedulerService {
  private readonly logger = new Logger(PolarSyncFallbackSchedulerService.name);

  // Mesma trava do BillingSyncSchedulerService: sem ela, uma execucao lenta sobreporia a seguinte.
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: PolarActivityIngestionService,
  ) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async syncStaleConnections(now: Date = new Date()) {
    if (this.isRunning) {
      this.logger.warn('Fallback de sincronizacao Polar ainda estava rodando — pulando esta execucao.');
      return;
    }
    this.isRunning = true;
    try {
      const cutoff = new Date(now.getTime() - FALLBACK_INTERVAL_MS);
      const stale = await this.prisma.polarConnection.findMany({
        where: { OR: [{ lastSyncCompletedAt: null }, { lastSyncCompletedAt: { lt: cutoff } }] },
        select: { userId: true },
        take: MAX_CONNECTIONS_PER_RUN,
      });
      let synced = 0;
      let failed = 0;
      for (const connection of stale) {
        try {
          await this.ingestion.sync(connection.userId);
          synced++;
        } catch (error) {
          failed++;
          this.logger.warn(`Fallback Polar falhou para um usuario: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      this.logger.log(`Fallback Polar: ${stale.length} conexao(oes) elegivel(is), ${synced} sincronizada(s), ${failed} falha(s).`);
    } finally {
      this.isRunning = false;
    }
  }
}
