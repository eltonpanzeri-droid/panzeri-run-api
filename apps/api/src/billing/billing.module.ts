import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { TelegramService } from './telegram.service';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [MessagingModule],
  controllers: [BillingController],
  providers: [BillingService, TelegramService],
  exports: [BillingService],
})
export class BillingModule {}