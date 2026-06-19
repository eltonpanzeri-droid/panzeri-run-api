import { Module } from '@nestjs/common';
import { FitnessTestsController } from './fitness-tests.controller';
import { FitnessTestsService } from './fitness-tests.service';

@Module({
  controllers: [FitnessTestsController],
  providers: [FitnessTestsService],
})
export class FitnessTestsModule {}
