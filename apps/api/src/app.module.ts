import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CoachModule } from './coach/coach.module';
import { FitnessTestsModule } from './fitness-tests/fitness-tests.module';
import { PhysiologyModule } from './physiology/physiology.module';
import { MeModule } from './me/me.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { StravaModule } from './strava/strava.module';
import { PolarModule } from './polar/polar.module';
import { WahooModule } from './wahoo/wahoo.module';
import { ProviderHubModule } from './provider-hub/provider-hub.module';
import { ZeppModule } from './zepp/zepp.module';
import { AppleHealthModule } from './apple-health/apple-health.module';
import { HealthConnectModule } from './health-connect/health-connect.module';
import { TrainingPlansModule } from './training-plans/training-plans.module';
import { WorkoutCompletionsModule } from './workout-completions/workout-completions.module';
import { BillingModule } from './billing/billing.module';
import { MessagingModule } from './messaging/messaging.module';
import { ReassessmentModule } from './reassessment/reassessment.module';
import { ContextEventsModule } from './context-events/context-events.module';
import { BackupModule } from './backup/backup.module';
import { TechnicalManagerModule } from './technical-manager/technical-manager.module';
import { TargetRacesModule } from './target-races/target-races.module';
import { PainReportsModule } from './pain-reports/pain-reports.module';
import { ObservationsModule } from './observations/observations.module';
import { FunnelModule } from './funnel/funnel.module';
import { EvolutionModule } from './evolution/evolution.module';
import { MenstrualCycleModule } from './menstrual-cycle/menstrual-cycle.module';
import { LeoModule } from './leo/leo.module';
import { ActivityExecutionModule } from './activity-execution/activity-execution.module';
import { WorkoutDeliveryModule } from './workout-delivery/workout-delivery.module';
import { ShoesModule } from './shoes/shoes.module';
import { EquipmentModule } from './equipment/equipment.module';
import { ObservatoryModule } from './observatory/observatory.module';
import { AppReviewModule } from './app-review/app-review.module';
import { IntegrationsModule } from './integrations/integrations.module';
// ATENCAO (incidente 22/10/2026): este modulo importa ActivityExecutionModule; registrado no INICIO da lista ele mudava a ordem de carregamento dos arquivos e criava uma dependencia
// circular (TrainingPlansService nao resolvia NotificationsService) — a API nao subia. Mantenha-o por ULTIMO nos imports.
import { LegacyConsentModule } from './legacy-consent/legacy-consent.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    CoachModule,
    MeModule,
    NotificationsModule,
    FitnessTestsModule,
    PhysiologyModule,
    StravaModule,
    PolarModule,
    WahooModule,
    ProviderHubModule,
    ZeppModule,
    AppleHealthModule,
    HealthConnectModule,
    ActivityExecutionModule,
    WorkoutDeliveryModule,
    ShoesModule,
    EquipmentModule,
    ObservatoryModule,
    AppReviewModule,
    IntegrationsModule,
    LegacyConsentModule,
    TrainingPlansModule,
    WorkoutCompletionsModule,
    BillingModule,
    MessagingModule,
    ReassessmentModule,
    ContextEventsModule,
    BackupModule,
    TechnicalManagerModule,
    TargetRacesModule,
    PainReportsModule,
    ObservationsModule,
    FunnelModule,
    EvolutionModule,
    MenstrualCycleModule,
    LeoModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
