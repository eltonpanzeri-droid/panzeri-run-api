import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StravaModule } from '../strava/strava.module';
import { AiQueueModule } from '../common/ai-queue.module';
import { TrainingPlansModule } from '../training-plans/training-plans.module';
import { TechnicalManagerController } from './technical-manager.controller';
import { TechnicalManagerAgentService } from './technical-manager-agent.service';

@Module({
  imports: [PrismaModule, StravaModule, AiQueueModule, TrainingPlansModule],
  controllers: [TechnicalManagerController],
  providers: [TechnicalManagerAgentService],
})
export class TechnicalManagerModule {}
