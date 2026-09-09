import { Module } from '@nestjs/common';
import { EvolutionMetricService } from './evolution-metric.service';

@Module({
  providers: [EvolutionMetricService],
  exports: [EvolutionMetricService],
})
export class EvolutionModule {}
