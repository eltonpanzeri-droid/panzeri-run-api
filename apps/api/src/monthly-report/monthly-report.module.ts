import { Module } from '@nestjs/common';
import { BestMarksModule } from '../best-marks/best-marks.module';
import { MessagingModule } from '../messaging/messaging.module';
import { MonthlyReportCoachController, MonthlyReportPublicController, MonthlyReportScheduler, MonthlyReportService } from './monthly-report.service';

@Module({
  imports: [MessagingModule, BestMarksModule],
  controllers: [MonthlyReportPublicController, MonthlyReportCoachController],
  providers: [MonthlyReportService, MonthlyReportScheduler],
  exports: [MonthlyReportService],
})
export class MonthlyReportModule {}
