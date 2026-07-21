import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CoachModule } from './coach/coach.module';
import { FitnessTestsModule } from './fitness-tests/fitness-tests.module';
import { MeModule } from './me/me.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { StravaModule } from './strava/strava.module';
import { TrainingPlansModule } from './training-plans/training-plans.module';
import { WorkoutCompletionsModule } from './workout-completions/workout-completions.module';
import { BillingModule } from './billing/billing.module';
import { MessagingModule } from './messaging/messaging.module';
import { ReassessmentModule } from './reassessment/reassessment.module';
import { BackupModule } from './backup/backup.module';
import { TechnicalManagerModule } from './technical-manager/technical-manager.module';
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
    StravaModule,
    TrainingPlansModule,
    WorkoutCompletionsModule,
    BillingModule,
    MessagingModule,
    ReassessmentModule,
    BackupModule,
    TechnicalManagerModule,
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
