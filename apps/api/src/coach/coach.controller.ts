import { Body, Controller, Delete, Get, GoneException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { AccountDeletionService } from '../account-deletion/account-deletion.service';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { CoachService } from './coach.service';
import { BusinessIntelligenceService } from './business-intelligence.service';
import { StudentIntegrationsService } from './student-integrations.service';
import { StudentHealthRecoveryService, type HealthRecoveryQuery } from './student-health-recovery.service';
import { StudentTrainingLoadService } from './student-training-load.service';
import { TrainingIntelligenceQueryService } from '../training-intelligence/training-intelligence-query.service';
import { AthleteStateSnapshotService } from '../training-intelligence/athlete-state-snapshot.service';
import { parseDashboardQuery } from './dashboard-query.util';
import { CreateStudentDto } from './dto/create-student.dto';
import { MergeStudentDto } from './dto/merge-student.dto';
import { SendStudentMessageDto } from './dto/send-student-message.dto';
import { ResetStudentPasswordDto } from './dto/reset-student-password.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { UpdateTrainingSessionDto } from './dto/update-training-session.dto';
import { CreateManualSessionDto } from './dto/create-manual-session.dto';
import { UpdateStudentAvailabilityDto } from './dto/update-student-availability.dto';
import { ContextEventsService } from '../context-events/context-events.service';
import { CreateContextEventDto } from '../context-events/dto/create-context-event.dto';
import { ReassessmentService } from '../reassessment/reassessment.service';
import { listVariableIds, getVariableDefinition } from '../training-intelligence/variable-registry';
import { explorerInfoOf } from '../training-intelligence/explorer-catalog';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach')
export class CoachController {
  constructor(
    private readonly coachService: CoachService,
    private readonly businessIntelligence: BusinessIntelligenceService,
    private readonly trainingIntelligenceQuery: TrainingIntelligenceQueryService,
    private readonly athleteStateSnapshot: AthleteStateSnapshotService,
    private readonly accountDeletion: AccountDeletionService,
    private readonly contextEvents: ContextEventsService,
    private readonly reassessmentService: ReassessmentService,
    private readonly studentIntegrations: StudentIntegrationsService,
    private readonly studentHealthRecovery: StudentHealthRecoveryService,
    private readonly studentTrainingLoad: StudentTrainingLoadService,
  ) {}

  // Passo 4 (25/09/2026) — caminho manual do treinador pra registrar um ContextEvent (viagem,
  // mudanca de trabalho, doenca, etc). Sem tela grande no admin ainda (Passo 5); endpoint pronto.
  @Post('students/:studentId/context-events')
  createContextEvent(@Param('studentId') studentId: string, @Body() dto: CreateContextEventDto) {
    return this.contextEvents.createManual(studentId, dto);
  }

  // Passo 5 (25/09/2026) — lista pro Admin exibir na tela individual/timeline. So' leitura, nunca
  // recalcula nada (ContextEventsService.listForStudent devolve as linhas como estao no banco).
  @Get('students/:studentId/context-events')
  listContextEvents(@Param('studentId') studentId: string) {
    return this.contextEvents.listForStudent(studentId);
  }

  // Passo 5 (25/09/2026) — trajetoria INITIAL->R1->R2->R3 + historico de Evolution Reports pro
  // Admin. So' leitura do que ja foi calculado/persistido (ReassessmentService.complete()).
  @Get('students/:studentId/reassessment-trajectory')
  getReassessmentTrajectory(@Param('studentId') studentId: string) {
    return this.reassessmentService.getTrajectoryForAdmin(studentId);
  }

  // Passo 5 (25/09/2026) — Visao Geral da Training Intelligence (agregado, ver CoachService).
  @Get('data/training-intelligence/overview')
  getTrainingIntelligenceOverview() {
    return this.coachService.trainingIntelligenceOverview();
  }

  // Passo 5 (continuacao, 25/09/2026) — legenda de todas as variaveis do VariableRegistry, pro
  // Admin montar os seletores do Explorador/Populacao agrupados por dominio SEM duplicar a
  // semantica em texto proprio (reusa constructLabel/scale/direction/domain, unica fonte real).
  @Get('data/training-intelligence/students-list')
  getAllActiveStudentsLight() {
    return this.coachService.allActiveStudentsLight();
  }

  @Get('data/training-intelligence/variable-legend')
  getVariableLegend() {
    return listVariableIds().map((id) => {
      const def = getVariableDefinition(id)!;
      return {
        id: def.variableId,
        domain: def.domain,
        dataType: def.dataType,
        constructLabel: def.constructLabel,
        scale: def.scale,
        direction: def.direction,
        allowedMathStrategy: def.allowedMathStrategy,
        // 27/10/2026 — ficha do botao (i) e categoria da Evolucao; so' leitura do registro.
        info: explorerInfoOf(def),
      };
    });
  }

  // Passo 5 (continuacao) — Populacao por variavel: "quais alunos tem dado/tendencia relevante
  // nesta variavel agora". So' computado sob demanda (quando o treinador escolhe a variavel no
  // Explorador/Populacao) — nunca ao abrir a tela, pra nao buscar a serie de todo mundo de uma vez
  // (secao 13). Reusa TrainingIntelligenceQueryService.getVariableSnapshot por aluno — mesma
  // matematica do individual, nenhuma formula nova, so' um loop de agregacao.
  @Get('data/training-intelligence/population/:variableId')
  async getVariablePopulation(@Param('variableId') variableId: string) {
    return this.coachService.variablePopulation(variableId, this.trainingIntelligenceQuery);
  }

  // Passo 5 (continuacao) — todos os testes de 3km do aluno (a listagem padrao do StudentDetail
  // limita a 3 pra nao pesar a tela principal). Usado pela trajetoria de FitnessTest e pela
  // Timeline integrada — preserva o historico inteiro (secao 7: "nao reduzir ao ultimo teste").
  @Get('students/:studentId/fitness-tests')
  getAllFitnessTests(@Param('studentId') studentId: string) {
    return this.coachService.allFitnessTests(studentId);
  }

  // Passo 5 (continuacao) — "Resultados do Metodo" (ver CoachService.methodResults). Agregado
  // real, nunca causalidade — linguagem de "evolucao observada durante o acompanhamento".
  @Get('data/training-intelligence/method-results')
  getMethodResults() {
    return this.coachService.methodResults();
  }

  // 24/09: endpoint isolado de validacao ponta a ponta da fundacao de Training Intelligence
  // (Prisma -> ObservationReader -> MathLayer -> resposta estruturada). Ver auditoria aprovada:
  // nao redesenha Admin nem altera agente, so expoe a camada nova pra validacao manual.
  // modalities (25/09/2026, Exploracao Longitudinal): filtro opcional "?modalities=corrida,forca"
  // — mesma pipeline de calculo, aplicada so' ao subconjunto escolhido pelo treinador.
  @Get('students/:id/observations/:variableId')
  getStudentObservationSnapshot(
    @Param('id') id: string,
    @Param('variableId') variableId: string,
    @Query('modalities') modalities?: string,
    @Query('source') source?: string,
    @Query('reference') reference?: string,
  ) {
    const modalityList = modalities ? modalities.split(',').map((m) => m.trim()).filter(Boolean) : undefined;
    // 27/10/2026 — `source` escolhe a fonte (variaveis nao comparaveis entre fontes) e `reference=1` anexa as referencias anteriores a cada observacao (Evolucao do painel).
    return this.trainingIntelligenceQuery.getVariableSnapshot(id, variableId, modalityList, source?.trim() || undefined, { withReference: reference === '1' });
  }

  // 27/10/2026 — disponibilidade (n, primeiro e ultimo registro) de varios indicadores: alimenta a lista lateral da Evolucao sem baixar a serie de cada um.
  @Get('students/:id/observations-availability')
  getStudentObservationsAvailability(@Param('id') id: string, @Query('variables') variables?: string) {
    const ids = (variables ?? '').split(',').map((v) => v.trim()).filter(Boolean).slice(0, 80);
    return this.trainingIntelligenceQuery.getVariablesAvailability(id, ids);
  }

  // 24/09: Athlete State Snapshot V1 — endpoint isolado, so' de validacao (pedido explicito: NAO
  // conectar ao prescription-agent nesta rodada). Orquestra a fundacao ja existente, nao recalcula nada.
  @Get('students/:id/athlete-state')
  getStudentAthleteState(@Param('id') id: string) {
    return this.athleteStateSnapshot.getSnapshot(id);
  }
  @Get('finance')
  finance() {
    return this.coachService.finance();
  }

  // 15/10/2026: series diarias de prospectos (somente leitura). days: 7 a 365 (padrao 90).
  @Get('prospects/series')
  prospectsSeries(@Query('days') days?: string) {
    return this.coachService.prospectsSeries({ days: days ? Number(days) : undefined });
  }

  // 15/10/2026: visao "Programas e IA" (somente leitura).
  @Get('ai/overview')
  aiOverview() {
    return this.coachService.aiOverview();
  }

  // 15/10/2026: funil de pessoas lido do banco (somente leitura). days: 7, 30, 90...; sem days = desde sempre.
  @Get('funnel/people')
  signupFunnelPeople(@Query('days') days?: string) {
    return this.coachService.signupFunnelPeople({ days: days ? Number(days) : undefined });
  }

  // 15/10/2026: calendario de vencimentos (somente leitura). from/to no formato AAAA-MM-DD; sem eles, hoje + 30 dias.
  @Get('finance/due-dates')
  financeDueDates(@Query('from') from?: string, @Query('to') to?: string) {
    return this.coachService.financeDueDates({ from, to });
  }

  @Get('exercise-library')
  exerciseLibrary() {
    return this.coachService.exerciseLibrary();
  }

  // 05/10/2026: gerar/exportar um dump completo do banco e' capacidade de ADMIN (nao de coach comum).
  @Roles('admin')
  @Post('backup/run')
  runDatabaseBackup() {
    return this.coachService.runDatabaseBackup();
  }

  @Post('notification-triggers/run')
  runNotificationTriggersNow() {
    return this.coachService.runNotificationTriggersNow();
  }

  @Get('prospects')
  prospects() {
    return this.coachService.prospects();
  }

  @Get('free-tester-emails')
  listFreeTesterEmails() {
    return this.coachService.listFreeTesterEmails();
  }

  @Post('free-tester-emails')
  addFreeTesterEmail(@Body() body: { email: string; note?: string }) {
    return this.coachService.addFreeTesterEmail(body.email, body.note);
  }

  @Delete('free-tester-emails/:id')
  removeFreeTesterEmail(@Param('id') id: string) {
    return this.coachService.removeFreeTesterEmail(id);
  }

  @Get('ex-students')
  exStudents() {
    return this.coachService.exStudents();
  }

  @Post('prospects/nurture/run')
  runProspectNurtureNow() {
    return this.coachService.runProspectNurtureNow();
  }

  // triggerPrefix opcional: ex ?triggerPrefix=nurture_ pra ver so' o aquecimento de prospecto.
  // Sem o parametro, mostra todo e-mail recente do sistema (cobranca, mensagem manual, etc.).
  @Get('messages/log')
  messageLog(@Query('triggerPrefix') triggerPrefix?: string) {
    return this.coachService.messageLog(triggerPrefix);
  }

  @Get('coupons')
  coupons() {
    return this.coachService.coupons();
  }

  @Post('coupons')
  createCoupon(@Body() dto: { code: string; name?: string; discountPercent?: number; active?: boolean }) {
    return this.coachService.createCoupon(dto);
  }

  @Patch('coupons/:couponId')
  updateCoupon(@Param('couponId') couponId: string, @Body() dto: { code?: string; name?: string; discountPercent?: number; active?: boolean }) {
    return this.coachService.updateCoupon(couponId, dto);
  }

  @Get('funnel-report')
  signupFunnel() {
    return this.coachService.signupFunnel();
  }

  // 10/09: calendário de provas — todas as provas de todos os alunos ativos, ordenadas por data.
  @Get('races/calendar')
  racesCalendar() {
    return this.coachService.racesCalendar();
  }

  @Get('dashboard')
  dashboard(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('paymentGroup') paymentGroup?: string,
    @Query('trainingStatus') trainingStatus?: string,
  ) {
    return this.coachService.dashboard(parseDashboardQuery({ search, page, pageSize, includeArchived, paymentGroup, trainingStatus }));
  }

  @Post('students')
  createStudent(@Body() dto: CreateStudentDto) {
    return this.coachService.createStudent(dto);
  }

  @Get('students/:studentId')
  student(@Param('studentId') studentId: string) {
    return this.coachService.student(studentId);
  }

  @Patch('students/:studentId')
  updateStudent(@Param('studentId') studentId: string, @Body() dto: UpdateStudentDto) {
    return this.coachService.updateStudent(studentId, dto);
  }

  @Post('students/:studentId/sessions')
  createManualSession(@Param('studentId') studentId: string, @Body() dto: CreateManualSessionDto) {
    return this.coachService.createManualSession(studentId, dto);
  }

  @Patch('students/:studentId/sessions/:sessionId')
  updateTrainingSession(
    @Param('studentId') studentId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateTrainingSessionDto,
  ) {
    return this.coachService.updateTrainingSession(studentId, sessionId, dto);
  }

  // Excluir de vez um treino que a IA gerou errado/duplicado (nunca um ja registrado pela aluna
  // — ver deleteTrainingSession). Pedido real 10/08, escape hatch manual pro treinador.
  @Delete('students/:studentId/sessions/:sessionId')
  deleteTrainingSession(@Param('studentId') studentId: string, @Param('sessionId') sessionId: string) {
    return this.coachService.deleteTrainingSession(studentId, sessionId);
  }

  @Post('students/:studentId/plan/regenerate-week')
  regenerateStudentWeek(@Param('studentId') studentId: string, @Body() body: { allowToday?: boolean }) {
    return this.coachService.regenerateStudentWeek(studentId, body?.allowToday);
  }

  @Post('students/:studentId/plan/recover-sessions')
  recoverStudentSessions(@Param('studentId') studentId: string) {
    return this.coachService.recoverStudentSessions(studentId);
  }


  // Pedido explicito do treinador 16/08 — aluno tem 2 tentativas base de "Gerar treino da
  // semana" por semana; esse botao libera mais uma, so quando esgotadas (ver AppMenu/painel).
  @Post('students/:studentId/plan/allow-extra-generation-attempt')
  allowExtraGenerationAttempt(@Param('studentId') studentId: string) {
    return this.coachService.allowExtraGenerationAttempt(studentId);
  }

  // (26/10/2026) REMOVIDO: o reparo que reconstruia a rotina a partir da entrevista historica nao existe mais. A rotina so' muda pelo comando unico (PATCH abaixo).
  @Post('students/:studentId/sync-availability')
  syncStudentAvailability() {
    throw new GoneException({ code: 'routine_not_interview', message: 'A rotina nao e mais reconstruida a partir da entrevista. Edite a rotina diretamente no painel do aluno.' });
  }

  @Patch('students/:studentId/availability')
  updateStudentAvailability(@CurrentUser() actor: CurrentUserPayload, @Param('studentId') studentId: string, @Body() dto: UpdateStudentAvailabilityDto) {
    return this.coachService.updateStudentAvailability(studentId, dto, actor.sub);
  }

  @Post('students/:studentId/billing/checkout-link')
  createStudentCheckoutLink(@Param('studentId') studentId: string, @Body() dto: { cpf?: string }) {
    return this.coachService.createStudentCheckoutLink(studentId, dto?.cpf);
  }

  @Patch('students/:studentId/billing/cpf')
  saveStudentCpf(@Param('studentId') studentId: string, @Body() dto: { cpf: string }) {
    return this.coachService.saveStudentCpf(studentId, dto?.cpf);
  }

  @Post('students/:studentId/billing/refresh')
  refreshStudentBillingStatus(@Param('studentId') studentId: string) {
    return this.coachService.refreshStudentBillingStatus(studentId);
  }

  @Post('billing/refresh-all')
  refreshAllPendingBillingStatus() {
    return this.coachService.refreshAllPendingBillingStatus();
  }

  // Historico de faturas (pedido 16/08 — tela tipo "Historico de contas" da Cemig). Mesma funcao
  // usada pelo proprio aluno em billing.controller.ts.
  @Get('students/:studentId/billing/history')
  studentBillingHistory(@Param('studentId') studentId: string) {
    return this.coachService.studentBillingHistory(studentId);
  }

  @Post('plans/generate-next-week-all')
  generateNextWeekForAllStudents() {
    return this.coachService.generateNextWeekForAllStudents();
  }

  @Post('students/:studentId/sessions/:sessionId/regenerate')
  regenerateStudentSession(
    @Param('studentId') studentId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: { allowToday?: boolean },
  ) {
    return this.coachService.regenerateStudentSession(studentId, sessionId, body?.allowToday);
  }

  @Post('students/:studentId/observations/:observationId/archive')
  archiveObservation(@Param('studentId') studentId: string, @Param('observationId') observationId: string) {
    return this.coachService.archiveObservation(studentId, observationId);
  }

  @Patch('students/:studentId/password')
  resetStudentPassword(@Param('studentId') studentId: string, @Body() dto: ResetStudentPasswordDto) {
    return this.coachService.resetStudentPassword(studentId, dto);
  }

  @Post('students/:studentId/invite')
  createStudentInvite(@Param('studentId') studentId: string) {
    return this.coachService.createStudentInvite(studentId);
  }

  @Post('students/:studentId/reports/:reportType')
  generateStudentReport(@Param('studentId') studentId: string, @Param('reportType') reportType: string) {
    return this.coachService.generateStudentReport(studentId, reportType);
  }
  @Post('students/:studentId/onboarding/reopen')
  reopenStudentOnboarding(@Param('studentId') studentId: string) {
    return this.coachService.reopenStudentOnboarding(studentId);
  }

  @Post('students/:studentId/merge-from')
  mergeStudent(@Param('studentId') studentId: string, @Body() dto: MergeStudentDto) {
    return this.coachService.mergeStudent(studentId, dto);
  }

  @Post('students/:studentId/message')
  sendStudentMessage(@Param('studentId') studentId: string, @Body() dto: SendStudentMessageDto) {
    return this.coachService.sendStudentMessage(studentId, dto);
  }

  @Get('students/:studentId/menstrual-cycle')
  getStudentMenstrualData(@Param('studentId') studentId: string) {
    return this.coachService.getStudentMenstrualData(studentId);
  }

  // Diagnostico Admin-only (01/10/2026) — observabilidade de integracoes externas (Polar hoje,
  // Strava/Garmin/COROS depois). So' leitura do que ja existe em ActivityLog/RawExternalActivity,
  // sem matching, sem transformacao nova. Ver CoachService.listExternalActivities/getExternalActivityRaw.
  // Calendario do aluno (so' leitura): sessoes, atividades fora do programa e resumo por semana de um periodo (maximo de 70 dias, a partir de 01/08/2026).
  // Detalhe de uma atividade do relogio do aluno (parciais, grafico, prescrito x realizado, relatorio). So' leitura.
  @Get('students/:studentId/activities/:activityLogId/detail')
  activityDetail(@Param('studentId') studentId: string, @Param('activityLogId') activityLogId: string) {
    return this.coachService.activityDetailForStudent(studentId, activityLogId);
  }

  @Get('students/:studentId/calendar')
  calendar(@Param('studentId') studentId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.coachService.calendar(studentId, from, to);
  }

  // 21/10/2026 — Aluno > Integracoes: so' CONSULTA do estado real das integracoes (conexao, categorias autorizadas, o que de fato chegou, falhas, autorizacao do Atlas).
  // O treinador nunca concede consentimento nem conecta/desconecta por aqui; nenhum token ou segredo e' devolvido.
  @Get('students/:studentId/integrations')
  integrations(@Param('studentId') studentId: string) {
    return this.studentIntegrations.forStudent(studentId);
  }

  // 23/10/2026 — Aluno > Saude e Recuperacao: SOMENTE LEITURA, periodo livre (from/to), fonte e comparacao entre dois periodos (compareFrom/compareTo). So' aparece o que a aluna autorizou.
  // 23/10/2026 — Aluno > Carga (propria): metrica DESCRITIVA em avaliacao (esforco percebido x minutos), com a conta inteira a mostra. Somente leitura; o Atlas nao usa.
  @Get('students/:studentId/training-load')
  trainingLoad(@Param('studentId') studentId: string, @Query() query: { from?: string; to?: string }) {
    return this.studentTrainingLoad.forStudent(studentId, query);
  }

  @Get('students/:studentId/health-recovery')
  healthRecovery(@Param('studentId') studentId: string, @Query() query: HealthRecoveryQuery) {
    return this.studentHealthRecovery.forStudent(studentId, query);
  }

  @Get('students/:studentId/external-activities')
  listExternalActivities(@Param('studentId') studentId: string) {
    return this.coachService.listExternalActivities(studentId);
  }

  // Exclusao de conta (05/10/2026): anonimizacao irreversivel do User + exclusao dos dados pessoais/operacionais
  // (ver account-deletion.service.ts). ADMIN-ONLY, exige confirmacao explicita e tombstone externo confirmado.
  @Roles('admin')
  @Post('students/:studentId/delete-account')
  deleteStudentAccount(
    @CurrentUser() actor: CurrentUserPayload,
    @Param('studentId') studentId: string,
    @Body() body: { confirmUserId?: string; confirmText?: string },
  ) {
    return this.accountDeletion.deleteAccount(studentId, body ?? {}, { id: actor.sub, role: actor.role });
  }

  // Payload bruto do provider + samples (05/10/2026): ferramenta de diagnostico tecnico, nao faz parte do
  // acompanhamento normal do treinador — por isso EXCLUSIVO de admin (o @Roles do metodo prevalece sobre
  // o da classe). Cada leitura gera registro de auditoria (quem, qual atividade, qual aluno, quando).
  @Roles('admin')
  @Get('students/:studentId/external-activities/:activityLogId/raw')
  getExternalActivityRaw(
    @CurrentUser() actor: CurrentUserPayload,
    @Param('studentId') studentId: string,
    @Param('activityLogId') activityLogId: string,
  ) {
    return this.coachService.getExternalActivityRaw(studentId, activityLogId, { id: actor.sub, role: actor.role });
  }

  // Reprocessamento manual MINIMO (03/10/2026) — pra' atividades que ja' existiam antes do gatilho
  // automatico de classify() apos ingestao Polar. Reusa o classify() ja' existente, nenhuma logica
  // nova de correspondencia. Ver CoachService.reclassifyExternalActivity.
  @Post('students/:studentId/external-activities/:activityLogId/reclassify')
  reclassifyExternalActivity(@Param('studentId') studentId: string, @Param('activityLogId') activityLogId: string) {
    return this.coachService.reclassifyExternalActivity(studentId, activityLogId);
  }

  // Resolucao humana da identidade fisica (10/2026): decision = 'same' (o conjunto e' uma execucao so') | 'distinct' (esta observacao e' outra execucao).
  // Registra autoria/horario na evidencia de identidade e reconcilia so' o que mudou. Nunca altera sessoes prescritas.
  @Post('students/:studentId/external-activities/:activityLogId/identity-decision')
  resolveExternalActivityIdentity(
    @CurrentUser() actor: CurrentUserPayload,
    @Param('studentId') studentId: string,
    @Param('activityLogId') activityLogId: string,
    @Body() body: { decision?: unknown },
  ) {
    return this.coachService.resolveExternalActivityIdentity(studentId, actor.sub, activityLogId, body?.decision);
  }

  // Reverte a decisao humana ativa que envolve esta observacao (fica registrada como revertida, com quem/quando).
  @Post('students/:studentId/external-activities/:activityLogId/identity-decision/revert')
  revertExternalActivityIdentity(@CurrentUser() actor: CurrentUserPayload, @Param('studentId') studentId: string, @Param('activityLogId') activityLogId: string) {
    return this.coachService.revertExternalActivityIdentity(studentId, actor.sub, activityLogId);
  }

  // Indicadores minimos da qualidade da identidade fisica (resolvidas sozinhas x ambiguas x confirmacoes) — so' leitura.
  @Get('data/identity/quality')
  identityQuality(@Query('days') days?: string) {
    return this.coachService.identityQuality(days ? parseInt(days, 10) : undefined);
  }

  // Identidade fisica cross-provider (06/10/2026, Apple Etapa 2): agrupa, para UM aluno, observacoes de providers diferentes
  // que sao o mesmo evento fisico. Idempotente, nunca apaga/altera ActivityLog nem raw, nao classifica nem reconcilia.
  // 3B: reconcilia o historico do aluno por PhysicalEvent. SIMULACAO por padrao (dryRun true); so' grava com dryRun=false explicito.
  @Post('students/:studentId/external-activities/reconcile-history')
  reconcileExternalActivityHistory(@Param('studentId') studentId: string, @Body() body: { dryRun?: boolean } | undefined) {
    return this.coachService.reconcileExternalActivityHistory(studentId, body?.dryRun !== false);
  }

  // Diagnostico (so' leitura): compara duas observacoes sob demanda com o matcher atual, sem persistir nada.
  @Get('students/:studentId/external-activities/compare')
  compareExternalActivities(@Param('studentId') studentId: string, @Query('a') a: string, @Query('b') b: string) {
    return this.coachService.compareExternalActivities(studentId, String(a ?? ''), String(b ?? ''));
  }

  @Post('students/:studentId/external-activities/evaluate-identity')
  evaluateExternalActivityIdentity(@Param('studentId') studentId: string) {
    return this.coachService.evaluateExternalActivityIdentity(studentId);
  }

  // Ecossistema de execucao primario do atleta (06/10/2026, Apple Etapa 3A): vale a partir de effectiveFrom (padrao: agora) e define qual
  // observacao e' canonica nos eventos desse periodo. Nao reescreve eventos anteriores.
  @Post('students/:studentId/primary-source')
  setStudentPrimarySource(@Param('studentId') studentId: string, @Body() body: { provider?: unknown; effectiveFrom?: unknown; note?: unknown }) {
    return this.coachService.setStudentPrimarySource(studentId, body ?? {});
  }

  // ─── Panzeri Data Layer — Fase 1 ────────────────────────────────────────────

  @Get('data/growth/funnel')
  dataGrowthFunnel() {
    return this.coachService.dataGrowthFunnel();
  }

  @Get('data/growth/attribution')
  dataGrowthAttribution() {
    return this.coachService.dataGrowthAttribution();
  }

  @Get('data/customer/summary')
  dataCustomerSummary() {
    return this.coachService.dataCustomerSummary();
  }

  @Get('data/business/summary')
  dataBusinessSummary() {
    return this.coachService.dataBusinessSummary();
  }

  // 23/09: evolucao mensal de alunos por grupo de pagamento + receita recebida + novos prospectos,
  // pro grafico de "Visao geral"/"Financeiro" do painel. months clampado 1-24 dentro do service.
  // 24/09: from/to (formato 'YYYY-MM') permitem periodo personalizado em vez do atalho `months`.
  @Get('data/business/evolution')
  dataBusinessEvolution(@Query('months') months?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.businessIntelligence.getMonthlyEvolution({ months: months ? parseInt(months, 10) : undefined, from, to });
  }

  // 23/09: evolucao semanal de treino (prescrito/realizado/ajustado/extra/nao-realizado + aderencia).
  // 24/09: from/to (formato 'YYYY-MM-DD') permitem periodo personalizado em vez do atalho `weeks`.
  @Get('data/training/evolution')
  dataTrainingEvolution(@Query('weeks') weeks?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.businessIntelligence.getTrainingEvolution({ weeks: weeks ? parseInt(weeks, 10) : undefined, from, to });
  }

  @Get('data/training/student/:id/timeline')
  dataTrainingStudentTimeline(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.coachService.dataTrainingStudentTimeline(id, {
      limit: limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50,
      offset: offset ? parseInt(offset, 10) || 0 : 0,
    });
  }
}


