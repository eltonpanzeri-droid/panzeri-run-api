import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { ContextEventsService } from './context-events.service';
import { SubmitReturnQuestionnaireDto } from './dto/submit-return-questionnaire.dto';
import { StartMedicationDto } from './dto/start-medication.dto';
import { EndMedicationDto } from './dto/end-medication.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('me/context-events')
export class ContextEventsController {
  constructor(private readonly contextEvents: ContextEventsService) {}

  // Chamado pelo app (ex: ao abrir a tela inicial) pra saber se deve mostrar o questionario de
  // retorno-apos-lacuna. Nao bloqueia geracao de treino nem nenhum outro fluxo — so' informa.
  @Get('return-check')
  returnCheck(@CurrentUser() user: CurrentUserPayload) {
    return this.contextEvents.getReturnQuestionnaireState(user.sub);
  }

  @Post('return')
  submitReturn(@CurrentUser() user: CurrentUserPayload, @Body() dto: SubmitReturnQuestionnaireDto) {
    return this.contextEvents.submitReturnQuestionnaire(user.sub, dto);
  }

  // Medicamentos (26/09/2026) — contexto longitudinal autorrelatado pela aluna.
  @Get('medications')
  listMedications(@CurrentUser() user: CurrentUserPayload) {
    return this.contextEvents.listMedications(user.sub);
  }

  @Post('medications')
  startMedication(@CurrentUser() user: CurrentUserPayload, @Body() dto: StartMedicationDto) {
    return this.contextEvents.startMedication(user.sub, dto);
  }

  @Patch('medications/:id/end')
  endMedication(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: EndMedicationDto) {
    return this.contextEvents.endMedication(user.sub, id, dto);
  }
}
