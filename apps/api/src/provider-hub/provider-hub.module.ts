import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConnectorRegistry } from './connector-registry';
import { ProviderInboundEventService } from './provider-inbound-event.service';
import { ProviderHubWorkerService } from './provider-hub-worker.service';

// Central Universal de Integracoes (Passo 1): registro de conectores + fila duravel de eventos. Nenhum conector registrado ainda; Polar/Wahoo/Strava
// seguem com os modulos proprios. Um conector novo importa este modulo e chama registry.register() em onModuleInit.
@Module({
  imports: [PrismaModule],
  providers: [ConnectorRegistry, ProviderInboundEventService, ProviderHubWorkerService],
  exports: [ConnectorRegistry, ProviderInboundEventService],
})
export class ProviderHubModule {}
