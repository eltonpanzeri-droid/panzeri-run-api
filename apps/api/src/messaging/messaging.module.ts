import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailService } from './email.service';
import { MessagingService } from './messaging.service';
import { NotificationTriggersService } from './notification-triggers.service';

@Module({
  imports: [PrismaModule],
  providers: [EmailService, MessagingService, NotificationTriggersService],
  exports: [MessagingService, EmailService],
})
export class MessagingModule {}
