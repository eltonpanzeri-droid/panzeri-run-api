import { Module } from '@nestjs/common';
import { BestMarksCoachController, BestMarksController, BestMarksService } from './best-marks.service';

@Module({
  controllers: [BestMarksController, BestMarksCoachController],
  providers: [BestMarksService],
  exports: [BestMarksService],
})
export class BestMarksModule {}
