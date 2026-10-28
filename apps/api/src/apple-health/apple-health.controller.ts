import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { AppleHealthIngestionService } from './apple-health-ingestion.service';

// Etapa 1 (06/10/2026): o app iOS envia os HKWorkout lidos no aparelho. O usuario vem SEMPRE do JWT.
@Controller('apple-health')
export class AppleHealthController {
  constructor(private readonly ingestion: AppleHealthIngestionService) {}

  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('workouts')
  importWorkouts(@CurrentUser() user: CurrentUserPayload, @Body() body: unknown) {
    return this.ingestion.importWorkouts(user.sub, body);
  }

  // Percurso GPS dos treinos ja' importados (so' chega se a aluna autorizou a rota na folha do iOS).
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('routes')
  importRoutes(@CurrentUser() user: CurrentUserPayload, @Body() body: unknown) {
    return this.ingestion.importRoutes(user.sub, body);
  }
}
