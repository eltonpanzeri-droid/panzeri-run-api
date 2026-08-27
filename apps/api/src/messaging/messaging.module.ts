import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EmailService } from './email.service';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { NotificationTriggersService } from './notification-triggers.service';
import { ProspectNurtureService } from './prospect-nurture.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MessagingController],
  providers: [EmailService, MessagingService, NotificationTriggersService, ProspectNurtureService],
  exports: [MessagingService, EmailService, NotificationTriggersService, ProspectNurtureService],
})
export class MessagingModule {}
