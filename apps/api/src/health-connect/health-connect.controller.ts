import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { HealthConnectIngestionService } from './health-connect-ingestion.service';

// O app Android envia as sessoes de exercicio lidas no aparelho (so' as que o aluno autorizou). O usuario vem SEMPRE do JWT.
@Controller('health-connect')
export class HealthConnectController {
  constructor(private readonly ingestion: HealthConnectIngestionService) {}

  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('exercises')
  importExercises(@CurrentUser() user: CurrentUserPayload, @Body() body: unknown) {
    return this.ingestion.importExercises(user.sub, body);
  }
}
