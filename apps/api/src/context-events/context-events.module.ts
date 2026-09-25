import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ContextEventsController } from './context-events.controller';
import { ContextEventsService } from './context-events.service';

@Module({
  imports: [PrismaModule],
  controllers: [ContextEventsController],
  providers: [ContextEventsService],
  exports: [ContextEventsService],
})
export class ContextEventsModule {}
