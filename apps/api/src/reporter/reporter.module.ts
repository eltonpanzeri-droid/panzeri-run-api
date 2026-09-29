import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiQueueModule } from '../common/ai-queue.module';
import { ReportTimelineService } from './report-timeline.service';
import { StudentReporterAgentService } from './student-reporter-agent.service';
import { AiOptimizationDiagnosticsController } from './ai-optimization-diagnostics.controller';

@Module({
  imports: [PrismaModule, AiQueueModule],
  controllers: [AiOptimizationDiagnosticsController],
  providers: [ReportTimelineService, StudentReporterAgentService],
  exports: [ReportTimelineService],
})
export class ReporterModule {}
