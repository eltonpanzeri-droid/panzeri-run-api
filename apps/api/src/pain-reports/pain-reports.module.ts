import { Module } from '@nestjs/common';
import { StudentProfileModule } from '../training-plans/student-profile.module';
import { PainReportsController } from './pain-reports.controller';
import { PainReportsService } from './pain-reports.service';

@Module({
  imports: [StudentProfileModule],
  controllers: [PainReportsController],
  providers: [PainReportsService],
  exports: [PainReportsService],
})
export class PainReportsModule {}
