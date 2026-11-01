import { Module } from '@nestjs/common';
import { TrainingIntelligenceModule } from '../training-intelligence/training-intelligence.module';
import { AiCostController } from './ai-cost.controller';
import { AiCostRecorderService } from './ai-cost-recorder.service';
import { AiCostService } from './ai-cost.service';

@Module({
  imports: [TrainingIntelligenceModule],
  controllers: [AiCostController],
  providers: [AiCostRecorderService, AiCostService],
})
export class AiCostModule {}
