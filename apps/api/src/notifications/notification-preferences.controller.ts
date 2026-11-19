import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { NotificationOrchestratorService } from './notification-orchestrator.service';

// Tela "Notificacoes" do Panzeri Run (19/11/2026): a aluna escolhe categorias, quantidade por dia e horario. Valor invalido nunca da erro: cai no padrao (ver normalizePreferences).
@UseGuards(AuthGuard('jwt'))
@Controller('me/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly orchestrator: NotificationOrchestratorService) {}

  @Get()
  get(@CurrentUser() user: CurrentUserPayload) {
    return this.orchestrator.screenData(user.sub);
  }

  @Put()
  async save(@CurrentUser() user: CurrentUserPayload, @Body() body: Record<string, unknown>) {
    await this.orchestrator.savePreferences(user.sub, body);
    return this.orchestrator.screenData(user.sub);
  }
}
