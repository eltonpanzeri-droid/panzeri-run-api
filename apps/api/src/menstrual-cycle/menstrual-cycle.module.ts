import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MenstrualCycleController } from './menstrual-cycle.controller';
import { MenstrualCycleService } from './menstrual-cycle.service';

@Module({
  imports: [PrismaModule],
  controllers: [MenstrualCycleController],
  providers: [MenstrualCycleService],
  exports: [MenstrualCycleService],
})
export class MenstrualCycleModule {}
