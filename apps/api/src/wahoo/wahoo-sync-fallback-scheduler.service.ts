import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WahooActivityIngestionService } from './wahoo-activity-ingestion.service';

// Rotina de seguranca da Wahoo (Etapa 5). O webhook e' o caminho principal; esta rotina cobre o que ele nao entregar e
// funciona como sincronizacao automatica enquanto o webhook nao estiver ativo no portal da Wahoo.
// Cuidado com os limites da Cloud API (producao: 200/5 min, 1000/h, 5000/dia, por app): o intervalo padrao e' 3 h, com
// teto de conexoes por rodada, ritmo espacado e parada imediata no primeiro limite atingido.
// Configuravel por WAHOO_FALLBACK_INTERVAL_MINUTES (aumente quando o webhook estiver ativo).
const DEFAULT_FALLBACK_INTERVAL_MINUTES = 180;
const FALLBACK_INTERVAL_MINUTES = Number(process.env.WAHOO_FALLBACK_INTERVAL_MINUTES) > 0
  ? Number(process.env.WAHOO_FALLBACK_INTERVAL_MINUTES)
  : DEFAULT_FALLBACK_INTERVAL_MINUTES;
const FALLBACK_INTERVAL_MS = FALLBACK_INTERVAL_MINUTES * 60_000;
const MAX_CONNECTIONS_PER_RUN = 100;
const PACING_MS = 500;

@Injectable()
export class WahooSyncFallbackSchedulerService {
  private readonly logger = new Logger(WahooSyncFallbackSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: WahooActivityIngestionService,
  ) {}

  @Interval(FALLBACK_INTERVAL_MS)
  async syncStaleConnections(now: Date = new Date(), pacingMs: number = PACING_MS) {
    if (this.isRunning) {
      this.logger.warn('Rotina de sincronizacao Wahoo ainda estava rodando — pulando esta execucao.');
      return;
    }
    this.isRunning = true;
    try {
      const cutoff = new Date(now.getTime() - FALLBACK_INTERVAL_MS);
      const stale = await this.prisma.wahooConnection.findMany({
        where: {
          disconnectedAt: null,
          grantedScopes: { contains: 'workouts_read' },
          OR: [{ lastSyncCompletedAt: null }, { lastSyncCompletedAt: { lt: cutoff } }],
        },
        select: { userId: true },
        orderBy: { lastSyncCompletedAt: { sort: 'asc', nulls: 'first' } },
        take: MAX_CONNECTIONS_PER_RUN,
      });
      let synced = 0;
      let failed = 0;
      let stoppedByRateLimit = false;
      for (const connection of stale) {
        try {
          const result = await this.ingestion.sync(connection.userId);
          if (result.status === 'rate_limited') { stoppedByRateLimit = true; break; } // o resto fica para a proxima rodada
          synced++;
        } catch (error) {
          failed++;
          this.logger.warn(`Rotina Wahoo falhou para um usuario: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (pacingMs > 0) await new Promise((resolve) => setTimeout(resolve, pacingMs));
      }
      this.logger.log(`Rotina Wahoo: ${stale.length} conexao(oes) elegivel(is), ${synced} sincronizada(s), ${failed} falha(s)${stoppedByRateLimit ? ', parada por limite da API' : ''}.`);
    } finally {
      this.isRunning = false;
    }
  }
}
