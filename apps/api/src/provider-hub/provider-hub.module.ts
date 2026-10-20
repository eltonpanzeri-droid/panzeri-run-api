import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { ProviderConnectionService } from './provider-connection.service';
import { ProviderConsentService } from './provider-consent.service';
import { ConnectorRegistryModule } from './connector-registry.module';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';
import { ProviderInboundEventService } from './provider-inbound-event.service';
import { ProviderHubWorkerService } from './provider-hub-worker.service';

// Central Universal de Integracoes: registro de conectores + fila duravel de eventos (Passo 1) + conexao generica por provedor (Passo 2). Polar/Wahoo/Strava
// seguem com os modulos proprios. Um conector novo importa este modulo e chama registry.register() em onModuleInit.
@Module({
  imports: [PrismaModule, ActivityExecutionModule, ConnectorRegistryModule, AiGovernanceModule],
  providers: [ProviderInboundEventService, ProviderConsentService, ProviderConnectionService, ProviderHubWorkerService],
  exports: [ConnectorRegistryModule, ProviderInboundEventService, ProviderConsentService, ProviderConnectionService],
})
export class ProviderHubModule {}
