import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StravaController } from './strava.controller';
import { StravaService } from './strava.service';

@Module({
  imports: [PrismaModule],
  controllers: [StravaController],
  providers: [StravaService],
  exports: [StravaService],
})
export class StravaModule {}
