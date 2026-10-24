import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { refreshReviewContent } from './review-accounts';

// Contas de demonstracao da App Store (24/10/2026): a Apple pode levar dias para revisar. A renovacao diaria (e uma checagem ao subir) mantem o programa da conta
// ativa na semana corrente SEM ninguem rodar o seed de novo, e nunca altera senha nem assinatura (ver refreshReviewContent). Sem contas de revisao = nao faz nada.
@Injectable()
export class ReviewAccountsSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReviewAccountsSchedulerService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    setTimeout(() => { void this.refresh(); }, 45_000).unref();
  }

  @Cron('0 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async refresh() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await refreshReviewContent(this.prisma);
      if (result.refreshed > 0) this.logger.log(`Contas de revisao da App Store: ${result.refreshed} renovada(s) de ${result.checked}.`);
    } catch (error) {
      this.logger.warn(`Falha ao renovar as contas de revisao da App Store: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
