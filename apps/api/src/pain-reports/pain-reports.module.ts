import { Module } from '@nestjs/common';
import { PainReportsController } from './pain-reports.controller';
import { PainReportsService } from './pain-reports.service';

@Module({
  controllers: [PainReportsController],
  providers: [PainReportsService],
  exports: [PainReportsService],
})
export class PainReportsModule {}
