import { Module } from '@nestjs/common';
import { EvolutionController } from './evolution.controller';
import { EvolutionMetricService } from './evolution-metric.service';

@Module({
  controllers: [EvolutionController],
  providers: [EvolutionMetricService],
  exports: [EvolutionMetricService],
})
export class EvolutionModule {}
