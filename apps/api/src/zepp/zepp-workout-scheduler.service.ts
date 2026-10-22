import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { ZEPP_PROVIDER_ID } from './zepp.connector';
import { WATCH_DELIVERY_PURPOSE, ZEPP_WORKOUT_PROVIDER, ZeppWorkoutPublisherService } from './zepp-workout-publisher.service';
import { setZeppWorkoutTriggerHandler, ZeppWorkoutSyncReason } from './zepp-workout-trigger';

// Atraso antes de sincronizar apos um pedido: deixa a gravacao terminar e agrupa varias edicoes seguidas (autorizar nao espera quase nada).
const TRIGGER_DELAY_MS: Record<ZeppWorkoutSyncReason, number> = { grant: 500, app_open: 0, plan_generated: 5_000, session_regenerated: 5_000, session_edited: 5_000, session_removed: 5_000, session_rescheduled: 5_000 };
// Abrir o app so' dispara uma conferencia a cada 5 minutos por aluna (a Zepp nao informou limite de chamadas).
export const APP_OPEN_MIN_INTERVAL_MS = 5 * 60 * 1000;

// Rotina de reconciliacao dos treinos no relogio (Lote 2). A cada 30 minutos reconcilia, um aluno por vez, quem tem a conexao Zepp ativa COM a finalidade
// `watch_delivery` e quem ainda tem entrega ativa (para cancelar localmente apos desconexao/revogacao). Cobre sozinha: treino novo gerado, editado, removido,
// rotina trocada e a janela que anda a cada dia: a Zepp NAO estende a janela sozinha (confirmado em 21/10/2026), entao o publicador REPUBLICA a janela completa uma vez por
// dia mesmo sem mudanca (o primeiro ciclo depois da virada do dia local). Desligada ate `ZEPP_WORKOUT_PUBLISH_ENABLED=true`. Falha de um aluno nunca interrompe os demais nem a geracao de treino.
@Injectable()
export class ZeppWorkoutSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ZeppWorkoutSchedulerService.name);
  private isRunning = false;
  private readonly pending = new Set<string>();
  private readonly lastAppOpen = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: ZeppWorkoutPublisherService,
    private readonly consent: ProviderConsentService,
  ) {}

  onModuleInit() {
    setZeppWorkoutTriggerHandler((userId, reason) => this.onTrigger(userId, reason));
  }

  // Gatilhos imediatos (autorizacao, treino gerado/editado/removido/reagendado, abertura do app). A rotina de 30 minutos continua como rede de seguranca para qualquer caminho nao ligado.
  // Uma aluna por vez e sem duplicar: pedidos repetidos enquanto um esta agendado sao agrupados; o publicador ainda serializa por aluna e e' idempotente.
  onTrigger(userId: string, reason: ZeppWorkoutSyncReason): void {
    if (!this.publisher.isPublishingEnabled()) return;
    if (reason === 'app_open') {
      const last = this.lastAppOpen.get(userId) ?? 0;
      if (Date.now() - last < APP_OPEN_MIN_INTERVAL_MS) return;
      this.lastAppOpen.set(userId, Date.now());
      if (this.lastAppOpen.size > 5000) this.lastAppOpen.clear();
    }
    if (this.pending.has(userId)) return;
    this.pending.add(userId);
    const timer = setTimeout(() => { void this.runTrigger(userId, reason); }, TRIGGER_DELAY_MS[reason]);
    (timer as { unref?: () => void }).unref?.();
  }

  private async runTrigger(userId: string, reason: ZeppWorkoutSyncReason): Promise<void> {
    this.pending.delete(userId); // pedidos que chegarem durante a execucao agendam uma nova (o publicador serializa)
    try {
      // So' quem tem a conexao Zepp ativa COM a autorizacao de envio de treinos: para as demais nada e' feito (quem perdeu a autorizacao e' tratado pela rotina).
      if (!(await this.consent.isAllowed(ZEPP_PROVIDER_ID, userId, 'profile', WATCH_DELIVERY_PURPOSE))) return;
      await this.publisher.reconcile(userId);
    } catch (error) {
      this.logger.warn(`Sincronizacao imediata de treinos Zepp (${reason}) falhou: ${(error as Error).message}`);
    }
  }

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
