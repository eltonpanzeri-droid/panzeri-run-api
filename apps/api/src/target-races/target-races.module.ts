import { Module } from '@nestjs/common';
import { TargetRacesController } from './target-races.controller';
import { TargetRacesService } from './target-races.service';
import { TelegramService } from '../billing/telegram.service';
import { PainReportsModule } from '../pain-reports/pain-reports.module';

@Module({
  // TelegramService entra como provider direto aqui (nao via BillingModule) de proposito —
  // BillingModule importa TrainingPlansModule (com forwardRef) que por sua vez importa
  // TargetRacesModule, entao importar BillingModule aqui fecharia um ciclo de 3 modulos. O
  // proprio TelegramService so depende do ConfigService (global), sem custo real de duplicar o
  // provider — mesma ideia do StudentProfileModule ser isolado por esse motivo.
  // PainReportsModule pro computeSafetyTier usado no gatilho de alerta de prova arriscada.
  imports: [PainReportsModule],
  controllers: [TargetRacesController],
  providers: [TargetRacesService, TelegramService],
  exports: [TargetRacesService],
})
export class TargetRacesModule {}
