import { Module } from '@nestjs/common';
import { CoachController } from './coach.controller';
import { CoachService } from './coach.service';
import { TrainingPlansModule } from '../training-plans/training-plans.module';
import { StravaModule } from '../strava/strava.module';
import { MessagingModule } from '../messaging/messaging.module';
import { BackupModule } from '../backup/backup.module';
import { MeModule } from '../me/me.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TrainingPlansModule, StravaModule, MessagingModule, BackupModule, MeModule, BillingModule],
  controllers: [CoachController],
  providers: [CoachService],
})
export class CoachModule {}
