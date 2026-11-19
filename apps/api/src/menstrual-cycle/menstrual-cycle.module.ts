import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TrainingIntelligenceModule } from '../training-intelligence/training-intelligence.module';
import { MenstrualCycleController } from './menstrual-cycle.controller';
import { MenstrualCycleService } from './menstrual-cycle.service';
import { MenstrualReportService } from './menstrual-report.service';
import { WomanAgentService } from './woman-agent.service';
import { AiQueueModule } from '../common/ai-queue.module';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';

@Module({
  // TrainingIntelligenceModule: reaproveita MathLayerService/LongitudinalDynamicsService pra
  // duracao/variabilidade real de ciclo — nenhuma matematica nova (25/09/2026).
  imports: [PrismaModule, TrainingIntelligenceModule, AiQueueModule, AiGovernanceModule],
  controllers: [MenstrualCycleController],
  providers: [MenstrualCycleService, MenstrualReportService, WomanAgentService],
  exports: [MenstrualCycleService],
})
export class MenstrualCycleModule {}
