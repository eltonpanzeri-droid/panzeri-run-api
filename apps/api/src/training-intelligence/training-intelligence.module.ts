import { Module } from '@nestjs/common';
import { ObservationReaderService } from './observation-reader.service';
import { MathLayerService } from './math-layer.service';
import { TrainingIntelligenceQueryService } from './training-intelligence-query.service';

@Module({
  providers: [ObservationReaderService, MathLayerService, TrainingIntelligenceQueryService],
  exports: [ObservationReaderService, MathLayerService, TrainingIntelligenceQueryService],
})
export class TrainingIntelligenceModule {}
