import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { CoachService } from './coach.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { MergeStudentDto } from './dto/merge-student.dto';
import { SendStudentMessageDto } from './dto/send-student-message.dto';
import { ResetStudentPasswordDto } from './dto/reset-student-password.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { UpdateTrainingSessionDto } from './dto/update-training-session.dto';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach')
export class CoachController {
  constructor(private readonly coachService: CoachService) {}
  @Get('finance')
  finance() {
    return this.coachService.finance();
  }

  @Get('exercise-library')
  exerciseLibrary() {
    return this.coachService.exerciseLibrary();
  }

  @Post('backup/run')
  runDatabaseBackup() {
    return this.coachService.runDatabaseBackup();
  }

  @Get('coupons')
  coupons() {
    return this.coachService.coupons();
  }

  @Post('coupons')
  createCoupon(@Body() dto: { code: string; name?: string; discountPercent?: number; active?: boolean }) {
    return this.coachService.createCoupon(dto);
  }

  @Patch('coupons/:couponId')
  updateCoupon(@Param('couponId') couponId: string, @Body() dto: { code?: string; name?: string; discountPercent?: number; active?: boolean }) {
    return this.coachService.updateCoupon(couponId, dto);
  }

  @Get('dashboard')
  dashboard(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.coachService.dashboard({
      search: search?.trim() ?? '',
      page: Math.max(Number(page) || 1, 1),
      pageSize: Math.min(Math.max(Number(pageSize) || 25, 5), 100),
      includeArchived: includeArchived === '1' || includeArchived === 'true',
    });
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

  @Patch('students/:studentId/sessions/:sessionId')
  updateTrainingSession(
    @Param('studentId') studentId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateTrainingSessionDto,
  ) {
    return this.coachService.updateTrainingSession(studentId, sessionId, dto);
  }

  @Post('students/:studentId/plan/regenerate-week')
  regenerateStudentWeek(@Param('studentId') studentId: string) {
    return this.coachService.regenerateStudentWeek(studentId);
  }

  @Post('students/:studentId/plan/recover-sessions')
  recoverStudentSessions(@Param('studentId') studentId: string) {
    return this.coachService.recoverStudentSessions(studentId);
  }

  @Post('students/:studentId/sync-availability')
  syncStudentAvailability(@Param('studentId') studentId: string) {
    return this.coachService.syncStudentAvailability(studentId);
  }

  @Post('students/:studentId/sessions/:sessionId/regenerate')
  regenerateStudentSession(@Param('studentId') studentId: string, @Param('sessionId') sessionId: string) {
    return this.coachService.regenerateStudentSession(studentId, sessionId);
  }

  @Patch('students/:studentId/password')
  resetStudentPassword(@Param('studentId') studentId: string, @Body() dto: ResetStudentPasswordDto) {
    return this.coachService.resetStudentPassword(studentId, dto);
  }

  @Post('students/:studentId/invite')
  createStudentInvite(@Param('studentId') studentId: string) {
    return this.coachService.createStudentInvite(studentId);
  }

  @Post('students/:studentId/reports/:reportType')
  generateStudentReport(@Param('studentId') studentId: string, @Param('reportType') reportType: string) {
    return this.coachService.generateStudentReport(studentId, reportType);
  }
  @Post('students/:studentId/onboarding/reopen')
  reopenStudentOnboarding(@Param('studentId') studentId: string) {
    return this.coachService.reopenStudentOnboarding(studentId);
  }

  @Post('students/:studentId/merge-from')
  mergeStudent(@Param('studentId') studentId: string, @Body() dto: MergeStudentDto) {
    return this.coachService.mergeStudent(studentId, dto);
  }

  @Post('students/:studentId/message')
  sendStudentMessage(@Param('studentId') studentId: string, @Body() dto: SendStudentMessageDto) {
    return this.coachService.sendStudentMessage(studentId, dto);
  }
}


