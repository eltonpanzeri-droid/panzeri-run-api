import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ProactiveNotificationsService } from './proactive-notifications.service';

// Painel do treinador (19/11/2026, Lote 5): o que os avisos proativos enviaram e barraram. So' leitura; so' treinador/admin.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/notifications')
export class NotificationLogController {
  constructor(private readonly proactive: ProactiveNotificationsService) {}

  @Get('summary')
  summary(@Query('days') days?: string) {
    return this.proactive.summary(days ? Number(days) : 7);
  }
}
