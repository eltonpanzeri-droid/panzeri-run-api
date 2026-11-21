import { Module } from '@nestjs/common';
import { ActivityExecutionModule } from '../activity-execution/activity-execution.module';
import { RunRecordingController } from './run-recording.controller';
import { RunConsentService } from './run-consent.service';
import { RunActivityService } from './run-activity.service';

// Gravar treinos no proprio Panzeri Run (21/11/2026): autorizacoes proprias e envio do treino gravado no celular. Nao registra conector na Central de Integracoes (nao e' dispositivo de terceiro): o
// consentimento entra na elegibilidade de IA por DEVICE_CONSENT_PROVIDERS. Nao toca nos conectores dos relogios.
@Module({
  imports: [ActivityExecutionModule],
  controllers: [RunRecordingController],
  providers: [RunConsentService, RunActivityService],
  exports: [RunConsentService],
})
export class RunRecordingModule {}
