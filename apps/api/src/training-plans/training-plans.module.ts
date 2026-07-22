import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiQueueModule } from '../common/ai-queue.module';
import { TrainingPlansController } from './training-plans.controller';
import { TrainingPlansService } from './training-plans.service';
import { PrescriptionAgentService } from './prescription-agent.service';
import { StravaAnalysisAgentService } from './strava-analysis-agent.service';
import { WeeklyPlanSchedulerService } from './weekly-plan-scheduler.service';
import { PainReportsModule } from '../pain-reports/pain-reports.module';
import { TargetRacesModule } from '../target-races/target-races.module';

@Module({
  imports: [PrismaModule, AiQueueModule, PainReportsModule, TargetRacesModule],
  controllers: [TrainingPlansController],
  providers: [TrainingPlansService, PrescriptionAgentService, StravaAnalysisAgentService, WeeklyPlanSchedulerService],
  exports: [TrainingPlansService],
})
export class TrainingPlansModule {}
