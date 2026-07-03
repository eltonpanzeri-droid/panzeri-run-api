import { Module } from '@nestjs/common';
import { CoachController } from './coach.controller';
import { CoachService } from './coach.service';
import { TrainingPlansModule } from '../training-plans/training-plans.module';

@Module({
  imports: [TrainingPlansModule],
  controllers: [CoachController],
  providers: [CoachService],
})
export class CoachModule {}
