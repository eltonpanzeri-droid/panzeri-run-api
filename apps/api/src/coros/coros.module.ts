import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorRegistry } from '../provider-hub/connector-registry';
import { ProviderHubModule } from '../provider-hub/provider-hub.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { WorkoutDeliveryModule } from '../workout-delivery/workout-delivery.module';
import { DeviceRegistryModule } from '../equipment/device-registry.module';
import { buildCorosConnector } from './coros.connector';
import { CorosController } from './coros.controller';
import { CorosMcpClient } from './coros-mcp-client';
import { CorosFitDownloader } from './coros-fit-downloader';
import { CorosActivityIngestionService } from './coros-activity-ingestion.service';
import { CorosSyncService } from './coros-sync.service';
import { CorosDataDeletionService } from './coros-data-deletion.service';
import { CorosWorkoutPublisherService } from './coros-workout-publisher.service';
import { CorosWorkoutSchedulerService } from './coros-workout-scheduler.service';

// COROS (30/10/2026): conexao OAuth pelo COROS MCP, importacao de atividades por consulta periodica e envio de treinos ao calendario. Inerte ate a COROS ser configurada (COROS_*) E a aluna
// liberada (COROS_ENABLED_USER_IDS, fail-closed); a importacao e o envio de treinos tem chaves proprias (COROS_SYNC_ENABLED, COROS_WORKOUT_PUBLISH_ENABLED).
@Module({
  imports: [ProviderHubModule, PrismaModule, WorkoutDeliveryModule, ActivityExecutionModule, DeviceRegistryModule],
  controllers: [CorosController],
  providers: [CorosMcpClient, CorosFitDownloader, CorosActivityIngestionService, CorosSyncService, CorosDataDeletionService, CorosWorkoutPublisherService, CorosWorkoutSchedulerService],
  exports: [CorosWorkoutPublisherService],
})
export class CorosModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly config: ConfigService,
    private readonly sync: CorosSyncService,
    private readonly dataDeletion: CorosDataDeletionService,
  ) {}

  onModuleInit() {
    this.registry.register(buildCorosConnector(this.config, { sync: this.sync, dataDeletion: this.dataDeletion }));
  }
}
