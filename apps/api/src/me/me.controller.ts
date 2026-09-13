import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateAnamneseDto } from './dto/update-anamnese.dto';
import { UpdateHealthDto } from './dto/update-health.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MeService } from './me.service';

@UseGuards(AuthGuard('jwt'))
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

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

  @Put('availability')
  updateAvailability(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateAvailabilityDto) {
    return this.meService.updateAvailability(user.sub, dto);
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
    return this.meService.saveOnboardingAnswer(user.sub, dto);
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

  // Chamado pela tela "Rotina de treinos" (pos-pagamento) ao confirmar a rotina — respostas em si
  // ja foram salvas incrementalmente por PUT onboarding/answer (mesma entrevista, modulo "Rotina
  // semanal"); este POST so converte essas respostas em disponibilidade real e dispara a geracao.
  @Post('onboarding/complete-routine')
  completeRoutine(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body?: { changesWereMade?: boolean },
  ) {
    // changesWereMade: enviado pelo app quando o aluno conclui o modo "routine" da GuidedInterview.
    // true  → aluno realmente alterou alguma resposta → Telegram "solicitou alteracao" pode disparar.
    // false → aluno apenas navegou pelas perguntas sem mudar nada → Telegram nao dispara.
    // Omitido (undefined) → chamadas anteriores sem o campo → comportamento conservador: assume true
    // para nao silenciar Telegrams legítimos de versoes antigas do app.
    return this.meService.completeRoutineFromInterview(user.sub, body?.changesWereMade);
  }

  @Post('exercise-responsibility')
  acceptExerciseResponsibility(@CurrentUser() user: CurrentUserPayload) {
    return this.meService.acceptExerciseResponsibility(user.sub);
  }
}
