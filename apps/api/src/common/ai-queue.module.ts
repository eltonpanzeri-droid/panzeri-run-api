import { Module } from '@nestjs/common';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';
import { AiQueueService } from './ai-queue.service';

@Module({
  imports: [AiGovernanceModule],
  providers: [AiQueueService],
  exports: [AiQueueService],
})
export class AiQueueModule {}
