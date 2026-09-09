import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { EvolutionMetricService } from './evolution-metric.service';

@UseGuards(AuthGuard('jwt'))
@Controller('me/evolution')
export class EvolutionController {
  constructor(private readonly evolutionMetric: EvolutionMetricService) {}

  /**
   * GET /me/evolution/overview
   * Resumo de evolução do aluno autenticado.
   * Usado na tela principal de Evolução do app mobile.
   *
   * Query params:
   *   recentWeeks?: number  — semanas recentes para o gráfico de barras (default: 12)
   */
  @Get('overview')
  getOverview(
    @CurrentUser() user: CurrentUserPayload,
    @Query('recentWeeks') recentWeeks?: string,
  ) {
    const weeks = recentWeeks ? Math.min(Math.max(parseInt(recentWeeks, 10) || 12, 4), 52) : 12;
    return this.evolutionMetric.getOverview(user.sub, weeks);
  }

  /**
   * GET /me/evolution/series
   * Série temporal completa (todas as semanas + agregados mensais).
   * Usado para gráficos de tendência de longo prazo.
   */
  @Get('series')
  getSeries(@CurrentUser() user: CurrentUserPayload) {
    return this.evolutionMetric.getSeries(user.sub);
  }
}
