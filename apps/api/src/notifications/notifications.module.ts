import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationOrchestratorService } from './notification-orchestrator.service';
import { NotificationsService } from './notifications.service';
import { PushNotificationService } from './push-notification.service';

@Module({
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [NotificationsService, PushNotificationService, NotificationOrchestratorService],
  exports: [NotificationsService, NotificationOrchestratorService],
})
export class NotificationsModule {}
