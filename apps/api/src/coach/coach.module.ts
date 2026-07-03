import { Module } from '@nestjs/common';
import { CoachController } from './coach.controller';
import { CoachService } from './coach.service';
import { TrainingPlansModule } from '../training-plans/training-plans.module';
import { StravaModule } from '../strava/strava.module';

@Module({
  imports: [TrainingPlansModule, StravaModule],
  controllers: [CoachController],
  providers: [CoachService],
})
export class CoachModule {}
