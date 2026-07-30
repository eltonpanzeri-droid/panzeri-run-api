import { Module } from '@nestjs/common';
import { ObservationsController } from './observations.controller';
import { ObservationsService } from './observations.service';
import { BillingModule } from '../billing/billing.module';
import { StudentProfileModule } from '../training-plans/student-profile.module';

@Module({
  imports: [BillingModule, StudentProfileModule],
  controllers: [ObservationsController],
  providers: [ObservationsService],
  exports: [ObservationsService],
})
export class ObservationsModule {}
