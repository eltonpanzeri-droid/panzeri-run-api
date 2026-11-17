import { Module } from '@nestjs/common';
import { WearController, WearMeController } from './wear.controller';
import { WearDeviceGuard } from './wear-device.guard';
import { WearService } from './wear.service';

// Relogio Wear OS (17/11/2026): pareamento por codigo e treinos da semana somente para leitura. Ver wear.service.ts.
@Module({
  controllers: [WearController, WearMeController],
  providers: [WearService, WearDeviceGuard],
  exports: [WearService],
})
export class WearModule {}
