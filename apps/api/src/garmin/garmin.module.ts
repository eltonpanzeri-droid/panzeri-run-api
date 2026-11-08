import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorRegistry } from '../provider-hub/connector-registry';
import { ProviderHubModule } from '../provider-hub/provider-hub.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { DeviceRegistryModule } from '../equipment/device-registry.module';
import { WorkoutDeliveryModule } from '../workout-delivery/workout-delivery.module';
import { buildGarminConnector } from './garmin.connector';
import { GarminController } from './garmin.controller';
import { GarminActivityIngestionService } from './garmin-activity-ingestion.service';
import { GarminActivityEventService } from './garmin-activity-events.service';
import { GarminHealthEventService } from './garmin-health-events.service';
import { GarminTrainingClient } from './garmin-training-client';
import { GarminWorkoutPublisherService } from './garmin-workout-publisher.service';
import { GarminWorkoutSchedulerService } from './garmin-workout-scheduler.service';
import { GarminDataDeletionService } from './garmin-data-deletion.service';
import { GarminCoachController, GarminMeasuresController, GarminMeasuresService } from './garmin-measures.service';

// Garmin (08/11/2026): lote 1 — conexao OAuth2 PKCE, consentimento, desconexao e aviso de desregistro; lote 2a — atividades por push (fila duravel do hub); lote 2b — saude por push; lote 3 — envio de treinos (Training API). Inerte ate a Garmin ser configurada (GARMIN_*) E a aluna liberada (GARMIN_ENABLED_USER_IDS, fail-closed).
@Module({
  imports: [ProviderHubModule, PrismaModule, ActivityExecutionModule, DeviceRegistryModule, WorkoutDeliveryModule],
  controllers: [GarminController, GarminMeasuresController, GarminCoachController],
  providers: [GarminActivityIngestionService, GarminHealthEventService, GarminActivityEventService, GarminTrainingClient, GarminWorkoutPublisherService, GarminWorkoutSchedulerService, GarminDataDeletionService, GarminMeasuresService],
  exports: [GarminWorkoutPublisherService],
})
export class GarminModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly config: ConfigService,
    private readonly activityEvents: GarminActivityEventService,
    private readonly dataDeletion: GarminDataDeletionService,
  ) {}

  onModuleInit() {
    this.registry.register(buildGarminConnector(this.config, { events: this.activityEvents, dataDeletion: this.dataDeletion }));
  }
}
