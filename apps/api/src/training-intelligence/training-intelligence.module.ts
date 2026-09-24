import { Module } from '@nestjs/common';
import { ObservationReaderService } from './observation-reader.service';
import { MathLayerService } from './math-layer.service';
import { LongitudinalDynamicsService } from './longitudinal-dynamics.service';
import { TrainingIntelligenceQueryService } from './training-intelligence-query.service';

@Module({
  providers: [ObservationReaderService, MathLayerService, LongitudinalDynamicsService, TrainingIntelligenceQueryService],
  exports: [ObservationReaderService, MathLayerService, LongitudinalDynamicsService, TrainingIntelligenceQueryService],
})
export class TrainingIntelligenceModule {}
