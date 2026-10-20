import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorRegistry } from '../provider-hub/connector-registry';
import { ProviderHubModule } from '../provider-hub/provider-hub.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { WorkoutDeliveryModule } from '../workout-delivery/workout-delivery.module';
import { buildZeppConnector } from './zepp.connector';
import { ZeppController } from './zepp.controller';
import { ZeppWorkoutClient } from './zepp-workout-client';
import { ZeppWorkoutPublisherService } from './zepp-workout-publisher.service';
import { ZeppWorkoutSchedulerService } from './zepp-workout-scheduler.service';
import { ZeppWebhookController } from './zepp-webhook.controller';
import { ZeppFitDownloader } from './zepp-fit-downloader';
import { ZeppActivityIngestionService } from './zepp-activity-ingestion.service';
import { ZeppActivityEventService } from './zepp-activity-events.service';
import { ZeppExactLinkService } from './zepp-exact-link.service';
import { ZeppBackfillClient, ZeppBackfillService } from './zepp-backfill.service';

// Zepp/Amazfit — Passo 2 da Central Universal de Integracoes: conexao OAuth. Fica inerte ate a Zepp ser configurada (ZEPP_*) E o usuario liberado
// (ZEPP_ENABLED_USER_IDS, fail-closed). Nao recebe dado de treino.
@Module({
  imports: [ProviderHubModule, PrismaModule, WorkoutDeliveryModule, ActivityExecutionModule],
  controllers: [ZeppController, ZeppWebhookController],
  providers: [ZeppWorkoutClient, ZeppWorkoutPublisherService, ZeppWorkoutSchedulerService, ZeppFitDownloader, ZeppExactLinkService, ZeppActivityIngestionService, ZeppActivityEventService, ZeppBackfillClient, ZeppBackfillService],
  exports: [ZeppWorkoutPublisherService],
})
export class ZeppModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly config: ConfigService,
    private readonly activityEvents: ZeppActivityEventService,
    private readonly backfill: ZeppBackfillService,
  ) {}

  onModuleInit() {
    this.registry.register(buildZeppConnector(this.config, { events: this.activityEvents, sync: this.backfill }));
  }
}
