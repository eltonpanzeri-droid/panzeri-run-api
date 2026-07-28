import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { TrainingPlansModule } from '../training-plans/training-plans.module';

@Module({
  imports: [TrainingPlansModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
