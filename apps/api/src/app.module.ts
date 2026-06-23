import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { FitnessTestsModule } from './fitness-tests/fitness-tests.module';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
import { TrainingPlansModule } from './training-plans/training-plans.module';
import { WorkoutCompletionsModule } from './workout-completions/workout-completions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    MeModule,
    FitnessTestsModule,
    TrainingPlansModule,
    WorkoutCompletionsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
