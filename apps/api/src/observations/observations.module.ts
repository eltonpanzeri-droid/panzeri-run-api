import { Module } from '@nestjs/common';
import { ObservationsController } from './observations.controller';
import { ObservationsService } from './observations.service';
import { BillingModule } from '../billing/billing.module';
import { StudentProfileModule } from '../training-plans/student-profile.module';
import { ReporterModule } from '../reporter/reporter.module';

@Module({
  imports: [BillingModule, StudentProfileModule, ReporterModule],
  controllers: [ObservationsController],
  providers: [ObservationsService],
  exports: [ObservationsService],
})
export class ObservationsModule {}
