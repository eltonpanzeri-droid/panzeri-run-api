import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { CreateCycleLogDto } from './dto/create-cycle-log.dto';
import { UpsertMenstrualProfileDto } from './dto/upsert-menstrual-profile.dto';
import { StartCycleDto } from './dto/start-cycle.dto';
import { EndCycleDto } from './dto/end-cycle.dto';
import { CorrectCycleDto } from './dto/correct-cycle.dto';
import { UpsertDailyLogDto } from './dto/upsert-daily-log.dto';
import { MenstrualCycleService } from './menstrual-cycle.service';

@Controller('menstrual-cycle')
@UseGuards(AuthGuard('jwt'))
export class MenstrualCycleController {
  constructor(private readonly svc: MenstrualCycleService) {}

  // Perfil (dados estaticos: anticoncepcional, duracao do ciclo etc.)
  @Get('profile')
  getProfile(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.getProfile(user.sub);
  }

  @Post('profile')
  upsertProfile(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpsertMenstrualProfileDto) {
    return this.svc.upsertProfile(user.sub, dto);
  }

  // Log de ciclos legado (data do dia 1 + sintomas opcionais) — mantido por compatibilidade
  @Post('log')
  createLog(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateCycleLogDto) {
    return this.svc.createLog(user.sub, dto);
  }

  @Get('logs')
  getLogs(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.getLogs(user.sub);
  }

  // Fase estimada atual (para o app exibir contexto + para a tela de registro) — legado, inalterado
  @Get('status')
  getStatus(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.getEstimatedPhaseContext(user.sub);
  }

  // ── Calendário longitudinal (25/09/2026 — evolução do acompanhamento menstrual) ─────────────

  @Post('start')
  startCycle(@CurrentUser() user: CurrentUserPayload, @Body() dto: StartCycleDto) {
    return this.svc.startCycle(user.sub, dto);
  }

  @Patch(':logId/end')
  endCycle(@CurrentUser() user: CurrentUserPayload, @Param('logId') logId: string, @Body() dto: EndCycleDto) {
    return this.svc.endCycle(user.sub, logId, dto);
  }

  @Patch(':logId')
  correctCycle(@CurrentUser() user: CurrentUserPayload, @Param('logId') logId: string, @Body() dto: CorrectCycleDto) {
    return this.svc.correctCycle(user.sub, logId, dto);
  }

  @Post('daily-log')
  upsertDailyLog(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpsertDailyLogDto) {
    return this.svc.upsertDailyLog(user.sub, dto);
  }

  @Get('daily-logs')
  getDailyLogs(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.getDailyLogs(user.sub);
  }

  @Get('overview')
  getOverview(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.getCycleOverview(user.sub);
  }
}
