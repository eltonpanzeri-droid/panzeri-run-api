import { Module } from '@nestjs/common';
import { PhysiologyModule } from '../physiology/physiology.module';
import { EvolutionModule } from '../evolution/evolution.module';
import { ObservationReaderService } from './observation-reader.service';
import { MathLayerService } from './math-layer.service';
import { LongitudinalDynamicsService } from './longitudinal-dynamics.service';
import { TrainingIntelligenceQueryService } from './training-intelligence-query.service';
import { AthleteStateSnapshotService } from './athlete-state-snapshot.service';
import { ContextEventsModule } from '../context-events/context-events.module';
import { HealthIndicatorsService } from './health-indicators.service';
import { HrDecouplingBackfillService } from './hr-decoupling-backfill.service';
import { EvolutionSummaryService } from './evolution-summary.service';

@Module({
  imports: [EvolutionModule, ContextEventsModule, PhysiologyModule],
  providers: [ObservationReaderService, MathLayerService, LongitudinalDynamicsService, TrainingIntelligenceQueryService, AthleteStateSnapshotService, HealthIndicatorsService, HrDecouplingBackfillService, EvolutionSummaryService],
  exports: [ObservationReaderService, MathLayerService, LongitudinalDynamicsService, TrainingIntelligenceQueryService, AthleteStateSnapshotService, HealthIndicatorsService, EvolutionSummaryService],
})
export class TrainingIntelligenceModule {}
