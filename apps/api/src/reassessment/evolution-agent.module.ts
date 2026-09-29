import { Module } from '@nestjs/common';
import { AiQueueModule } from '../common/ai-queue.module';
import { EvolutionAgentService } from './evolution-agent.service';

// Modulo isolado (28/09/2026, fechamento Relator -> Prontuario -> Treinador) — EvolutionAgentService
// nao depende de Prisma nem de nada especifico de reavaliacao (so Config+AiQueue), entao vive aqui
// separado de ReassessmentModule pra StudentProfileModule poder reaproveitar o MESMO agente (nao
// criar um novo) sem dependencia circular: ReassessmentModule ja importa StudentProfileModule, e
// StudentProfileModule agora precisa do EvolutionAgentService pra' condensar o prontuario.
@Module({
  imports: [AiQueueModule],
  providers: [EvolutionAgentService],
  exports: [EvolutionAgentService],
})
export class EvolutionAgentModule {}
