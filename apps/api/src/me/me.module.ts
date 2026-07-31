import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { TrainingPlansModule } from '../training-plans/training-plans.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TrainingPlansModule, BillingModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
