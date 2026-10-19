import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { ProviderConnectionService } from './provider-connection.service';
import { ConnectorRegistry } from './connector-registry';
import { ProviderInboundEventService } from './provider-inbound-event.service';
import { ProviderHubWorkerService } from './provider-hub-worker.service';

// Central Universal de Integracoes: registro de conectores + fila duravel de eventos (Passo 1) + conexao generica por provedor (Passo 2). Polar/Wahoo/Strava
// seguem com os modulos proprios. Um conector novo importa este modulo e chama registry.register() em onModuleInit.
@Module({
  imports: [PrismaModule, ActivityExecutionModule],
  providers: [ConnectorRegistry, ProviderInboundEventService, ProviderConnectionService, ProviderHubWorkerService],
  exports: [ConnectorRegistry, ProviderInboundEventService, ProviderConnectionService],
})
export class ProviderHubModule {}
