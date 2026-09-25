import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MenstrualCycleModule } from '../menstrual-cycle/menstrual-cycle.module';
import { EmailService } from './email.service';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { NotificationTriggersService } from './notification-triggers.service';
import { ProspectNurtureService } from './prospect-nurture.service';

@Module({
  // 05/09: NotificationsModule adicionado para que NotificationTriggersService possa disparar
  // push notifications junto com os e-mails do cron diário (ex: overdue reminder às 9h).
  // MenstrualCycleModule (25/09/2026): reaproveita getCycleOverview() ja calculado — nenhuma
  // segunda logica de "fim provavel"/"atraso" fora da fonte canonica.
  imports: [PrismaModule, AuthModule, NotificationsModule, MenstrualCycleModule],
  controllers: [MessagingController],
  providers: [EmailService, MessagingService, NotificationTriggersService, ProspectNurtureService],
  exports: [MessagingService, EmailService, NotificationTriggersService, ProspectNurtureService],
})
export class MessagingModule {}
