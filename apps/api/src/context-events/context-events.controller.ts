import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { ContextEventsService } from './context-events.service';
import { SubmitReturnQuestionnaireDto } from './dto/submit-return-questionnaire.dto';

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
}
