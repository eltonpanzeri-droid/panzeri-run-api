import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { MedalsService } from './medals.service';

// Sistema de Medalhas (30/09/2026) — API de leitura (etapa 5 do plano). Sem UI ainda (pedido
// explícito: reformulação da Home do aluno vem depois, com o backend já pronto e testado).
@UseGuards(AuthGuard('jwt'))
@Controller('me/medals')
export class MedalsController {
  constructor(private readonly medalsService: MedalsService) {}

  /** Catálogo conquistado + progresso pras próximas conquistas — endpoint único pro futuro app. */
  @Get()
  getSummary(@CurrentUser() user: CurrentUserPayload) {
    return this.medalsService.getSummary(user.sub);
  }

  @Get('unlocked')
  getUnlocked(@CurrentUser() user: CurrentUserPayload) {
    return this.medalsService.getUnlocked(user.sub);
  }

  @Get('progress')
  getProgress(@CurrentUser() user: CurrentUserPayload) {
    return this.medalsService.getProgress(user.sub);
  }
}
