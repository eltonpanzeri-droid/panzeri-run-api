import { forwardRef, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { TelegramService } from './telegram.service';
import { MessagingModule } from '../messaging/messaging.module';
import { TrainingPlansModule } from '../training-plans/training-plans.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // forwardRef: TrainingPlansModule tambem importa BillingModule (por causa do TelegramService) —
  // sem forwardRef dos dois lados, isso vira dependencia circular de modulo e o Nest recusa subir.
  imports: [MessagingModule, forwardRef(() => TrainingPlansModule), NotificationsModule],
  controllers: [BillingController],
  providers: [BillingService, TelegramService],
  exports: [BillingService, TelegramService],
})
export class BillingModule {}