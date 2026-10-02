import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionExecutionLinkService } from './session-execution-link.service';
import { ActivityExecutionController } from './activity-execution.controller';

// Fundacao Prescricao x Execucao (01/10/2026). Controller adicionado em 02/10/2026 — so' expoe
// confirmCandidate (visualizacao Prescrito x Realizado do aluno); classify() continua sem nenhum
// adapter de provedor acionando automaticamente ainda.
@Module({
  imports: [PrismaModule],
  controllers: [ActivityExecutionController],
  providers: [SessionExecutionLinkService],
  exports: [SessionExecutionLinkService],
})
export class ActivityExecutionModule {}
