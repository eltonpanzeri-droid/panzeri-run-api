import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { ZEPP_PROVIDER_ID } from './zepp.connector';
import { WATCH_DELIVERY_PURPOSE, ZEPP_WORKOUT_PROVIDER, ZeppWorkoutPublisherService } from './zepp-workout-publisher.service';

// Rotina de reconciliacao dos treinos no relogio (Lote 2). A cada 30 minutos reconcilia, um aluno por vez, quem tem a conexao Zepp ativa COM a finalidade
// `watch_delivery` e quem ainda tem entrega ativa (para cancelar localmente apos desconexao/revogacao). Cobre sozinha: treino novo gerado, editado, removido,
// rotina trocada e a janela que anda a cada dia: a Zepp NAO estende a janela sozinha (confirmado em 21/10/2026), entao o publicador REPUBLICA a janela completa uma vez por
// dia mesmo sem mudanca (o primeiro ciclo depois da virada do dia local). Desligada ate `ZEPP_WORKOUT_PUBLISH_ENABLED=true`. Falha de um aluno nunca interrompe os demais nem a geracao de treino.
@Injectable()
export class ZeppWorkoutSchedulerService {
  private readonly logger = new Logger(ZeppWorkoutSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: ZeppWorkoutPublisherService,
    private readonly consent: ProviderConsentService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async reconcileAll() {
    if (!this.publisher.isPublishingEnabled()) return;
    if (this.isRunning) {
      this.logger.warn('Reconciliacao de treinos Zepp ainda rodando; pulando esta execucao.');
      return;
    }
    this.isRunning = true;
    try {
      const connected = await this.consent.userIdsWithPurpose(ZEPP_PROVIDER_ID, WATCH_DELIVERY_PURPOSE);
      const withDeliveries = await this.prisma.workoutDelivery.findMany({
        where: { provider: ZEPP_WORKOUT_PROVIDER, status: 'sent' },
        select: { trainingSession: { select: { userId: true } } },
      });
      const userIds = new Set<string>([...connected, ...withDeliveries.map((d) => d.trainingSession.userId)]);
      let published = 0;
      let failed = 0;
      for (const userId of userIds) {
        try {
          const result = await this.publisher.reconcile(userId);
          if (result.status === 'published' || result.status === 'republished' || result.status === 'cleared') published += 1;
          if (result.status === 'failed') failed += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn(`Reconciliacao Zepp falhou para um aluno: ${(error as Error).message}`);
        }
      }
      if (published > 0 || failed > 0) this.logger.log(`Treinos Zepp: ${userIds.size} aluno(s) verificado(s), ${published} atualizado(s), ${failed} falha(s).`);
    } catch (error) {
      this.logger.warn(`Falha na reconciliacao de treinos Zepp: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
