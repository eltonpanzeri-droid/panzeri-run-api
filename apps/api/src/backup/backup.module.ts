import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { BackupService } from './backup.service';

@Module({
  imports: [MessagingModule],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
