import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// Notificacao pos-sincronizacao (03/10/2026). Canonica e provider-agnostica: qualquer adapter que
// termina o pipeline (ingestao -> classify) chama isto com o resultado da reconciliacao. Reutiliza
// NotificationsService (push + UserNotification). Idempotente pela chave externalRef
// (activityLogId + classificacao): webhook, polling, retry, resync ou botao manual nunca geram duas
// notificacoes para o mesmo estado da mesma atividade. Uma mudanca real de estado (ex.: ambiguous ->
// corresponding apos confirmacao) gera uma nova notificacao, por ser outro evento.
@Injectable()
export class ActivityNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async notifyReconciliation(userId: string, activityLogId: string, classification: string | null): Promise<boolean> {
    if (!classification) return false;
    const copy = await this.copyFor(activityLogId, classification);
    if (!copy) return false;
    return this.notifications.notifyUserIfNotRecent(
      userId,
      {
        title: copy.title,
        message: copy.message,
        type: 'activity_sync',
        action: copy.action,
        externalRef: `activity-reconciled:${activityLogId}:${classification}`,
      },
      0,
    );
  }

  private async copyFor(activityLogId: string, classification: string) {
    if (classification === 'corresponding') {
      const link = await this.prisma.sessionExecutionLink.findFirst({
        where: { activityLogId, status: 'active' },
        select: { trainingSessionId: true },
      });
      return {
        title: 'Seu treino foi sincronizado!',
        message: 'Registramos automaticamente seu último treino. Complete o feedback para nos contar como você respondeu a ele.',
        action: link ? `training_feedback:${link.trainingSessionId}` : 'training_view',
      };
    }
    if (classification === 'alternative') {
      return {
        title: 'Nova atividade sincronizada!',
        message: 'Registramos uma atividade que não corresponde ao treino programado. Quer contar como foi?',
        action: `alternative_feedback:${activityLogId}`,
      };
    }
    if (classification === 'ambiguous') {
      return {
        title: 'Precisamos identificar uma atividade',
        message: 'Encontramos uma atividade que pode ser um dos seus treinos. Toque para confirmar qual é.',
        action: `activity_resolve:${activityLogId}`,
      };
    }
    return null;
  }
}
