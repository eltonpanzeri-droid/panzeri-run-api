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

  @Post('onboarding/complete')
  completeOnboarding(@CurrentUser() user: CurrentUserPayload) {
    return this.meService.completeOnboarding(user.sub);
  }
}
