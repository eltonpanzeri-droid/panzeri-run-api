import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TrainingPlansController } from './training-plans.controller';
import { TrainingPlansService } from './training-plans.service';
import { PrescriptionAgentService } from './prescription-agent.service';
import { StravaAnalysisAgentService } from './strava-analysis-agent.service';

@Module({
  imports: [PrismaModule],
  controllers: [TrainingPlansController],
  providers: [TrainingPlansService, PrescriptionAgentService, StravaAnalysisAgentService],
  exports: [TrainingPlansService],
})
export class TrainingPlansModule {}
