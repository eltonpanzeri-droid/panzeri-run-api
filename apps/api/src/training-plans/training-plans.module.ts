import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiQueueModule } from '../common/ai-queue.module';
import { TrainingPlansController } from './training-plans.controller';
import { TrainingPlansService } from './training-plans.service';
import { WeeklyCheckInService } from './weekly-checkin.service';
import { PrescriptionAgentService } from './prescription-agent.service';
import { StudentProfileModule } from './student-profile.module';
import { WeeklyPlanSchedulerService } from './weekly-plan-scheduler.service';
import { DirectiveExpiryNotifierService } from './directive-expiry-notifier.service';
import { PainReportsModule } from '../pain-reports/pain-reports.module';
import { TargetRacesModule } from '../target-races/target-races.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MenstrualCycleModule } from '../menstrual-cycle/menstrual-cycle.module';
import { TrainingIntelligenceModule } from '../training-intelligence/training-intelligence.module';
import { ReassessmentModule } from '../reassessment/reassessment.module';
import { ReporterModule } from '../reporter/reporter.module';
import { MedalsModule } from '../medals/medals.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { ShoesModule } from '../shoes/shoes.module';

@Module({
  imports: [PrismaModule, AiQueueModule, PainReportsModule, TargetRacesModule, forwardRef(() => BillingModule), StudentProfileModule, NotificationsModule, MenstrualCycleModule, TrainingIntelligenceModule, ReassessmentModule, ReporterModule, MedalsModule, ActivityExecutionModule, ShoesModule],
  controllers: [TrainingPlansController],
  providers: [TrainingPlansService, PrescriptionAgentService, WeeklyPlanSchedulerService, DirectiveExpiryNotifierService, WeeklyCheckInService],
  exports: [TrainingPlansService, StudentProfileModule, WeeklyPlanSchedulerService],
})
export class TrainingPlansModule {}
