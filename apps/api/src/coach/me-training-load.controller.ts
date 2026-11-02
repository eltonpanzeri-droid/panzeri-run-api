import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { StudentTrainingLoadService } from './student-training-load.service';

// Carga interna percebida (esforço × minutos) para a PROPRIA aluna (02/11/2026, area "Resposta a carga" da Evolucao). SOMENTE LEITURA: e' a MESMA funcao do painel do treinador
// (StudentTrainingLoadService → coach/training-load.ts, fonte unica), sempre com o id da aluna autenticada: nenhum id vem da URL e nenhuma conta nova existe aqui.
@UseGuards(AuthGuard('jwt'))
@Controller('me/training-load')
export class MeTrainingLoadController {
  constructor(private readonly trainingLoad: StudentTrainingLoadService) {}

  @Get()
  get(@CurrentUser() user: CurrentUserPayload, @Query() query: { from?: string; to?: string }) {
    return this.trainingLoad.forStudent(user.sub, query);
  }
}
