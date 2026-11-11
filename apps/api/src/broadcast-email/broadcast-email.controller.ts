import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { BroadcastEmailService } from './broadcast-email.service';

// Comunicado por e-mail (11/11/2026). So' treinador/admin. Ver o comentario do servico para as travas.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/broadcast-email')
export class BroadcastEmailController {
  constructor(private readonly broadcast: BroadcastEmailService) {}

  @Get('status')
  status(@Query('key') key: string) {
    return this.broadcast.status(key);
  }

  @Post('preview')
  preview(@Body() body: { key: string; subject: string; message: string }) {
    return this.broadcast.preview({ key: body?.key, subject: body?.subject, message: body?.message });
  }

  @Post('test')
  test(@CurrentUser() actor: CurrentUserPayload, @Body() body: { key: string; subject: string; message: string }) {
    return this.broadcast.sendTestToCoach(actor.sub, { key: body?.key, subject: body?.subject, message: body?.message });
  }

  @Post('send')
  send(@Body() body: { key: string; subject: string; message: string; confirmCount: number }) {
    return this.broadcast.start({ key: body?.key, subject: body?.subject, message: body?.message }, Number(body?.confirmCount));
  }
}
