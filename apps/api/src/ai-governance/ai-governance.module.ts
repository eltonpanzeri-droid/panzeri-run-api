import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConnectorRegistryModule } from '../provider-hub/connector-registry.module';
import { AiDataEligibility } from './ai-data-eligibility.service';
import { AiEgressGuard } from './ai-egress.guard';

// Governanca de dados para IA: elegibilidade por usuario/provedor/categoria/finalidade e protecao final antes de chamadas a fornecedores externos.
// Modulo enxuto (so' Prisma + registro de conectores) para ser importado pela fila de IA e pelos modulos que montam contexto sem criar ciclos.
@Module({
  imports: [PrismaModule, ConnectorRegistryModule],
  providers: [AiDataEligibility, AiEgressGuard],
  exports: [AiDataEligibility, AiEgressGuard],
})
export class AiGovernanceModule {}
