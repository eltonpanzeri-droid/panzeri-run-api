import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PolarController } from './polar.controller';
import { PolarService } from './polar.service';

@Module({
  imports: [PrismaModule],
  controllers: [PolarController],
  providers: [PolarService],
})
export class PolarModule {}