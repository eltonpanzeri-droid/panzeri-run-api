import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CoachService } from './coach.service';
import { CreateStudentDto } from './dto/create-student.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('coach')
export class CoachController {
  constructor(private readonly coachService: CoachService) {}

  @Get('dashboard')
  dashboard() {
    return this.coachService.dashboard();
  }

  @Post('students')
  createStudent(@Body() dto: CreateStudentDto) {
    return this.coachService.createStudent(dto);
  }

  @Get('students/:studentId')
  student(@Param('studentId') studentId: string) {
    return this.coachService.student(studentId);
  }
}
