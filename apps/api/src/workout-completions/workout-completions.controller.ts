import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { UpsertWorkoutCompletionDto } from './dto/upsert-workout-completion.dto';
import { WorkoutCompletionsService } from './workout-completions.service';

@UseGuards(AuthGuard('jwt'))
@Controller('workout-completions')
export class WorkoutCompletionsController {
  constructor(private readonly workoutCompletionsService: WorkoutCompletionsService) {}

  @Post()
  upsert(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpsertWorkoutCompletionDto) {
    return this.workoutCompletionsService.upsert(user.sub, dto);
  }

  // Autoload do bloco Sono (01/10/2026) — mobile chama antes de abrir o formulario de feedback pra
  // saber se a noite daquele dia ja tem registro. "date" e' YYYY-MM-DD (dia do treino, mesma
  // convencao de scheduledDate); convertido pra meia-noite UTC aqui, nunca no fuso do servidor.
  @Get('sleep-night')
  getSleepNight(@CurrentUser() user: CurrentUserPayload, @Query('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      throw new BadRequestException('Parametro date invalido (use YYYY-MM-DD).');
    }
    return this.workoutCompletionsService.getNightlySleepLog(user.sub, new Date(`${date}T00:00:00.000Z`));
  }

  // Autoload do bloco Estresse (01/10/2026) — retorna a resposta mais recente dentro de 24h, se
  // existir, pra o mobile oferecer "manter ou atualizar" em vez de perguntar de novo sem necessidade.
  @Get('stress-recent')
  getStressRecent(@CurrentUser() user: CurrentUserPayload) {
    return this.workoutCompletionsService.getRecentStressCheckin(user.sub);
  }

  @Post(':sessionId/viewed')
  viewed(@CurrentUser() user: CurrentUserPayload, @Param('sessionId') sessionId: string) {
    return this.workoutCompletionsService.recordFirstViewed(user.sub, sessionId);
  }
}
