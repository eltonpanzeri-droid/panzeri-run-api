import { Body, Controller, Delete, Get, GoneException, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { PatchAvailabilityDaysDto, UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateAnamneseDto } from './dto/update-anamnese.dto';
import { UpdateHealthDto } from './dto/update-health.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MeService } from './me.service';
import { RoutineService } from './routine.service';
import { isRoutineAnswerKey } from '../training-plans/training-methodology';
import { ProfilePhotoService } from '../profile-photo/profile-photo.service';
import { TrainingIntelligenceQueryService } from '../training-intelligence/training-intelligence-query.service';
import { PrismaService } from '../prisma/prisma.service';
import { settlePendingReevaluation, viewOf } from '../activity-execution/pending-reevaluation';

@UseGuards(AuthGuard('jwt'))
@Controller('me')
export class MeController {
  constructor(
    private readonly meService: MeService,
    private readonly trainingIntelligenceQuery: TrainingIntelligenceQueryService,
    private readonly prisma: PrismaService,
    private readonly profilePhoto: ProfilePhotoService,
    // Comando unico de gravacao da rotina (26/10/2026). Ultimo e opcional so' para testes antigos que constroem o controlador por posicao; em producao e' sempre injetado.
    private readonly routine?: RoutineService,
  ) {}

  // Foto de perfil (21/10/2026): o aluno gerencia SOMENTE a propria (id sempre do token, nunca da URL).
  @Get('photo')
  getPhoto(@CurrentUser() user: CurrentUserPayload) {
    return this.profilePhoto.get(user.sub);
  }

  @Put('photo')
  setPhoto(@CurrentUser() user: CurrentUserPayload, @Body() body: { imageBase64?: unknown }) {
    return this.profilePhoto.set(user.sub, body?.imageBase64);
  }

  @Delete('photo')
  deletePhoto(@CurrentUser() user: CurrentUserPayload) {
    return this.profilePhoto.remove(user.sub);
  }

  // Nova Home do aluno (30/09/2026) — mesma leitura canônica já usada pelo painel do treinador
  // (`CoachController` → `TrainingIntelligenceQueryService.getVariableSnapshot`), agora também
  // exposta ao próprio dono do dado. Nenhum cálculo novo: é a MESMA função, só com athleteId=o
  // próprio usuário autenticado (nunca outro aluno — não repassa nenhum id da URL).
  @Get('observations/:variableId')
  async getObservation(@CurrentUser() user: CurrentUserPayload, @Param('variableId') variableId: string) {
    // Indicadores de execucao dependem de analises por sessao. Depois de uma correcao de atividade, tenta concluir a atualizacao pendente (orcamento curto) ANTES de
    // ler; se ainda restar algo, a resposta traz provisional — o app mostra o dado como em atualizacao, nunca como definitivo.
    const pending = variableId.startsWith('execution.') ? viewOf(await settlePendingReevaluation(this.prisma, user.sub, 1500)) : null;
    const snapshot = await this.trainingIntelligenceQuery.getVariableSnapshot(user.sub, variableId);
    if (!pending) return snapshot;
    return { ...snapshot, provisional: pending.analysisSessions > 0 ? { reason: 'correction_pending' as const, sessions: pending.analysisSessions, since: pending.since } : null };
  }

  @Put('profile')
  updateProfile(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateProfileDto) {
    return this.meService.updateProfile(user.sub, dto);
  }

  @Put('health')
  updateHealth(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateHealthDto) {
    return this.meService.updateHealth(user.sub, dto);
  }

  @Put('preferences')
  updatePreferences(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdatePreferencesDto) {
    return this.meService.updatePreferences(user.sub, dto);
  }

  // (26/10/2026) Unico caminho do aluno para gravar a rotina: substituicao INTEGRAL da semana (os 7 dias), com revisao esperada. 409 = a rotina mudou; recarregue.
  @Put('availability')
  async updateAvailability(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateAvailabilityDto) {
    const result = await this.routineService().replaceWeek(user.sub, dto.availability, { expectedRevision: dto.expectedRevision, source: 'student', actorId: user.sub, observation: dto.observation });
    return result;
  }

  // Alteracao PARCIAL de dias (os demais permanecem). Revisao obrigatoria.
  @Patch('availability/days')
  patchAvailabilityDays(@CurrentUser() user: CurrentUserPayload, @Body() dto: PatchAvailabilityDaysDto) {
    return this.routineService().patchDays(user.sub, dto.days, { expectedRevision: dto.expectedRevision, source: 'student', actorId: user.sub, observation: dto.observation });
  }

  // Estado da rotina lido direto da fonte operacional: cadastrada?, revisao, semana de pausa? e os sete dias. O formulario de rotina (primeiro cadastro e edicao) le DAQUI.
  @Get('routine')
  routineState(@CurrentUser() user: CurrentUserPayload) {
    return this.routineService().status(user.sub);
  }

  private routineService(): RoutineService {
    if (!this.routine) throw new Error('RoutineService nao disponivel.');
    return this.routine;
  }

  @Put('anamnese')
  updateAnamnese(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateAnamneseDto) {
    return this.meService.updateAnamnese(user.sub, dto);
  }

  @Get('availability')
  availability(@CurrentUser() user: CurrentUserPayload) {
    return this.meService.availability(user.sub);
  }

  @Get('onboarding')
  onboarding(@CurrentUser() user: CurrentUserPayload) {
    return this.meService.onboarding(user.sub);
  }

  @Put('onboarding/answer')
  saveOnboardingAnswer(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: { key: string; value: unknown; currentStep: number },
  ) {
    // (26/10/2026) Apps nativos antigos ainda enviam respostas de rotina aqui: com a compatibilidade ligada elas viram rascunho da sessao (nunca fonte da rotina);
    // desligada, o servico recusa com 400 como no fluxo novo.
    if (this.routine && typeof dto?.key === 'string' && isRoutineAnswerKey(dto.key)) {
      return this.saveLegacyRoutineAnswer(user.sub, dto);
    }
    return this.meService.saveOnboardingAnswer(user.sub, dto);
  }

  private async saveLegacyRoutineAnswer(userId: string, dto: { key: string; value: unknown; currentStep: number }) {
    const accepted = await this.routineService().stageLegacyAnswer(userId, dto);
    return accepted ? { staged: true } : this.meService.saveOnboardingAnswer(userId, dto);
  }

  @Post('onboarding/complete-quick-intake')
  completeQuickIntake(@CurrentUser() user: CurrentUserPayload) {
    return this.meService.completeQuickIntake(user.sub);
  }

  @Post('onboarding/complete')
  completeOnboarding(@CurrentUser() user: CurrentUserPayload) {
    return this.meService.completeOnboarding(user.sub);
  }

  @Post('onboarding/reopen')
  reopenOnboarding(@CurrentUser() user: CurrentUserPayload) {
    return this.meService.reopenOnboarding(user.sub);
  }

  // 10/09: chamado pelo app quando o aluno conclui a correcao de respostas via fixModule.
  // Notifica o treinador via Telegram — as respostas em si ja foram salvas por PUT onboarding/answer.
  @Post('onboarding/fix-completed')
  notifyFixAnswers(@CurrentUser() user: CurrentUserPayload) {
    return this.meService.notifyFixAnswers(user.sub);
  }

  // (26/10/2026) Rotina nao e' mais convertida a partir da entrevista. Apps antigos (primeiro cadastro) continuam funcionando por compatibilidade temporaria: o rascunho da
  // sessao e' gravado pelo comando unico da rotina, so' se o aluno ainda nao tem rotina. Com LEGACY_ROUTINE_COMPAT=off responde 410.
  @Post('onboarding/complete-routine')
  async completeRoutine(@CurrentUser() user: CurrentUserPayload) {
    const result = await this.routineService().completeLegacyRoutine(user.sub);
    if (result === null) throw new GoneException({ code: 'routine_not_interview', message: 'A rotina de treinos agora e cadastrada pelo proprio formulario da rotina. Atualize o aplicativo.' });
    return result;
  }

  @Post('exercise-responsibility')
  acceptExerciseResponsibility(@CurrentUser() user: CurrentUserPayload) {
    return this.meService.acceptExerciseResponsibility(user.sub);
  }
}
