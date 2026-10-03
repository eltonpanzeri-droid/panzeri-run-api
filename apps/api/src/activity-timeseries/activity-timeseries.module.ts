import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityTimeSeriesService } from './activity-timeseries.service';

@Module({
  imports: [PrismaModule],
  providers: [ActivityTimeSeriesService],
  exports: [ActivityTimeSeriesService],
})
export class ActivityTimeSeriesModule {}
