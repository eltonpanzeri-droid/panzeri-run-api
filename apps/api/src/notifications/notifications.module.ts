import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationOrchestratorService } from './notification-orchestrator.service';
import { NotificationLogController } from './notification-log.controller';
import { ProactiveNotificationsService } from './proactive-notifications.service';
import { NotificationsService } from './notifications.service';
import { PushNotificationService } from './push-notification.service';

@Module({
  controllers: [NotificationsController, NotificationPreferencesController, NotificationLogController],
  providers: [NotificationsService, PushNotificationService, NotificationOrchestratorService, ProactiveNotificationsService],
  exports: [NotificationsService, NotificationOrchestratorService],
})
export class NotificationsModule {}
