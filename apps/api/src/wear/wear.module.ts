import { Module, OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry } from '../provider-hub/connector-registry';
import { ConnectorRegistryModule } from '../provider-hub/connector-registry.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { DeviceRegistryModule } from '../equipment/device-registry.module';
import { ProviderConnector } from '../provider-hub/provider-connector';
import { WearController, WearMeController } from './wear.controller';
import { WearDeviceGuard } from './wear-device.guard';
import { WearService } from './wear.service';
import { WearConsentService } from './wear-consent.service';
import { WearActivityService } from './wear-activity.service';
import { WEAR_OS_CATEGORIES, WEAR_OS_CONSENT, WEAR_OS_PROVIDER_ID } from './wear-consent';

// Relogio Wear OS (17/11/2026): pareamento por codigo, treinos da semana somente leitura (fase 1-2) e gravacao da corrida com GPS so' durante o treino, com consentimento proprio e uso pela IA (fase 3).
// O conector so' DECLARA o provedor ao registro (categorias e texto de consentimento); nao tem OAuth nem fila: o aplicativo do relogio envia o treino direto (POST /wear/activities).
export const WEAR_OS_CONNECTOR: ProviderConnector = {
  id: WEAR_OS_PROVIDER_ID,
  displayName: 'Relógio Wear OS',
  categories: WEAR_OS_CATEGORIES,
  consent: WEAR_OS_CONSENT,
};

@Module({
  imports: [ConnectorRegistryModule, ActivityExecutionModule, DeviceRegistryModule],
  controllers: [WearController, WearMeController],
  providers: [WearService, WearDeviceGuard, WearConsentService, WearActivityService],
  exports: [WearService, WearConsentService],
})
export class WearModule implements OnModuleInit {
  constructor(private readonly registry: ConnectorRegistry) {}

  onModuleInit() {
    this.registry.register(WEAR_OS_CONNECTOR);
  }
}
