import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppleHealthController } from './apple-health.controller';
import { AppleHealthIngestionService } from './apple-health-ingestion.service';

@Module({
  imports: [PrismaModule],
  controllers: [AppleHealthController],
  providers: [AppleHealthIngestionService],
})
export class AppleHealthModule {}
