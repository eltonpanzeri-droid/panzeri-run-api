import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { WearDeviceGuard, type WearRequest } from './wear-device.guard';
import { WearService } from './wear.service';
import { WearConsentService } from './wear-consent.service';
import { WearActivityService } from './wear-activity.service';

// Rotas do RELOGIO Wear OS (sem JWT da aluna): pedir codigo, consultar se foi confirmado e ler os treinos com a credencial do proprio relogio. Limites de uso por IP nas duas rotas abertas.
@Controller('wear')
export class WearController {
  constructor(private readonly wear: WearService, private readonly activities: WearActivityService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('pairing/start')
  start(@Body() body: { deviceName?: unknown }) {
    return this.wear.startPairing(body?.deviceName);
  }

  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @Post('pairing/poll')
  poll(@Body() body: { pairingId?: unknown; pollSecret?: unknown }) {
    return this.wear.pollPairing(body?.pairingId, body?.pollSecret);
  }

  // Treino gravado no relogio. Idempotente pelo clientId; so' grava o que a aluna autorizou (403 wear_consent_required sem autorizacao).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(WearDeviceGuard)
  @Post('activities')
  async activity(@Req() request: WearRequest, @Body() body: unknown) {
    const device = request.wearDevice as { deviceId: string; userId: string };
    const result = await this.activities.ingest(device.userId, device.deviceId, body);
    return result.written ? { stored: true, classification: result.classification, removed: result.removed } : { stored: false, reason: result.reason };
  }

  @UseGuards(WearDeviceGuard)
  @Get('week')
  week(@Req() request: WearRequest) {
    return this.wear.week((request.wearDevice as { userId: string }).userId);
  }
}

// Rotas da ALUNA (JWT) para conectar, listar e retirar relogios.
@UseGuards(AuthGuard('jwt'))
@Controller('me/wear')
export class WearMeController {
  constructor(private readonly wear: WearService, private readonly consent: WearConsentService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('pairing/confirm')
  confirm(@CurrentUser() user: CurrentUserPayload, @Body() body: { code?: unknown }) {
    return this.wear.confirmPairing(user.sub, body?.code);
  }

  // Autorizacoes da aluna para o relogio (texto vigente, grupos, uso pela IA). PUT define a lista COMPLETA de grupos; vazia = retira tudo.
  @Get('consent')
  consentState(@CurrentUser() user: CurrentUserPayload) {
    return this.consent.state(user.sub).then((state) => ({ ...state, document: this.consent.document() }));
  }

  @Put('consent')
  updateConsent(@CurrentUser() user: CurrentUserPayload, @Body() body: { groups?: unknown; ai?: unknown; acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    return this.consent.update(user.sub, body ?? {});
  }

  // Exclusao dos treinos recebidos do relogio (exige estar sem autorizacao ativa).
  @Delete('data')
  deleteData(@CurrentUser() user: CurrentUserPayload) {
    return this.consent.deleteReceivedData(user.sub);
  }

  @Get('devices')
  devices(@CurrentUser() user: CurrentUserPayload) {
    return this.wear.devices(user.sub);
  }

  @Delete('devices/:deviceId')
  revoke(@CurrentUser() user: CurrentUserPayload, @Param('deviceId') deviceId: string) {
    return this.wear.revoke(user.sub, deviceId);
  }
}
