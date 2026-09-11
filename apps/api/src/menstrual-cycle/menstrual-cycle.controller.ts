import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { CreateCycleLogDto } from './dto/create-cycle-log.dto';
import { UpsertMenstrualProfileDto } from './dto/upsert-menstrual-profile.dto';
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

  // Log de ciclos (data do dia 1 + sintomas opcionais)
  @Post('log')
  createLog(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateCycleLogDto) {
    return this.svc.createLog(user.sub, dto);
  }

  @Get('logs')
  getLogs(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.getLogs(user.sub);
  }

  // Fase estimada atual (para o app exibir contexto + para a tela de registro)
  @Get('status')
  getStatus(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.getEstimatedPhaseContext(user.sub);
  }
}
