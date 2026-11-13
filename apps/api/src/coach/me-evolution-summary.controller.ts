import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { EvolutionSummaryService } from '../training-intelligence/evolution-summary.service';

// Síntese da Evolução da PRÓPRIA aluna (13/11/2026): leitura por regra de cada indicador e resumo por área. Somente leitura; o id vem sempre do token.
@UseGuards(AuthGuard('jwt'))
@Controller('me/evolution')
export class MeEvolutionSummaryController {
  constructor(private readonly summary: EvolutionSummaryService) {}

  @Get('summary')
  get(@CurrentUser() user: CurrentUserPayload) {
    return this.summary.forStudent(user.sub);
  }
}
