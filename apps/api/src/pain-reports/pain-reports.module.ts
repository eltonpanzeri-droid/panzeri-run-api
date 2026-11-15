import { Module } from '@nestjs/common';
import { StudentProfileModule } from '../training-plans/student-profile.module';
import { PainReportsController } from './pain-reports.controller';
import { PainReportsService } from './pain-reports.service';
import { ReporterModule } from '../reporter/reporter.module';
import { TrainingIntelligenceModule } from '../training-intelligence/training-intelligence.module';

@Module({
  imports: [StudentProfileModule, ReporterModule, TrainingIntelligenceModule],
  controllers: [PainReportsController],
  providers: [PainReportsService],
  exports: [PainReportsService],
})
export class PainReportsModule {}
