import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { NotificationsService } from './notifications.service';

@UseGuards(AuthGuard('jwt'))
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.list(user.sub);
  }

  @Patch(':notificationId/read')
  markRead(@CurrentUser() user: CurrentUserPayload, @Param('notificationId') notificationId: string) {
    return this.notificationsService.markRead(user.sub, notificationId);
  }
}
