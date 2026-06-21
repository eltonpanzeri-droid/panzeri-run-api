import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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
}

interface WeeklyAvailabilityInput {
  weekday: number;
  noTraining: boolean;
  modalities: string[];
  availableMin?: number | null;
}
