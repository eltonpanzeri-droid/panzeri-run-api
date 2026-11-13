import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
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
   * GET /me/evolution/panel?from=YYYY-MM-DD&to=YYYY-MM-DD
   * Painel de resumo da tela inicial. Sem datas = desde o início. Os itens "sem período" (semanas desde que entrou, semana com mais km, recorde de semanas ativas) ignoram as datas.
   */
  @Get('panel')
  getPanel(@CurrentUser() user: CurrentUserPayload, @Query('from') from?: string, @Query('to') to?: string) {
    const valid = (value?: string) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T12:00:00Z')));
    if (!valid(from) || !valid(to)) throw new BadRequestException('Datas devem estar no formato AAAA-MM-DD.');
    if (from && to && from > to) throw new BadRequestException('A data inicial não pode ser depois da final.');
    return this.evolutionMetric.getPanel(user.sub, { from: from || null, to: to || null });
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
