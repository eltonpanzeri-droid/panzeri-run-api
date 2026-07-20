import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReassessmentController } from './reassessment.controller';
import { ReassessmentService } from './reassessment.service';
import { EvolutionAgentService } from './evolution-agent.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReassessmentController],
  providers: [ReassessmentService, EvolutionAgentService],
  exports: [ReassessmentService],
})
export class ReassessmentModule {}
