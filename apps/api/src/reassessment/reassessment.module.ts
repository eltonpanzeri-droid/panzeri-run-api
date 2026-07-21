import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiQueueModule } from '../common/ai-queue.module';
import { ReassessmentController } from './reassessment.controller';
import { ReassessmentService } from './reassessment.service';
import { EvolutionAgentService } from './evolution-agent.service';

@Module({
  imports: [PrismaModule, AiQueueModule],
  controllers: [ReassessmentController],
  providers: [ReassessmentService, EvolutionAgentService],
  exports: [ReassessmentService],
})
export class ReassessmentModule {}
