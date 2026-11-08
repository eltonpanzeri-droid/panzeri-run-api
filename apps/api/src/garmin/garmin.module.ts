import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorRegistry } from '../provider-hub/connector-registry';
import { ProviderHubModule } from '../provider-hub/provider-hub.module';
import { PrismaModule } from '../prisma/prisma.module';
import { buildGarminConnector } from './garmin.connector';
import { GarminController } from './garmin.controller';

// Garmin (08/11/2026): lote 1 — conexao OAuth2 PKCE, consentimento, desconexao e aviso de desregistro. Inerte ate a Garmin ser configurada (GARMIN_*) E a aluna liberada (GARMIN_ENABLED_USER_IDS, fail-closed).
@Module({
  imports: [ProviderHubModule, PrismaModule],
  controllers: [GarminController],
})
export class GarminModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.registry.register(buildGarminConnector(this.config));
  }
}
