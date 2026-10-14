import { Module } from '@nestjs/common';
import { TargetRacesController } from './target-races.controller';
import { TargetRacesService } from './target-races.service';
import { TelegramService } from '../billing/telegram.service';
import { PainReportsModule } from '../pain-reports/pain-reports.module';
import { StudentProfileModule } from '../training-plans/student-profile.module';

@Module({
  // TelegramService entra como provider direto aqui (nao via BillingModule) de proposito —
  // BillingModule importa TrainingPlansModule (com forwardRef) que por sua vez importa
  // TargetRacesModule, entao importar BillingModule aqui fecharia um ciclo de 3 modulos. O
  // proprio TelegramService so depende do ConfigService (global), sem custo real de duplicar o
  // provider — mesma ideia do StudentProfileModule ser isolado por esse motivo.
  // PainReportsModule pro computeSafetyTier usado no gatilho de alerta de prova arriscada.
  // StudentProfileModule e' isolado (sem ciclo): o Prontuario recebe toda meta cadastrada.
  imports: [PainReportsModule, StudentProfileModule],
  controllers: [TargetRacesController],
  providers: [TargetRacesService, TelegramService],
  exports: [TargetRacesService],
})
export class TargetRacesModule {}
