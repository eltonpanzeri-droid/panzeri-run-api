import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EvolutionAgentModule } from '../reassessment/evolution-agent.module';
import { StudentProfileService } from './student-profile.service';

// Modulo isolado (sem depender de TrainingPlansModule) para evitar dependencia circular: varios
// modulos que disparam eventos do prontuario (pain-reports, observations, reassessment,
// workout-completions, technical-manager, reporter) sao, eles mesmos, importados por
// TrainingPlansModule. EvolutionAgentModule (28/09/2026) e' igualmente um modulo-folha isolado —
// nao cria circularidade nenhuma (ver comentario nele).
@Module({
  imports: [PrismaModule, EvolutionAgentModule],
  providers: [StudentProfileService],
  exports: [StudentProfileService],
})
export class StudentProfileModule {}
