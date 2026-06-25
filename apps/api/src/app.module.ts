import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    CoachModule,
    MeModule,
    NotificationsModule,
    FitnessTestsModule,
    StravaModule,
    TrainingPlansModule,
    WorkoutCompletionsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
