import { Module } from '@nestjs/common';
import { PhysiologyModule } from '../physiology/physiology.module';
import { FitnessTestsController } from './fitness-tests.controller';
import { FitnessTestsService } from './fitness-tests.service';

@Module({
  imports: [PhysiologyModule],
  controllers: [FitnessTestsController],
  providers: [FitnessTestsService],
})
export class FitnessTestsModule {}
