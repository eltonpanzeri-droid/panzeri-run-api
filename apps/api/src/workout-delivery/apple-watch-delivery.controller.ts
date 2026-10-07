import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { AppleWatchDeliveryService } from './apple-watch-delivery.service';

// Envio de uma TrainingSession real ao Apple Watch (WorkoutKit). Sempre da propria conta (userId do JWT); a posse da sessao/entrega e'
// checada no service. Nao cria atividade fisica nem infere execucao.
@UseGuards(AuthGuard('jwt'))
@Controller('me/apple-watch')
export class AppleWatchDeliveryController {
  constructor(private readonly service: AppleWatchDeliveryService) {}

  @Get('sessions/:sessionId/eligibility')
  eligibility(@CurrentUser() user: CurrentUserPayload, @Param('sessionId') sessionId: string) {
    return this.service.eligibility(user.sub, sessionId);
  }

  // Cria ou reutiliza a identidade persistente da entrega (idempotente).
  @Post('sessions/:sessionId/deliveries')
  prepare(@CurrentUser() user: CurrentUserPayload, @Param('sessionId') sessionId: string) {
    return this.service.prepare(user.sub, sessionId);
  }

  @Post('deliveries/:deliveryId/sent')
  confirmSent(@CurrentUser() user: CurrentUserPayload, @Param('deliveryId') deliveryId: string) {
    return this.service.confirmSent(user.sub, deliveryId);
  }

  @Post('deliveries/:deliveryId/failed')
  reportFailure(@CurrentUser() user: CurrentUserPayload, @Param('deliveryId') deliveryId: string, @Body('message') message?: string) {
    return this.service.reportFailure(user.sub, deliveryId, message ?? 'falha ao agendar no WorkoutKit');
  }
}
