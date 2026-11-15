import { Controller, Get, NotFoundException, Query, UseGuards } from '@nestjs/common';
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

  // Um indicador, opcionalmente de UMA modalidade (os blocos sob o gráfico acompanham a modalidade escolhida na tela).
  @Get('indicator')
  async indicator(@CurrentUser() user: CurrentUserPayload, @Query('variableId') variableId?: string, @Query('modality') modality?: string) {
    const result = variableId ? await this.summary.forIndicator(user.sub, variableId, modality?.trim() || null) : null;
    if (!result) throw new NotFoundException('Indicador sem leitura.');
    return result;
  }

  // Aumento semanal do volume realizado (barras coloridas + leitura por regra).
  @Get('volume-increase')
  volumeIncrease(@CurrentUser() user: CurrentUserPayload) {
    return this.summary.volumeIncrease(user.sub);
  }
}
