import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { TrainingIntelligenceModule } from '../training-intelligence/training-intelligence.module';
import { AiCostController } from './ai-cost.controller';
import { AiCostRecorderService } from './ai-cost-recorder.service';
import { AiCostService } from './ai-cost.service';
import { CacheMilestoneNotifierService } from './cache-milestone-notifier.service';

@Module({
  imports: [TrainingIntelligenceModule, BillingModule],
  controllers: [AiCostController],
  providers: [AiCostRecorderService, AiCostService, CacheMilestoneNotifierService],
})
export class AiCostModule {}
