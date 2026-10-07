import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// Notificacao pos-sincronizacao (03/10/2026). Canonica e provider-agnostica: qualquer adapter que
// termina o pipeline (ingestao -> classify) chama isto com o resultado da reconciliacao. Reutiliza
// NotificationsService (push + UserNotification).
//
// 3C.3 — a unidade da notificacao e' o PHYSICALEVENT, nao a observacao. Chave de idempotencia (externalRef):
//   - atividade 'unique' (ou sem evento): activity-reconciled:<activityLogId>:<classificacao>   (formato original, inalterado)
//   - evento 'matched':                   activity-reconciled:event:<physicalEventId>:<transicao>
//       transicao = 'corresponding:<trainingSessionId>' | 'alternative' | 'ambiguous'
// Somente a observacao CANONICA origina a notificacao do evento (a copia nao-canonica nao notifica); webhook, polling, retry, resync, chegada
// posterior da copia ou botao manual nunca geram duas notificacoes para o mesmo evento e a mesma transicao. Uma mudanca real de estado
// (ambiguous -> corresponding, corresponding a OUTRA sessao, alternative -> corresponding) e' outra transicao e gera nova notificacao.
// Compatibilidade: se a canonica ja' havia sido notificada no formato original (antes de o evento existir), nao notifica de novo.
@Injectable()
export class ActivityNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async notifyReconciliation(userId: string, activityLogId: string, classification: string | null): Promise<boolean> {
    if (!classification) return false;
    const activity = await this.prisma.activityLog.findUnique({
      where: { id: activityLogId },
      select: { id: true, physicalIdentityStatus: true, physicalEventId: true, physicalCanonicalActivityLogId: true },
    });
    const isEvent = activity?.physicalIdentityStatus === 'matched' && Boolean(activity.physicalEventId);
    // Observacao nao-canonica de um evento: quem origina a notificacao e' a canonica.
    if (isEvent && activity!.physicalCanonicalActivityLogId && activity!.physicalCanonicalActivityLogId !== activityLogId) return false;
    const copy = await this.copyFor(activityLogId, classification);
    if (!copy) return false;
    let externalRef = `activity-reconciled:${activityLogId}:${classification}`;
    if (isEvent) {
      const transition = classification === 'corresponding' ? `corresponding:${copy.sessionId ?? 'none'}` : classification;
      externalRef = `activity-reconciled:event:${activity!.physicalEventId}:${transition}`;
      // Ja' notificada no formato original (antes do evento): mesmo estado, nao repete.
      const legacy = await this.prisma.userNotification.findFirst({
        where: { userId, type: 'activity_sync', externalRef: `activity-reconciled:${activityLogId}:${classification}` },
        select: { id: true },
      });
      if (legacy) return false;
    }
    return this.notifications.notifyUserIfNotRecent(
      userId,
      {
        title: copy.title,
        message: copy.message,
        type: 'activity_sync',
        action: copy.action,
        externalRef,
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
        sessionId: link?.trainingSessionId ?? null,
      };
    }
    if (classification === 'alternative') {
      return {
        title: 'Nova atividade sincronizada!',
        message: 'Registramos uma atividade que não corresponde ao treino programado. Quer contar como foi?',
        action: `alternative_feedback:${activityLogId}`,
        sessionId: null as string | null,
      };
    }
    if (classification === 'ambiguous') {
      return {
        title: 'Precisamos identificar uma atividade',
        message: 'Encontramos uma atividade que pode ser um dos seus treinos. Toque para confirmar qual é.',
        action: `activity_resolve:${activityLogId}`,
        sessionId: null as string | null,
      };
    }
    return null;
  }
}
