import { Module } from '@nestjs/common';
import { EvolutionModule } from '../evolution/evolution.module';
import { ObservationReaderService } from './observation-reader.service';
import { MathLayerService } from './math-layer.service';
import { LongitudinalDynamicsService } from './longitudinal-dynamics.service';
import { TrainingIntelligenceQueryService } from './training-intelligence-query.service';
import { AthleteStateSnapshotService } from './athlete-state-snapshot.service';

@Module({
  imports: [EvolutionModule],
  providers: [ObservationReaderService, MathLayerService, LongitudinalDynamicsService, TrainingIntelligenceQueryService, AthleteStateSnapshotService],
  exports: [ObservationReaderService, MathLayerService, LongitudinalDynamicsService, TrainingIntelligenceQueryService, AthleteStateSnapshotService],
})
export class TrainingIntelligenceModule {}
