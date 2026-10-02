import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
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

  @Post(':sessionId/viewed')
  viewed(@CurrentUser() user: CurrentUserPayload, @Param('sessionId') sessionId: string) {
    return this.workoutCompletionsService.recordFirstViewed(user.sub, sessionId);
  }
}
