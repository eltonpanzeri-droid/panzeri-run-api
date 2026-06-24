import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CoachService } from './coach.service';

@UseGuards(AuthGuard('jwt'))
@Controller('coach')
export class CoachController {
  constructor(private readonly coachService: CoachService) {}

  @Get('dashboard')
  dashboard() {
    return this.coachService.dashboard();
  }

  @Get('students/:studentId')
  student(@Param('studentId') studentId: string) {
    return this.coachService.student(studentId);
  }
}
