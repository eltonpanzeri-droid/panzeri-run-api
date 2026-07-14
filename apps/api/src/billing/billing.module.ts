import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { TelegramService } from './telegram.service';

@Module({ controllers: [BillingController], providers: [BillingService, TelegramService], exports: [BillingService] })
export class BillingModule {}