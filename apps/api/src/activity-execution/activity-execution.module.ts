import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionExecutionLinkService } from './session-execution-link.service';

// Fundacao Prescricao x Execucao (01/10/2026) — sem controller ainda de proposito (nenhuma UI foi
// pedida nesta etapa). O service fica pronto pra ser injetado quando a proxima etapa decidir
// expor endpoints (admin, correcao do aluno) ou acionar classify() a partir do adapter de um
// provedor.
@Module({
  imports: [PrismaModule],
  providers: [SessionExecutionLinkService],
  exports: [SessionExecutionLinkService],
})
export class ActivityExecutionModule {}
