import { Module } from '@nestjs/common';
import { CoachController } from './coach.controller';
import { CoachToolingController } from './coach-tooling.controller';
import { CoachService } from './coach.service';
import { BusinessIntelligenceService } from './business-intelligence.service';
import { TrainingPlansModule } from '../training-plans/training-plans.module';
import { MessagingModule } from '../messaging/messaging.module';
import { BackupModule } from '../backup/backup.module';
import { AccountDeletionModule } from '../account-deletion/account-deletion.module';
import { MeModule } from '../me/me.module';
import { BillingModule } from '../billing/billing.module';
import { MenstrualCycleModule } from '../menstrual-cycle/menstrual-cycle.module';
import { TrainingIntelligenceModule } from '../training-intelligence/training-intelligence.module';
import { ContextEventsModule } from '../context-events/context-events.module';
import { ReassessmentModule } from '../reassessment/reassessment.module';
import { EvolutionModule } from '../evolution/evolution.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';

@Module({
  imports: [TrainingPlansModule, MessagingModule, BackupModule, MeModule, BillingModule, MenstrualCycleModule, TrainingIntelligenceModule, ContextEventsModule, ReassessmentModule, EvolutionModule, ActivityExecutionModule, AccountDeletionModule],
  controllers: [CoachController, CoachToolingController],
  providers: [CoachService, BusinessIntelligenceService],
})
export class CoachModule {}
