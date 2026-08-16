import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { NotificationsService } from './notifications.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.list(user.sub);
  }

  // Chamado pelo app assim que o aluno autoriza notificacao (login ou abertura do app) — ver
  // App.tsx, registerPushTokenIfNeeded(). Sobrescreve o token anterior (um aluno so recebe push
  // no aparelho mais recente em que autorizou).
  @Post('push-token')
  registerPushToken(@CurrentUser() user: CurrentUserPayload, @Body() dto: RegisterPushTokenDto) {
    return this.notificationsService.registerPushToken(user.sub, dto.token);
  }

  @Patch(':notificationId/read')
  markRead(@CurrentUser() user: CurrentUserPayload, @Param('notificationId') notificationId: string) {
    return this.notificationsService.markRead(user.sub, notificationId);
  }
}
