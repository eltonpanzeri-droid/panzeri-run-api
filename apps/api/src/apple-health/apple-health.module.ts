import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { AppleHealthController } from './apple-health.controller';
import { AppleHealthIngestionService } from './apple-health-ingestion.service';
import { AppleHealthConsentService } from './apple-health-consent.service';
import { DeviceRegistryModule } from '../equipment/device-registry.module';

@Module({
  imports: [PrismaModule, ActivityExecutionModule, DeviceRegistryModule],
  controllers: [AppleHealthController],
  providers: [AppleHealthIngestionService, AppleHealthConsentService],
})
export class AppleHealthModule {}
