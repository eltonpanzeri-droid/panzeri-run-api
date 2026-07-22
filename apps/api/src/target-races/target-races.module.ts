import { Module } from '@nestjs/common';
import { TargetRacesController } from './target-races.controller';
import { TargetRacesService } from './target-races.service';

@Module({
  controllers: [TargetRacesController],
  providers: [TargetRacesService],
  exports: [TargetRacesService],
})
export class TargetRacesModule {}
