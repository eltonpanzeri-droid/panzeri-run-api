import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityTimeSeriesModule } from '../activity-timeseries/activity-timeseries.module';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { PolarController } from './polar.controller';
import { PolarService } from './polar.service';
import { PolarActivityIngestionService } from './polar-activity-ingestion.service';

@Module({
  imports: [PrismaModule, ActivityTimeSeriesModule, ActivityExecutionModule],
  controllers: [PolarController],
  providers: [PolarService, PolarActivityIngestionService],
})
export class PolarModule {}