import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionExecutionLinkService } from './session-execution-link.service';
import { ActivityExecutionController } from './activity-execution.controller';
import { ActivityDetailService } from './activity-detail.service';

// Fundacao Prescricao x Execucao (01/10/2026). Controller adicionado em 02/10/2026 — so' expoe
// confirmCandidate (visualizacao Prescrito x Realizado do aluno); classify() e' acionado apos a
// ingestao Polar (03/10/2026).
@Module({
  imports: [PrismaModule],
  controllers: [ActivityExecutionController],
  providers: [SessionExecutionLinkService, ActivityDetailService],
  exports: [SessionExecutionLinkService],
})
export class ActivityExecutionModule {}
