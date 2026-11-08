import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { NativeInviteService } from './native-invite.service';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { DeviceRegistryService } from './device-registry.service';
import { EquipmentIntelligenceService, type EquipmentQuery } from './equipment-intelligence.service';
import { StudentAccessService } from './student-access.service';

// Inteligencia de Equipamentos (23/10/2026) — painel do treinador. Somente leitura e somente AGREGADOS (sem nome/e-mail/id de aluno). Reconstruir a base de dispositivos e' exclusivo de admin.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/equipment')
export class EquipmentCoachController {
  constructor(private readonly intelligence: EquipmentIntelligenceService, private readonly registry: DeviceRegistryService, private readonly studentAccessService: StudentAccessService, private readonly nativeInvite: NativeInviteService) {}

  @Get('options')
  options() {
    return this.intelligence.options();
  }

  @Get('intelligence')
  run(@Query() query: EquipmentQuery) {
    return this.intelligence.run(query);
  }

  // Como cada aluna acessa (05/11/2026): lista nominal e SOMENTE LEITURA, separada dos agregados acima.
  @Get('student-access')
  studentAccess() {
    return this.studentAccessService.run();
  }

  // Convite para baixar o Panzeri Run nas lojas (08/11/2026): previa, teste so' para quem pede, e envio real com a contagem confirmada.
  @Get('native-invite')
  nativeInvitePreview() {
    return this.nativeInvite.preview();
  }

  @Post('native-invite/test')
  nativeInviteTest(@CurrentUser() user: CurrentUserPayload) {
    return this.nativeInvite.sendTest(user.sub);
  }

  @Post('native-invite/send')
  nativeInviteSend(@Body() body: { expectedCount?: number }) {
    return this.nativeInvite.sendAll(Number(body?.expectedCount));
  }

  @Roles('admin')
  @Post('refresh-devices')
  refresh() {
    return this.registry.refreshAll();
  }
}
