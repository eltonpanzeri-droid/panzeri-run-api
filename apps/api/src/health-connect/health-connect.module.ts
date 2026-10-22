import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { HealthConnectController } from './health-connect.controller';
import { HealthConnectIngestionService } from './health-connect-ingestion.service';
import { HealthConnectConsentService } from './health-connect-consent.service';
import { HealthConnectHealthService } from './health-connect-health.service';
import { HealthConnectRouteService } from './health-connect-route.service';

@Module({
  imports: [PrismaModule, ActivityExecutionModule],
  controllers: [HealthConnectController],
  providers: [HealthConnectIngestionService, HealthConnectConsentService, HealthConnectHealthService, HealthConnectRouteService],
  exports: [HealthConnectConsentService],
})
export class HealthConnectModule {}
