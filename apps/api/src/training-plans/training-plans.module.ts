import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiQueueModule } from '../common/ai-queue.module';
import { TrainingPlansController } from './training-plans.controller';
import { TrainingPlansService } from './training-plans.service';
import { WeeklyCheckInService } from './weekly-checkin.service';
import { PrescriptionAgentService } from './prescription-agent.service';
import { StravaAnalysisAgentService } from './strava-analysis-agent.service';
import { StudentProfileModule } from './student-profile.module';
import { WeeklyPlanSchedulerService } from './weekly-plan-scheduler.service';
import { StravaAnalysisSchedulerService } from './strava-analysis-scheduler.service';
import { DirectiveExpiryNotifierService } from './directive-expiry-notifier.service';
import { PainReportsModule } from '../pain-reports/pain-reports.module';
import { TargetRacesModule } from '../target-races/target-races.module';
import { StravaModule } from '../strava/strava.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, AiQueueModule, PainReportsModule, TargetRacesModule, StravaModule, forwardRef(() => BillingModule), StudentProfileModule, NotificationsModule],
  controllers: [TrainingPlansController],
  providers: [TrainingPlansService, PrescriptionAgentService, StravaAnalysisAgentService, WeeklyPlanSchedulerService, StravaAnalysisSchedulerService, DirectiveExpiryNotifierService, WeeklyCheckInService],
  exports: [TrainingPlansService, StudentProfileModule, WeeklyPlanSchedulerService],
})
export class TrainingPlansModule {}
