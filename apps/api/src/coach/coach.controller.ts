import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { CoachService } from './coach.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { ResetStudentPasswordDto } from './dto/reset-student-password.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
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

  @Patch('students/:studentId')
  updateStudent(@Param('studentId') studentId: string, @Body() dto: UpdateStudentDto) {
    return this.coachService.updateStudent(studentId, dto);
  }

  @Patch('students/:studentId/password')
  resetStudentPassword(@Param('studentId') studentId: string, @Body() dto: ResetStudentPasswordDto) {
    return this.coachService.resetStudentPassword(studentId, dto);
  }

  @Post('students/:studentId/invite')
  createStudentInvite(@Param('studentId') studentId: string) {
    return this.coachService.createStudentInvite(studentId);
  }
}
