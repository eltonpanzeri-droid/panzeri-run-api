import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { BlockReason, decideNotification, defaultPreferences, DEFAULT_TZ_OFFSET_MINUTES, localDayStartUtc, normalizePreferences, NotificationPreferences, NOTIFICATION_BANDS, NOTIFICATION_CATEGORIES } from './notification-policy';

export interface ProactiveNotification {
  ruleId: string; // quem pediu o aviso (ex.: 'dica_sono_ruim'); vai para o registro
  category: string; // uma das categorias de NOTIFICATION_CATEGORIES
  title: string;
  message: string;
  type?: string; // tipo do sino; padrao = a categoria
  action?: string;
  externalRef?: string; // mesmo evento nunca avisa duas vezes
  repeatWindowHours?: number; // sem externalRef: nao repete a mesma regra dentro da janela (padrao 24 h)
  pushTitle?: string;
  pushMessage?: string; // texto discreto para a tela bloqueada (dado de saude)
  now?: Date; // so' para teste
}

export type DispatchResult = { sent: true } | { sent: false; reason: BlockReason | 'duplicate' | 'error' };

// Orquestrador unico dos avisos PROATIVOS (19/11/2026). Quem quiser avisar a aluna por conta propria chama dispatch(): ele respeita as preferencias dela (categoria, quantidade por dia, horario, teto
// diario) e registra cada tentativa (enviada ou barrada, com o motivo). Avisos de evento (pagamento, treino sincronizado etc.) continuam usando NotificationsService direto. Nunca lanca: falha aqui nunca
// derruba quem chamou.
@Injectable()
export class NotificationOrchestratorService {
  private readonly logger = new Logger(NotificationOrchestratorService.name);

  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return normalizePreferences(row);
  }

  async savePreferences(userId: string, input: unknown): Promise<NotificationPreferences> {
    const prefs = normalizePreferences(input);
    const data = { dailyCap: prefs.dailyCap, windowStartHour: prefs.windowStartHour, windowEndHour: prefs.windowEndHour, categories: prefs.categories as unknown as Prisma.InputJsonObject };
    await this.prisma.notificationPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return prefs;
  }

  // O que o app precisa para montar a tela: preferencias atuais + categorias e faixas oferecidas + padrao.
  async screenData(userId: string) {
    return { preferences: await this.getPreferences(userId), categories: NOTIFICATION_CATEGORIES, bands: NOTIFICATION_BANDS, defaults: defaultPreferences() };
  }

  async dispatch(userId: string, notification: ProactiveNotification): Promise<DispatchResult> {
    const now = notification.now ?? new Date();
    try {
      const prefs = await this.getPreferences(userId);
      const dayStart = localDayStartUtc(now, DEFAULT_TZ_OFFSET_MINUTES);
      const [sentTodayTotal, sentTodayInCategory] = await Promise.all([
        this.prisma.notificationSendLog.count({ where: { userId, status: 'sent', createdAt: { gte: dayStart } } }),
        this.prisma.notificationSendLog.count({ where: { userId, status: 'sent', category: notification.category, createdAt: { gte: dayStart } } }),
      ]);
      const decision = decideNotification({ prefs, category: notification.category, now, sentTodayTotal, sentTodayInCategory });
      if (!decision.allow) return await this.record(userId, notification, 'blocked', decision.reason);

      const created = await this.notifications.notifyUserIfNotRecent(
        userId,
        { title: notification.title, message: notification.message, type: notification.type ?? notification.category, action: notification.action, externalRef: notification.externalRef, pushTitle: notification.pushTitle, pushMessage: notification.pushMessage },
        notification.repeatWindowHours ?? 24,
      );
      return await this.record(userId, notification, created ? 'sent' : 'blocked', created ? null : 'duplicate');
    } catch (error) {
      this.logger.warn(`Aviso proativo nao enviado (${notification.ruleId}): ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
      return { sent: false, reason: 'error' };
    }
  }

  private async record(userId: string, notification: ProactiveNotification, status: 'sent' | 'blocked', reason: BlockReason | 'duplicate' | null): Promise<DispatchResult> {
    await this.prisma.notificationSendLog.create({ data: { userId, category: notification.category, ruleId: notification.ruleId, status, reason } }).catch(() => undefined);
    return status === 'sent' ? { sent: true } : { sent: false, reason: reason as BlockReason | 'duplicate' };
  }
}
