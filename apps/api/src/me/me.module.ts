import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { TrainingPlansModule } from '../training-plans/training-plans.module';
import { BillingModule } from '../billing/billing.module';
import { ReporterModule } from '../reporter/reporter.module';
import { TrainingIntelligenceModule } from '../training-intelligence/training-intelligence.module';

@Module({
  imports: [TrainingPlansModule, BillingModule, ReporterModule, TrainingIntelligenceModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
