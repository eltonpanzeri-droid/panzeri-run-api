import { Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PolarActivityIngestionService } from './polar-activity-ingestion.service';
import { PolarHealthIngestionService } from './polar-health-ingestion.service';

// Fallback de recuperacao (03/10/2026). Webhook e' o caminho principal; este intervalo cobre
// atividades que nao entrarem pelo webhook e, enquanto o webhook nao estiver ativo em producao,
// funciona como sincronizacao automatica temporaria. Reaproveita o sync() existente (idempotente).
// Configuravel por POLAR_FALLBACK_INTERVAL_MINUTES: aumentar quando o webhook estiver ativo.
// Padrao 60 min — conservador frente aos limites oficiais (500 + usuarios*20 por 15min, 5000 +
// usuarios*100 por 24h, RateLimit-* headers da AccessLink).
const DEFAULT_FALLBACK_INTERVAL_MINUTES = 60;
const FALLBACK_INTERVAL_MINUTES = Number(process.env.POLAR_FALLBACK_INTERVAL_MINUTES) > 0
  ? Number(process.env.POLAR_FALLBACK_INTERVAL_MINUTES)
  : DEFAULT_FALLBACK_INTERVAL_MINUTES;
const FALLBACK_INTERVAL_MS = FALLBACK_INTERVAL_MINUTES * 60_000;
const MAX_CONNECTIONS_PER_RUN = 50;

@Injectable()
export class PolarSyncFallbackSchedulerService {
  private readonly logger = new Logger(PolarSyncFallbackSchedulerService.name);

  // Mesma trava do BillingSyncSchedulerService: sem ela, uma execucao lenta sobreporia a seguinte.
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: PolarActivityIngestionService,
    // Saude e recuperacao (23/10/2026): so' age com POLAR_HEALTH_ENABLED ligado e so' para quem autorizou. Nao altera o fluxo de exercicios.
    @Optional() private readonly health?: PolarHealthIngestionService,
  ) {}

  @Interval(FALLBACK_INTERVAL_MS)
  async syncStaleConnections(now: Date = new Date()) {
    if (this.isRunning) {
      this.logger.warn('Fallback de sincronizacao Polar ainda estava rodando — pulando esta execucao.');
      return;
    }
    this.isRunning = true;
    try {
      const cutoff = new Date(now.getTime() - FALLBACK_INTERVAL_MS);
      const stale = await this.prisma.polarConnection.findMany({
        where: { disconnectedAt: null, OR: [{ lastSyncCompletedAt: null }, { lastSyncCompletedAt: { lt: cutoff } }] },
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
      try { const h = (await this.health?.syncStale(now)) ?? { eligible: 0, synced: 0, failed: 0 }; if (h.eligible > 0) this.logger.log(`Saude Polar: ${h.eligible} elegivel(is), ${h.synced} sincronizada(s), ${h.failed} falha(s).`); }
      catch (error) { this.logger.warn(`Saude Polar: rotina falhou: ${error instanceof Error ? error.message.slice(0, 100) : 'erro'}`); }
    } finally {
      this.isRunning = false;
    }
  }
}
