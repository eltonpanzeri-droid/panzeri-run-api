import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { CreateManualSessionDto } from './dto/create-manual-session.dto';
import { UpdateStudentAvailabilityDto } from './dto/update-student-availability.dto';

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

  @Get('funnel-report')
  signupFunnel() {
    return this.coachService.signupFunnel();
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

  @Post('students/:studentId/sessions')
  createManualSession(@Param('studentId') studentId: string, @Body() dto: CreateManualSessionDto) {
    return this.coachService.createManualSession(studentId, dto);
  }

  @Patch('students/:studentId/sessions/:sessionId')
  updateTrainingSession(
    @Param('studentId') studentId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateTrainingSessionDto,
  ) {
    return this.coachService.updateTrainingSession(studentId, sessionId, dto);
  }

  // Excluir de vez um treino que a IA gerou errado/duplicado (nunca um ja registrado pela aluna
  // — ver deleteTrainingSession). Pedido real 10/08, escape hatch manual pro treinador.
  @Delete('students/:studentId/sessions/:sessionId')
  deleteTrainingSession(@Param('studentId') studentId: string, @Param('sessionId') sessionId: string) {
    return this.coachService.deleteTrainingSession(studentId, sessionId);
  }

  @Post('students/:studentId/plan/regenerate-week')
  regenerateStudentWeek(@Param('studentId') studentId: string, @Body() body: { allowToday?: boolean }) {
    return this.coachService.regenerateStudentWeek(studentId, body?.allowToday);
  }

  @Post('students/:studentId/plan/recover-sessions')
  recoverStudentSessions(@Param('studentId') studentId: string) {
    return this.coachService.recoverStudentSessions(studentId);
  }

  // Pedido explicito do treinador 16/08 — aluno tem 2 tentativas base de "Gerar treino da
  // semana" por semana; esse botao libera mais uma, so quando esgotadas (ver AppMenu/painel).
  @Post('students/:studentId/plan/allow-extra-generation-attempt')
  allowExtraGenerationAttempt(@Param('studentId') studentId: string) {
    return this.coachService.allowExtraGenerationAttempt(studentId);
  }

  @Post('students/:studentId/strava/analyze')
  analyzeStudentStrava(@Param('studentId') studentId: string) {
    return this.coachService.analyzeStudentStrava(studentId);
  }

  @Post('students/:studentId/sync-availability')
  syncStudentAvailability(@Param('studentId') studentId: string) {
    return this.coachService.syncStudentAvailability(studentId);
  }

  @Patch('students/:studentId/availability')
  updateStudentAvailability(@Param('studentId') studentId: string, @Body() dto: UpdateStudentAvailabilityDto) {
    return this.coachService.updateStudentAvailability(studentId, dto);
  }

  @Post('students/:studentId/billing/checkout-link')
  createStudentCheckoutLink(@Param('studentId') studentId: string, @Body() dto: { cpf?: string }) {
    return this.coachService.createStudentCheckoutLink(studentId, dto?.cpf);
  }

  @Patch('students/:studentId/billing/cpf')
  saveStudentCpf(@Param('studentId') studentId: string, @Body() dto: { cpf: string }) {
    return this.coachService.saveStudentCpf(studentId, dto?.cpf);
  }

  @Post('students/:studentId/billing/refresh')
  refreshStudentBillingStatus(@Param('studentId') studentId: string) {
    return this.coachService.refreshStudentBillingStatus(studentId);
  }

  @Post('billing/refresh-all')
  refreshAllPendingBillingStatus() {
    return this.coachService.refreshAllPendingBillingStatus();
  }

  // Historico de faturas (pedido 16/08 — tela tipo "Historico de contas" da Cemig). Mesma funcao
  // usada pelo proprio aluno em billing.controller.ts.
  @Get('students/:studentId/billing/history')
  studentBillingHistory(@Param('studentId') studentId: string) {
    return this.coachService.studentBillingHistory(studentId);
  }

  @Post('plans/generate-next-week-all')
  generateNextWeekForAllStudents() {
    return this.coachService.generateNextWeekForAllStudents();
  }

  @Post('students/:studentId/sessions/:sessionId/regenerate')
  regenerateStudentSession(
    @Param('studentId') studentId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: { allowToday?: boolean },
  ) {
    return this.coachService.regenerateStudentSession(studentId, sessionId, body?.allowToday);
  }

  @Post('students/:studentId/observations/:observationId/archive')
  archiveObservation(@Param('studentId') studentId: string, @Param('observationId') observationId: string) {
    return this.coachService.archiveObservation(studentId, observationId);
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


