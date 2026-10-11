import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { HealthConnectController } from './health-connect.controller';
import { HealthConnectIngestionService } from './health-connect-ingestion.service';

@Module({
  imports: [PrismaModule, ActivityExecutionModule],
  controllers: [HealthConnectController],
  providers: [HealthConnectIngestionService],
})
export class HealthConnectModule {}
