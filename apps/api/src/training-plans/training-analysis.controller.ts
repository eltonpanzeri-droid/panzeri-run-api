import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TrainingAnalystService } from './training-analyst.service';

// So' leitura, so' treinador/admin: contratos persistidos do Analista de Treinos (sessao viva; semana/evolucao como entregues ao Prescritor).
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach')
export class TrainingAnalysisController {
  constructor(private readonly analyst: TrainingAnalystService) {}

  @Get('students/:studentId/training-analysis')
  get(@Param('studentId') studentId: string, @Query('scope') scope?: string, @Query('planId') planId?: string, @Query('sessionId') sessionId?: string, @Query('limit') limit?: string) {
    return this.analyst.read(studentId, { scope, planId, sessionId, limit: limit ? Number(limit) : undefined });
  }
}
