import { Module } from '@nestjs/common';
import { CoachPhysiologyController, PhysiologyController } from './physiology.controller';
import { PhysiologyService } from './physiology.service';

@Module({
  controllers: [PhysiologyController, CoachPhysiologyController],
  providers: [PhysiologyService],
  exports: [PhysiologyService],
})
export class PhysiologyModule {}
