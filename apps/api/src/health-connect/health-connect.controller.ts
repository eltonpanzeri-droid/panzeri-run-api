import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { HealthConnectIngestionService } from './health-connect-ingestion.service';
import { HealthConnectConsentService } from './health-connect-consent.service';
import { HealthConnectHealthService } from './health-connect-health.service';

// O app Android envia as sessoes de exercicio lidas no aparelho (so' as que o aluno autorizou). O usuario vem SEMPRE do JWT.
@Controller('health-connect')
export class HealthConnectController {
  constructor(
    private readonly ingestion: HealthConnectIngestionService,
    private readonly consent: HealthConnectConsentService,
    private readonly health: HealthConnectHealthService,
  ) {}

  // Sono, saude diaria, HRV e indicadores (so' o que o aluno autorizou).
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('health-records')
  importHealthRecords(@CurrentUser() user: CurrentUserPayload, @Body() body: unknown) {
    return this.health.importRecords(user.sub, body);
  }

  // Autorizacoes do aluno (22/10/2026): texto/grupos a exibir, estado de cada autorizacao e alteracoes. Sempre do proprio usuario logado.
  @UseGuards(AuthGuard('jwt'))
  @Get('consent')
  consentDocument() {
    return this.consent.document();
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('permissions')
  permissions(@CurrentUser() user: CurrentUserPayload) {
    return this.consent.permissions(user.sub);
  }

  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('consent/groups')
  groups(@CurrentUser() user: CurrentUserPayload, @Body() body: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.consent.updateGroups(user.sub, { grant: body?.grant, revoke: body?.revoke, acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('consent/purposes')
  purposes(@CurrentUser() user: CurrentUserPayload, @Body() body: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.consent.updatePurposes(user.sub, { grant: body?.grant, revoke: body?.revoke, acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('consent/reconfirm')
  reconfirm(@CurrentUser() user: CurrentUserPayload, @Body() body: { acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.consent.reconfirm(user.sub, { acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  // Exclui os dados JA IMPORTADOS do Health Connect (exige estar sem autorizacao ativa).
  @UseGuards(AuthGuard('jwt'))
  @Delete('data')
  deleteData(@CurrentUser() user: CurrentUserPayload) {
    return this.consent.deleteImportedData(user.sub);
  }

  // Retira todas as autorizacoes (nao apaga o que ja foi importado).
  @UseGuards(AuthGuard('jwt'))
  @Delete('consent')
  withdraw(@CurrentUser() user: CurrentUserPayload) {
    return this.consent.withdrawAll(user.sub);
  }

  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('exercises')
  importExercises(@CurrentUser() user: CurrentUserPayload, @Body() body: unknown) {
    return this.ingestion.importExercises(user.sub, body);
  }
}
