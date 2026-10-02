import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { SessionExecutionLinkService } from './session-execution-link.service';

// Visualizacao Prescrito x Realizado (02/10/2026) — primeiro endpoint do aluno sobre reconciliacao.
// So' expoe confirmCandidate (ja existente no service, nunca redecide nada aqui): "este foi qual
// treino?" quando o motor deixou uma atividade como candidata ambigua. O read model Prescrito x
// Realizado em si vem embutido em GET /training-plans/current e /training-plans/week-by-offset
// (ver TrainingPlansService.presentPlan), nao por um endpoint separado aqui.
@UseGuards(AuthGuard('jwt'))
@Controller('me/activity-reconciliation')
export class ActivityExecutionController {
  constructor(private readonly sessionExecutionLinkService: SessionExecutionLinkService) {}

  @Post(':linkId/confirm')
  confirm(@CurrentUser() user: CurrentUserPayload, @Param('linkId') linkId: string, @Body('note') note?: string) {
    return this.sessionExecutionLinkService.confirmCandidateAsStudent(user.sub, linkId, note ?? null);
  }
}
