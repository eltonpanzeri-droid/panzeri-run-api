import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { LeoController } from './leo.controller';
import { LeoService } from './leo.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [LeoController],
  providers: [LeoService],
})
export class LeoModule {}
