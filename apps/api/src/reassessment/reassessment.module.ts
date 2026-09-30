import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiQueueModule } from '../common/ai-queue.module';
import { StudentProfileModule } from '../training-plans/student-profile.module';
import { TrainingIntelligenceModule } from '../training-intelligence/training-intelligence.module';
import { ReassessmentController } from './reassessment.controller';
import { ReassessmentService } from './reassessment.service';
import { EvolutionAgentModule } from './evolution-agent.module';
import { ReporterModule } from '../reporter/reporter.module';
import { MedalsModule } from '../medals/medals.module';

@Module({
  imports: [PrismaModule, AiQueueModule, StudentProfileModule, TrainingIntelligenceModule, ReporterModule, EvolutionAgentModule, MedalsModule],
  controllers: [ReassessmentController],
  providers: [ReassessmentService],
  exports: [ReassessmentService],
})
export class ReassessmentModule {}
