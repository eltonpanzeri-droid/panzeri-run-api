import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionExecutionLinkService } from './session-execution-link.service';
import { ActivityExecutionController } from './activity-execution.controller';
import { ActivityDetailService } from './activity-detail.service';
import { ActivityNotificationService } from './activity-notification.service';
import { ProviderDataDeletionService } from './provider-data-deletion.service';
import { PhysicalActivityIdentityService } from './physical-activity-identity.service';
import { ExecutionAnalysisService } from './execution-analysis.service';
import { TombstoneModule } from '../backup/tombstone.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ActivityTimeSeriesModule } from '../activity-timeseries/activity-timeseries.module';

// Fundacao Prescricao x Execucao (01/10/2026). Controller adicionado em 02/10/2026 — so' expoe
// confirmCandidate (visualizacao Prescrito x Realizado do aluno); classify() e' acionado apos a
// ingestao Polar (03/10/2026).
@Module({
  imports: [PrismaModule, NotificationsModule, ActivityTimeSeriesModule, TombstoneModule],
  controllers: [ActivityExecutionController],
  providers: [SessionExecutionLinkService, ActivityDetailService, ActivityNotificationService, ProviderDataDeletionService, PhysicalActivityIdentityService, ExecutionAnalysisService],
  exports: [SessionExecutionLinkService, ActivityNotificationService, ProviderDataDeletionService, PhysicalActivityIdentityService, ExecutionAnalysisService],
})
export class ActivityExecutionModule {}
