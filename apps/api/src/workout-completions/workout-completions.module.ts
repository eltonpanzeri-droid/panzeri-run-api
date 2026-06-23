import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkoutCompletionsController } from './workout-completions.controller';
import { WorkoutCompletionsService } from './workout-completions.service';

@Module({
  imports: [PrismaModule],
  controllers: [WorkoutCompletionsController],
  providers: [WorkoutCompletionsService],
})
export class WorkoutCompletionsModule {}
