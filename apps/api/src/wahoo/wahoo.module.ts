import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { WahooController } from './wahoo.controller';
import { WahooService } from './wahoo.service';
import { WahooActivityIngestionService } from './wahoo-activity-ingestion.service';
import { WahooWebhookService } from './wahoo-webhook.service';
import { WahooSyncFallbackSchedulerService } from './wahoo-sync-fallback-scheduler.service';

@Module({
  imports: [PrismaModule, ActivityExecutionModule],
  controllers: [WahooController],
  providers: [WahooService, WahooActivityIngestionService, WahooWebhookService, WahooSyncFallbackSchedulerService],
  // Exportado para a exclusao de conta (revogacao) e, nas Etapas 4/5, para quem precisar de getAccessToken().
  exports: [WahooService],
})
export class WahooModule {}
