import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { AppleHealthConsentService } from './apple-health-consent.service';
import { AppleHealthIngestionService } from './apple-health-ingestion.service';
import { AppleHealthRecordsService } from './apple-health-records.service';

// Etapa 1 (06/10/2026): o app iOS envia os HKWorkout lidos no aparelho. O usuario vem SEMPRE do JWT.
// 28/10/2026: percurso GPS, consulta de percursos pendentes e autorizacoes por categoria (mesmo modelo do Health Connect). Rotas antigas inalteradas (o aplicativo publicado so' usa /workouts).
@Controller('apple-health')
export class AppleHealthController {
  constructor(
    private readonly ingestion: AppleHealthIngestionService,
    private readonly consent: AppleHealthConsentService,
    private readonly records: AppleHealthRecordsService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('workouts')
  importWorkouts(@CurrentUser() user: CurrentUserPayload, @Body() body: unknown) {
    return this.ingestion.importWorkouts(user.sub, body);
  }

  // Saude do dia a dia (sono, passos, FC de repouso, HRV, VO2 max, composicao corporal, sinais vitais, mobilidade, ciclo, nutricao...): exige consentimento registrado por categoria.
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('health-records')
  importHealthRecords(@CurrentUser() user: CurrentUserPayload, @Body() body: unknown) {
    return this.records.importRecords(user.sub, body);
  }

  // Quais treinos importados ainda nao tem percurso + limites de envio (independe de o treino ter mudado agora).
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('routes/pending')
  pendingRoutes(@CurrentUser() user: CurrentUserPayload, @Body() body: unknown) {
    return this.ingestion.pendingRoutes(user.sub, body);
  }

  // Percurso GPS dos treinos ja' importados: exige consentimento registrado para o grupo de percurso.
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @Post('routes')
  importRoutes(@CurrentUser() user: CurrentUserPayload, @Body() body: unknown) {
    return this.ingestion.importRoutes(user.sub, body);
  }

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
  @Post('consent/reconfirm')
  reconfirm(@CurrentUser() user: CurrentUserPayload, @Body() body: { acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.consent.reconfirm(user.sub, { acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  // Retira todas as autorizacoes (apaga percurso e medidas de sensor ja' guardados; nao apaga os treinos).
  @UseGuards(AuthGuard('jwt'))
  @Delete('consent')
  withdraw(@CurrentUser() user: CurrentUserPayload) {
    return this.consent.withdrawAll(user.sub);
  }

  // Exclui os treinos JA IMPORTADOS do Apple Saude (exige estar sem autorizacao ativa).
  @UseGuards(AuthGuard('jwt'))
  @Delete('data')
  deleteData(@CurrentUser() user: CurrentUserPayload) {
    return this.consent.deleteImportedData(user.sub);
  }
}
