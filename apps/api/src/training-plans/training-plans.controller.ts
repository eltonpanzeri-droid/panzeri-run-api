import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { TrainingPlansService } from './training-plans.service';
import { WeeklyCheckInService } from './weekly-checkin.service';
import { SubmitWeeklyCheckInDto } from './dto/submit-weekly-checkin.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('training-plans')
export class TrainingPlansController {
  constructor(
    private readonly trainingPlansService: TrainingPlansService,
    private readonly weeklyCheckIn: WeeklyCheckInService,
  ) {}

  @Post('week')
  generateWeek(@CurrentUser() user: CurrentUserPayload, @Body() dto: { availability?: WeeklyAvailabilityInput[] }) {
    return this.trainingPlansService.generateWeek(user.sub, dto.availability);
  }

  @Get('current')
  current(@CurrentUser() user: CurrentUserPayload) {
    return this.trainingPlansService.current(user.sub);
  }

  // So chamado pelo botao explicito "Gerar treino da semana" no app da aluna — nunca por abrir
  // nenhuma tela. Ver TrainingPlansService.generateCurrentWeekOnDemand.
  @Post('generate-current-week')
  generateCurrentWeek(@CurrentUser() user: CurrentUserPayload) {
    return this.trainingPlansService.generateCurrentWeekOnDemand(user.sub);
  }

  // Consultado pelo app ANTES de tocar em "Gerar treino da semana" — decide se mostra a tela de
  // check-in (confirmacao de registro + as 3 perguntas em escala) antes de seguir. Leitura pura.
  @Get('weekly-checkin/status')
  weeklyCheckInStatus(@CurrentUser() user: CurrentUserPayload) {
    return this.weeklyCheckIn.getStatus(user.sub);
  }

  @Post('weekly-checkin')
  submitWeeklyCheckIn(@CurrentUser() user: CurrentUserPayload, @Body() dto: SubmitWeeklyCheckInDto) {
    return this.weeklyCheckIn.submit(user.sub, dto);
  }

  @Get('week-by-offset')
  weekByOffset(@CurrentUser() user: CurrentUserPayload, @Query('offset') offset: string) {
    return this.trainingPlansService.getWeekByOffset(user.sub, Number(offset) || 0);
  }

  // Botao "Reagendar" da propria aluna — move um treino ja gerado pra outro dia da mesma semana,
  // sem gerar nada novo. Ver TrainingPlansService.rescheduleSession.
  @Patch('sessions/:sessionId/reschedule')
  rescheduleSession(
    @CurrentUser() user: CurrentUserPayload,
    @Param('sessionId') sessionId: string,
    @Body() dto: { targetWeekday: number },
  ) {
    return this.trainingPlansService.rescheduleSession(user.sub, sessionId, Number(dto?.targetWeekday));
  }
}

interface WeeklyAvailabilityInput {
  weekday: number;
  noTraining: boolean;
  modalities: string[];
  availableMin?: number | null;
  modalityDurations?: Record<string, number>;
}
