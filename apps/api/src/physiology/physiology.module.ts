import { Module } from '@nestjs/common';
import { CoachPhysiologyController, PhysiologyController } from './physiology.controller';
import { PhysiologyService } from './physiology.service';
import { OperationalReferenceService } from './operational-reference.service';

@Module({
  controllers: [PhysiologyController, CoachPhysiologyController],
  providers: [PhysiologyService, OperationalReferenceService],
  exports: [PhysiologyService, OperationalReferenceService],
})
export class PhysiologyModule {}
