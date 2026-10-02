import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkoutDeliveryService } from './workout-delivery.service';

// Fundacao canonica de entrega (02/10/2026) — sem controller e sem nenhum adapter de provider
// ainda, de proposito (nenhuma integracao real foi pedida nesta etapa, so' a fundacao). O service
// fica pronto pra ser usado quando um adapter de provider especifico (Polar, e futuramente
// Garmin/COROS/Apple) for implementado.
@Module({
  imports: [PrismaModule],
  providers: [WorkoutDeliveryService],
  exports: [WorkoutDeliveryService],
})
export class WorkoutDeliveryModule {}
