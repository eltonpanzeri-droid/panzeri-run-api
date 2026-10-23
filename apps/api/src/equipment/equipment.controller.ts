import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { DevicesService } from './devices.service';

// Equipamentos (23/10/2026) — relogios/dispositivos do proprio aluno (GET), com correcao/cadastro manual que nunca apaga a proveniencia tecnica.
@UseGuards(AuthGuard('jwt'))
@Controller('me/equipment')
export class EquipmentController {
  constructor(private readonly devices: DevicesService) {}

  @Get('devices')
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.devices.forStudent(user.sub);
  }

  @Post('devices')
  addManual(@CurrentUser() user: CurrentUserPayload, @Body() body: { manufacturer?: unknown; model?: unknown }) {
    return this.devices.addManual(user.sub, body ?? {});
  }

  @Patch('devices/:deviceId')
  correct(@CurrentUser() user: CurrentUserPayload, @Param('deviceId') deviceId: string, @Body() body: { manufacturer?: unknown; model?: unknown }) {
    return this.devices.correct(user.sub, deviceId, body ?? {});
  }
}
