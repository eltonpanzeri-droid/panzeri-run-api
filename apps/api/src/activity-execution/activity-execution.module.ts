import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionExecutionLinkService } from './session-execution-link.service';
import { ActivityExecutionController } from './activity-execution.controller';
import { ActivityDetailService } from './activity-detail.service';
import { ActivityNotificationService } from './activity-notification.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ActivityTimeSeriesModule } from '../activity-timeseries/activity-timeseries.module';

// Fundacao Prescricao x Execucao (01/10/2026). Controller adicionado em 02/10/2026 — so' expoe
// confirmCandidate (visualizacao Prescrito x Realizado do aluno); classify() e' acionado apos a
// ingestao Polar (03/10/2026).
@Module({
  imports: [PrismaModule, NotificationsModule, ActivityTimeSeriesModule],
  controllers: [ActivityExecutionController],
  providers: [SessionExecutionLinkService, ActivityDetailService, ActivityNotificationService],
  exports: [SessionExecutionLinkService, ActivityNotificationService],
})
export class ActivityExecutionModule {}
