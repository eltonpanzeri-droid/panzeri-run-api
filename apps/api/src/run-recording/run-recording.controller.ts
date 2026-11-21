import { Body, Controller, Delete, Get, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { RunConsentService } from './run-consent.service';
import { RunActivityService } from './run-activity.service';

// Rotas da ALUNA (JWT) para gravar treinos no proprio Panzeri Run (21/11/2026): autorizacoes, envio do treino gravado e exclusao dos treinos gravados.
@UseGuards(AuthGuard('jwt'))
@Controller('me/run')
export class RunRecordingController {
  constructor(private readonly consent: RunConsentService, private readonly activities: RunActivityService) {}

  // Texto vigente, grupos e uso pela IA. PUT define a lista COMPLETA de grupos; vazia = retira tudo.
  @Get('consent')
  consentState(@CurrentUser() user: CurrentUserPayload) {
    return this.consent.state(user.sub).then((state) => ({ ...state, document: this.consent.document() }));
  }

  @Put('consent')
  updateConsent(@CurrentUser() user: CurrentUserPayload, @Body() body: { groups?: unknown; ai?: unknown; acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    return this.consent.update(user.sub, body ?? {});
  }

  // Treino gravado no Panzeri Run. Idempotente pelo clientId; so' grava o que a aluna autorizou (403 run_consent_required sem autorizacao).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('activities')
  async activity(@CurrentUser() user: CurrentUserPayload, @Body() body: unknown) {
    const result = await this.activities.ingest(user.sub, body);
    return result.written ? { stored: true, classification: result.classification, removed: result.removed } : { stored: false, reason: result.reason };
  }

  // Exclusao dos treinos gravados no Panzeri Run (exige estar sem autorizacao ativa).
  @Delete('data')
  deleteData(@CurrentUser() user: CurrentUserPayload) {
    return this.consent.deleteReceivedData(user.sub);
  }
}
