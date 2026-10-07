import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkoutDeliveryService } from './workout-delivery.service';
import { AppleWatchDeliveryService } from './apple-watch-delivery.service';
import { AppleWatchDeliveryController } from './apple-watch-delivery.controller';

// Fundacao canonica de entrega (02/10/2026) — sem controller e sem nenhum adapter de provider
// ainda, de proposito (nenhuma integracao real foi pedida nesta etapa, so' a fundacao). O service
// fica pronto pra ser usado quando um adapter de provider especifico (Polar, e futuramente
// Garmin/COROS/Apple) for implementado.
@Module({
  imports: [PrismaModule],
  controllers: [AppleWatchDeliveryController],
  providers: [WorkoutDeliveryService, AppleWatchDeliveryService],
  exports: [WorkoutDeliveryService, AppleWatchDeliveryService],
})
export class WorkoutDeliveryModule {}
