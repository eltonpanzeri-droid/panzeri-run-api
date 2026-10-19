import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ProviderInboundEventService } from './provider-inbound-event.service';

// Processador da fila de eventos da Central Universal. DESLIGADO POR PADRAO: so' roda com PROVIDER_HUB_WORKER_ENABLED=true (nenhum conector existe ainda).
// A flag e' lida a cada execucao. Trava local evita sobreposicao; entre instancias a reivindicacao atomica da fila evita processamento duplicado.
@Injectable()
export class ProviderHubWorkerService {
  private readonly logger = new Logger(ProviderHubWorkerService.name);
  private isRunning = false;

  constructor(private readonly events: ProviderInboundEventService) {}

  isEnabled(): boolean {
    return process.env.PROVIDER_HUB_WORKER_ENABLED?.trim().toLowerCase() === 'true';
  }

  @Interval(60_000)
  async run(now: Date = new Date()): Promise<void> {
    if (!this.isEnabled() || this.isRunning) return;
    this.isRunning = true;
    try {
      const summary = await this.events.processDue(20, now);
      const purged = await this.events.purgeFinished(now);
      if (summary.claimed > 0 || purged > 0) this.logger.log(`Fila de eventos: ${JSON.stringify(summary)}; ${purged} antigo(s) apagado(s).`);
    } catch (error) {
      this.logger.warn(`Fila de eventos falhou nesta rodada: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isRunning = false;
    }
  }
}
