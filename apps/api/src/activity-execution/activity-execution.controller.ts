import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { SessionExecutionLinkService } from './session-execution-link.service';
import { ActivityDetailService } from './activity-detail.service';

// Visualizacao Prescrito x Realizado (02/10/2026) — endpoints do aluno sobre reconciliacao. Nunca
// redecide classificacao/correspondencia aqui, so' delega pro service (ja testado) com checagem de
// posse. O read model Prescrito x Realizado em si vem embutido em GET /training-plans/current e
// /training-plans/week-by-offset (ver TrainingPlansService.presentPlan), nao por endpoint separado.
@UseGuards(AuthGuard('jwt'))
@Controller('me/activity-reconciliation')
export class ActivityExecutionController {
  constructor(
    private readonly sessionExecutionLinkService: SessionExecutionLinkService,
    private readonly activityDetailService: ActivityDetailService,
  ) {}

  // "Ver treino completo" (03/10/2026): detalhe canonico da execucao — resumo, Prescrito x Realizado,
  // parciais por km e serie amostrada pra grafico. Somente leitura, sempre com checagem de posse.
  @Get(':activityLogId/detail')
  detail(@CurrentUser() user: CurrentUserPayload, @Param('activityLogId') activityLogId: string) {
    return this.activityDetailService.getDetail(user.sub, activityLogId);
  }

  @Post(':linkId/confirm')
  confirm(@CurrentUser() user: CurrentUserPayload, @Param('linkId') linkId: string, @Body('note') note?: string) {
    return this.sessionExecutionLinkService.confirmCandidateAsStudent(user.sub, linkId, note ?? null);
  }

  // Correcao pelo aluno (10/2026): "Vincular a treino prescrito" (tambem corrige um vinculo existente) e "Desfazer vinculo".
  @Get(':activityLogId/linkable-sessions')
  linkableSessions(@CurrentUser() user: CurrentUserPayload, @Param('activityLogId') activityLogId: string) {
    return this.sessionExecutionLinkService.linkableSessionsAsStudent(user.sub, activityLogId);
  }

  @Post(':activityLogId/link')
  link(@CurrentUser() user: CurrentUserPayload, @Param('activityLogId') activityLogId: string, @Body('trainingSessionId') trainingSessionId: string) {
    return this.sessionExecutionLinkService.linkActivityToSessionAsStudent(user.sub, activityLogId, String(trainingSessionId ?? ''));
  }

  @Post(':activityLogId/unlink')
  unlink(@CurrentUser() user: CurrentUserPayload, @Param('activityLogId') activityLogId: string, @Body('note') note?: string) {
    return this.sessionExecutionLinkService.unlinkActivityAsStudent(user.sub, activityLogId, note ?? null);
  }

  // Feedback de Atividade Alternativa (02/10/2026) — materializa (idempotente) a TrainingSession +
  // WorkoutCompletion sinteticas pra' uma ActivityLog 'alternative', devolvendo o sessionId pro
  // mobile abrir o MESMO formulario de feedback (POST /workout-completions) ja' usado pra sessoes
  // normais. Nunca cria um segundo sistema de feedback.
  @Post(':activityLogId/materialize')
  materialize(@CurrentUser() user: CurrentUserPayload, @Param('activityLogId') activityLogId: string) {
    return this.sessionExecutionLinkService.materializeExtraActivityAsStudent(user.sub, activityLogId);
  }
}
