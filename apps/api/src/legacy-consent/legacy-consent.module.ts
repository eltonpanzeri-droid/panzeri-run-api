import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { LegacyConsentController } from './legacy-consent.controller';
import { LegacyConsentService } from './legacy-consent.service';

@Module({
  imports: [PrismaModule, ActivityExecutionModule],
  controllers: [LegacyConsentController],
  providers: [LegacyConsentService],
  exports: [LegacyConsentService],
})
export class LegacyConsentModule {}
