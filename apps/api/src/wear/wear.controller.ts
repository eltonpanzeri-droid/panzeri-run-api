import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { WearDeviceGuard, type WearRequest } from './wear-device.guard';
import { WearService } from './wear.service';

// Rotas do RELOGIO Wear OS (sem JWT da aluna): pedir codigo, consultar se foi confirmado e ler os treinos com a credencial do proprio relogio. Limites de uso por IP nas duas rotas abertas.
@Controller('wear')
export class WearController {
  constructor(private readonly wear: WearService) {}

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
  constructor(private readonly wear: WearService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('pairing/confirm')
  confirm(@CurrentUser() user: CurrentUserPayload, @Body() body: { code?: unknown }) {
    return this.wear.confirmPairing(user.sub, body?.code);
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
