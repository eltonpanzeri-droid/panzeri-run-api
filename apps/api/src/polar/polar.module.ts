import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityTimeSeriesModule } from '../activity-timeseries/activity-timeseries.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { PolarController } from './polar.controller';
import { PolarService } from './polar.service';
import { PolarActivityIngestionService } from './polar-activity-ingestion.service';
import { PolarSyncFallbackSchedulerService } from './polar-sync-fallback-scheduler.service';
import { PolarWebhookService } from './polar-webhook.service';
import { PolarHealthConsentService } from './polar-health-consent.service';
import { PolarHealthIngestionService } from './polar-health-ingestion.service';
import { PolarHealthController } from './polar-health.controller';
import { PolarProbeService } from './polar-probe.service';
import { PolarProbeController } from './polar-probe.controller';

@Module({
  imports: [PrismaModule, ActivityTimeSeriesModule, ActivityExecutionModule],
  controllers: [PolarController, PolarHealthController, PolarProbeController],
  providers: [PolarService, PolarActivityIngestionService, PolarSyncFallbackSchedulerService, PolarWebhookService, PolarHealthConsentService, PolarHealthIngestionService, PolarProbeService],
  exports: [PolarService],
})
export class PolarModule {}