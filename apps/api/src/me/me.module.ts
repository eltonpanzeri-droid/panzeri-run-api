import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { RoutineService } from './routine.service';
import { StrengthSplitService } from './strength-split.service';
import { TrainingPlansModule } from '../training-plans/training-plans.module';
import { BillingModule } from '../billing/billing.module';
import { ReporterModule } from '../reporter/reporter.module';
import { TrainingIntelligenceModule } from '../training-intelligence/training-intelligence.module';
import { ProfilePhotoModule } from '../profile-photo/profile-photo.module';
import { HealthConnectModule } from '../health-connect/health-connect.module';

@Module({
  imports: [TrainingPlansModule, BillingModule, ReporterModule, TrainingIntelligenceModule, ProfilePhotoModule, HealthConnectModule],
  controllers: [MeController],
  providers: [MeService, RoutineService, StrengthSplitService],
  exports: [MeService, RoutineService, StrengthSplitService],
})
export class MeModule {}
