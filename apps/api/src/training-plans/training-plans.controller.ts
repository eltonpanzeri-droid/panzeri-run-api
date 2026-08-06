import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { TrainingPlansService } from './training-plans.service';

@UseGuards(AuthGuard('jwt'))
@Controller('training-plans')
export class TrainingPlansController {
  constructor(private readonly trainingPlansService: TrainingPlansService) {}

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
