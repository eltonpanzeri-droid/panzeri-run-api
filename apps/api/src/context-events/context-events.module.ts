import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ContextEventsController } from './context-events.controller';
import { ContextEventsService } from './context-events.service';
import { ReporterModule } from '../reporter/reporter.module';

@Module({
  imports: [PrismaModule, ReporterModule],
  controllers: [ContextEventsController],
  providers: [ContextEventsService],
  exports: [ContextEventsService],
})
export class ContextEventsModule {}
