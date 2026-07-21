import { Module } from '@nestjs/common';
import { AiQueueService } from './ai-queue.service';

@Module({
  providers: [AiQueueService],
  exports: [AiQueueService],
})
export class AiQueueModule {}
