import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { ReassessmentService } from './reassessment.service';

@UseGuards(AuthGuard('jwt'))
@Controller('me/reassessment')
export class ReassessmentController {
  constructor(private readonly reassessmentService: ReassessmentService) {}

  @Get()
  state(@CurrentUser() user: CurrentUserPayload) {
    return this.reassessmentService.state(user.sub);
  }

  @Get('history')
  history(@CurrentUser() user: CurrentUserPayload) {
    return this.reassessmentService.history(user.sub);
  }

  @Post(':id/reopen')
  reopen(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.reassessmentService.reopen(user.sub, id);
  }

  @Put('answer')
  saveAnswer(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: { key: string; value: unknown; currentStep: number },
  ) {
    return this.reassessmentService.saveAnswer(user.sub, dto);
  }

  @Post('complete')
  complete(@CurrentUser() user: CurrentUserPayload) {
    return this.reassessmentService.complete(user.sub);
  }
}
