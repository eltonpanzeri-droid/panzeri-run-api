import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TrainingIntelligenceModule } from '../training-intelligence/training-intelligence.module';
import { MenstrualCycleController } from './menstrual-cycle.controller';
import { MenstrualCycleService } from './menstrual-cycle.service';

@Module({
  // TrainingIntelligenceModule: reaproveita MathLayerService/LongitudinalDynamicsService pra
  // duracao/variabilidade real de ciclo — nenhuma matematica nova (25/09/2026).
  imports: [PrismaModule, TrainingIntelligenceModule],
  controllers: [MenstrualCycleController],
  providers: [MenstrualCycleService],
  exports: [MenstrualCycleService],
})
export class MenstrualCycleModule {}
