import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { addWorkoutSyncListener, ZeppWorkoutSyncReason } from '../zepp/zepp-workout-trigger';
import { COROS_PROVIDER_ID } from './coros.connector';
import { COROS_WORKOUT_PROVIDER, CorosWorkoutPublisherService, WATCH_DELIVERY_PURPOSE } from './coros-workout-publisher.service';

// Atraso antes de sincronizar apos um pedido: deixa a gravacao terminar e agrupa varias edicoes seguidas (autorizar nao espera quase nada).
const TRIGGER_DELAY_MS: Record<ZeppWorkoutSyncReason, number> = { grant: 500, app_open: 0, plan_generated: 5_000, session_regenerated: 5_000, session_edited: 5_000, session_removed: 5_000, session_rescheduled: 5_000 };
// Abrir o app so' dispara uma conferencia a cada 5 minutos por aluna.
export const APP_OPEN_MIN_INTERVAL_MS = 5 * 60 * 1000;

// Reconciliacao dos treinos da COROS (30/10/2026): gatilhos imediatos (os MESMOS pontos que avisam a Zepp: geracao, edicao, remocao, reagendamento, abertura do app, autorizacao) e uma
// rede de seguranca a cada 30 minutos para quem tem a conexao COROS ativa COM a finalidade `watch_delivery` e para quem ainda tem entrega ativa (cancelar localmente apos desconexao).
// Desligada ate COROS_WORKOUT_PUBLISH_ENABLED=true. Falha de uma aluna nunca interrompe as demais nem a geracao de treino.
@Injectable()
export class CorosWorkoutSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CorosWorkoutSchedulerService.name);
  private isRunning = false;
  private readonly pending = new Set<string>();
  private readonly lastAppOpen = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: CorosWorkoutPublisherService,
    private readonly consent: ProviderConsentService,
  ) {}

  onModuleInit() {
    addWorkoutSyncListener((userId, reason) => this.onTrigger(userId, reason));
  }

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
    this.pending.delete(userId);
    try {
      // So' quem tem a conexao COROS ativa COM a autorizacao de envio de treinos; as demais nao sao tocadas (quem perdeu a autorizacao e' tratado pela rotina).
      if (!(await this.consent.isAllowed(COROS_PROVIDER_ID, userId, 'profile', WATCH_DELIVERY_PURPOSE))) return;
      await this.publisher.reconcile(userId);
    } catch (error) {
      this.logger.warn(`Sincronizacao imediata de treinos COROS (${reason}) falhou: ${(error as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async reconcileAll() {
    if (!this.publisher.isPublishingEnabled()) return;
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const connected = await this.consent.userIdsWithPurpose(COROS_PROVIDER_ID, WATCH_DELIVERY_PURPOSE);
      const withDeliveries = await this.prisma.workoutDelivery.findMany({ where: { provider: COROS_WORKOUT_PROVIDER, status: 'sent' }, select: { trainingSession: { select: { userId: true } } } });
      const userIds = new Set<string>([...connected, ...withDeliveries.map((d) => d.trainingSession.userId)]);
      let changed = 0;
      let failed = 0;
      for (const userId of userIds) {
        try {
          const result = await this.publisher.reconcile(userId);
          if (result.status === 'published') changed += 1;
          if (result.status === 'failed') failed += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn(`Reconciliacao COROS falhou para um aluno: ${(error as Error).message}`);
        }
      }
      if (changed > 0 || failed > 0) this.logger.log(`Treinos COROS: ${userIds.size} aluno(s) verificado(s), ${changed} atualizado(s), ${failed} falha(s).`);
    } catch (error) {
      this.logger.warn(`Falha na reconciliacao de treinos COROS: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
