import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { IntegrationsService } from './integrations.service';

@UseGuards(AuthGuard('jwt'))
@Controller('me/integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  catalog(@CurrentUser() user: CurrentUserPayload) {
    return this.integrations.catalog(user.sub);
  }
}
