import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { PolarProbeService } from './polar-probe.service';

// TEMPORARIO (23/10/2026): diagnostico somente-leitura da Polar, restrito ao ADMINISTRADOR e desligado por padrao (POLAR_PROBE_ENABLED). Sem a variavel ligada a rota nem "existe" (404).
// Remover este controlador e o servico depois de usar.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
@Controller('polar-admin')
export class PolarProbeController {
  constructor(private readonly probe: PolarProbeService) {}

  @Get('probe')
  run(@CurrentUser() user: CurrentUserPayload) {
    if (!this.probe.enabled()) throw new NotFoundException();
    return this.probe.run(user.sub);
  }
}
