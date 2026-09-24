import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiQueueModule } from '../common/ai-queue.module';
import { StudentProfileModule } from '../training-plans/student-profile.module';
import { TrainingIntelligenceModule } from '../training-intelligence/training-intelligence.module';
import { ReassessmentController } from './reassessment.controller';
import { ReassessmentService } from './reassessment.service';
import { EvolutionAgentService } from './evolution-agent.service';

@Module({
  imports: [PrismaModule, AiQueueModule, StudentProfileModule, TrainingIntelligenceModule],
  controllers: [ReassessmentController],
  providers: [ReassessmentService, EvolutionAgentService],
  exports: [ReassessmentService],
})
export class ReassessmentModule {}
