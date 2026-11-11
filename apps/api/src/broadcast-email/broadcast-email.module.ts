import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { BroadcastEmailController } from './broadcast-email.controller';
import { BroadcastEmailService } from './broadcast-email.service';

@Module({
  imports: [MessagingModule],
  controllers: [BroadcastEmailController],
  providers: [BroadcastEmailService],
})
export class BroadcastEmailModule {}
