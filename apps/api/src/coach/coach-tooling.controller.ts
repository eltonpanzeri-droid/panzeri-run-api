import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ClaudeToolingGuard } from '../common/claude-tooling.guard';
import { parseDashboardQuery } from './dashboard-query.util';
import { CoachService } from './coach.service';

// 28/08: acesso permanente de LEITURA pra investigacao direta em producao, sem depender do
// treinador ficar copiando token de sessao do navegador toda hora — ver conversa real sobre o
// bug "sempre desloga ao recarregar a pagina" e o pedido "preciso que vc crie uma estrategia".
// So' rotas GET, so' as que ja foram usadas de verdade nesta investigacao. Autenticacao separada
// da do painel (ClaudeToolingGuard, chave fixa em CLAUDE_TOOLING_API_KEY) — nunca a mesma sessao
// do treinador.
//
// "So' leitura" aqui significa, com precisao: nenhuma rota gasta IA nem grava dado real como
// efeito colateral de simplesmente consultar. billing/history CHAMA a API do Asaas de verdade
// (GET, sem custo, sem gravar nada do lado deles) — risco baixo, aceitavel pra consulta frequente.
// dashboard() roda fixAllStuckScheduledPlans() por baixo (corrige status de plano preso no banco,
// sem IA, idempotente, barato). O que NAO esta exposto aqui e' exatamente o caso caro/perigoso:
// GET /students/:id chamaria strava.syncIfStale(), que pode disparar analise de IA como efeito
// colateral — esse sim e' o risco real que essa ferramenta existe pra nunca reintroduzir numa
// rota pensada pra consulta frequente e automatizada (ver comentario mais abaixo).
@UseGuards(ClaudeToolingGuard)
@Controller('coach-tools')
export class CoachToolingController {
  constructor(private readonly coachService: CoachService) {}

  @Get('dashboard')
  dashboard(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.coachService.dashboard(parseDashboardQuery({ search, page, pageSize, includeArchived }));
  }

  // 28/08: NAO expõe GET /coach-tools/students/:studentId de proposito — coachService.student()
  // chama strava.syncIfStale(), que pode disparar sync real com a API do Strava, gravar
  // atividades novas no banco e ate rodar analise de IA (strava.report()) como efeito colateral
  // de simplesmente OLHAR o perfil da aluna. Isso e' o mesmo risco ja documentado no projeto
  // (abrir a pagina de uma aluna no admin sem querer disparava regeracao completa de plano) — uma
  // rota pensada pra consulta FREQUENTE por ferramenta automatizada e o pior lugar possivel pra
  // reintroduzir esse efeito colateral. dashboard() + messages/log + billing/history ja cobrem o
  // que essa investigacao precisou ate agora sem esse risco.

  @Get('students/:studentId/billing/history')
  studentBillingHistory(@Param('studentId') studentId: string) {
    return this.coachService.studentBillingHistory(studentId);
  }

  @Get('prospects')
  prospects() {
    return this.coachService.prospects();
  }

  @Get('ex-students')
  exStudents() {
    return this.coachService.exStudents();
  }

  @Get('messages/log')
  messageLog(@Query('triggerPrefix') triggerPrefix?: string) {
    return this.coachService.messageLog(triggerPrefix);
  }
}
