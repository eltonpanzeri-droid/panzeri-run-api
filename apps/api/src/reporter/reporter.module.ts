import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiQueueModule } from '../common/ai-queue.module';
import { ReportTimelineService } from './report-timeline.service';
import { StudentReporterAgentService } from './student-reporter-agent.service';
import { StudentProfileModule } from '../training-plans/student-profile.module';

@Module({
  imports: [PrismaModule, AiQueueModule, StudentProfileModule],
  providers: [ReportTimelineService, StudentReporterAgentService],
  exports: [ReportTimelineService],
})
export class ReporterModule {}
