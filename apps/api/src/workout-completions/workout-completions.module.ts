import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StudentProfileModule } from '../training-plans/student-profile.module';
import { BillingModule } from '../billing/billing.module';
import { WorkoutCompletionsController } from './workout-completions.controller';
import { WorkoutCompletionsService } from './workout-completions.service';
import { ContextEventsModule } from '../context-events/context-events.module';

@Module({
  imports: [PrismaModule, StudentProfileModule, BillingModule, ContextEventsModule],
  controllers: [WorkoutCompletionsController],
  providers: [WorkoutCompletionsService],
})
export class WorkoutCompletionsModule {}
