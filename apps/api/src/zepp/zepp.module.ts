import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorRegistry } from '../provider-hub/connector-registry';
import { ProviderHubModule } from '../provider-hub/provider-hub.module';
import { buildZeppConnector } from './zepp.connector';
import { ZeppController } from './zepp.controller';

// Zepp/Amazfit — Passo 2 da Central Universal de Integracoes: conexao OAuth. Fica inerte ate a Zepp ser configurada (ZEPP_*) E o usuario liberado
// (ZEPP_ENABLED_USER_IDS, fail-closed). Nao recebe dado de treino.
@Module({
  imports: [ProviderHubModule],
  controllers: [ZeppController],
})
export class ZeppModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.registry.register(buildZeppConnector(this.config));
  }
}
