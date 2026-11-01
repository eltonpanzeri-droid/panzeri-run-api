import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { AiCostService } from './ai-cost.service';

// Somente leitura. Mesmo nivel de acesso do Financeiro do painel (treinador/admin).
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/ai-costs')
export class AiCostController {
  constructor(private readonly aiCost: AiCostService) {}

  @Get()
  overview(@Query('days') days?: string) {
    return this.aiCost.overview(days ? parseInt(days, 10) : undefined);
  }
}
