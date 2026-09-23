import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../billing/telegram.service';
import { hasSubscriptionAccess } from '../training-plans/training-plans.service';

// Eventos reconhecidos — usados so para validacao de entrada; nao e' enum pra nao quebrar
// se o cliente mandar evento novo antes do servidor ser atualizado.
const KNOWN_EVENTS = new Set([
  'app_opened',
  'signup_started',
  'signup_error',
  'signup_completed',
  'interview_started',
  'question_answered',
  'question_error',
  'interview_completed',
  'payment_started',
  'payment_completed',
  // Landing (19/09, fundacao longitudinal). Semantica exata, nunca intercambiaveis com pagamento:
  //  landing_view      = a pagina da Landing foi carregada (1 por sessao de navegacao)
  //  landing_cta_click = a pessoa clicou na Landing para entrar no Panzeri Run (NAO e' checkout,
  //                      NAO e' payment_started — so' a decisao de sair da Landing rumo ao app)
  'landing_view',
  'landing_cta_click',
  // Vinculo journeyId <-> userId (gravado pelo servidor a partir do JWT — ver linkJourney).
  'journey_linked',
  // Onboarding pos-pagamento (22/09, fecha o funil completo pro Leo/Intelligence):
  //  routine_configured   = aluno confirmou a rotina semanal (dias/horarios de treino)
  //  first_plan_generated = a primeira semana de treinos foi gerada com sucesso (servidor,
  //                         dentro do gate generateFirstWeekIfNeeded — nunca dispara de novo)
  'routine_configured',
  'first_plan_generated',
]);

// Ordem do funil para exibicao no painel.
const FUNNEL_STEPS = [
  { event: 'app_opened', label: 'Abriu o app' },
  { event: 'signup_started', label: 'Começou a criar conta' },
  { event: 'signup_completed', label: 'Criou conta' },
  { event: 'interview_started', label: 'Iniciou entrevista' },
  { event: 'interview_completed', label: 'Completou entrevista' },
  { event: 'payment_completed', label: 'Pagou' },
];

@Injectable()
export class FunnelService {
  private readonly logger = new Logger(FunnelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  // Endpoint publico — sem autenticacao. sessionId vem do cliente (UUID gerado no AsyncStorage).
  // Eventos invalidos sao ignorados silenciosamente pra nunca bloquear o fluxo do usuario.
  //
  // Modelo de identidade (19/09):
  //  journeyId = jornada longitudinal anonima (sobrevive entre sessoes/visitas do mesmo navegador)
  //  sessionId = uma sessao especifica (na Landing: uma visita; no PWA: a instancia do app)
  //  userId    = a pessoa, depois de se identificar
  // journeyId e sessionId NUNCA sao sinonimos. Nada aqui reescreve eventos antigos: cada linha
  // guarda a identidade disponivel NAQUELE instante; o vinculo journeyId <-> userId e' registrado
  // no cadastro (User.acquisitionAttribution.journeyId) e nos eventos posteriores que trazem os dois.
  async record(params: {
    sessionId: string;
    event: string;
    userId?: string | null;
    questionId?: string | null;
    metadata?: Record<string, unknown> | null;
    journeyId?: string | null;
    dedupeKey?: string | null;
  }): Promise<void> {
    if (!params.sessionId || !params.event) return;
    const event = params.event.toLowerCase().replace(/[^a-z_]/g, '');
    // Eventos desconhecidos ainda sao gravados (cliente pode estar a frente do servidor),
    // mas passam pelo sanitize de nome pra evitar strings arbitrarias grandes.
    await this.prisma.funnelEvent.create({
      data: {
        sessionId: params.sessionId.slice(0, 64),
        journeyId: params.journeyId?.slice(0, 64) ?? null,
        userId: params.userId ?? null,
        event,
        questionId: params.questionId?.slice(0, 64) ?? null,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : undefined,
        dedupeKey: params.dedupeKey?.slice(0, 160) ?? null,
      },
    }).catch((err) => {
      // dedupeKey e' unique: reenvio do mesmo marco (recarga, retry de rede) cai aqui e e' esperado
      // — idempotencia, nao erro. Qualquer outra falha e' so' logada: analytics nunca derruba o fluxo.
      if ((err as { code?: string })?.code === 'P2002') return;
      this.logger.warn(`FunnelEvent: falha ao gravar ${event}: ${String(err)}`);
    });
  }

  // Vinculo journeyId <-> userId. Guarda-se como um FunnelEvent 'journey_linked' (fonte canonica
  // unica de jornada; nenhuma tabela paralela): o createdAt e' o instante real em que a jornada
  // passou a ser associada a pessoa, e os eventos anonimos anteriores permanecem intactos, com
  // userId nulo (nunca sao reescritos). via='signup' = jornada que originou a conta.
  async linkJourney(userId: string, journeyId: string, sessionId: string | undefined, via: 'signup' | 'login'): Promise<void> {
    await this.record({
      sessionId: sessionId || `backend:${userId}`,
      journeyId,
      userId,
      event: 'journey_linked',
      metadata: { via },
      dedupeKey: `journey_linked:${userId}:${journeyId}`,
    });
  }

  // Retorna dados para o painel do treinador: funil agregado + sessoes paradas.
  async getReport(days = 30) {
    const since = new Date(Date.now() - days * 86400000);

    // --- 1. Funil agregado: sessoes unicas por etapa ---
    const stepCounts = await Promise.all(
      FUNNEL_STEPS.map(async (step) => {
        const count = await this.prisma.funnelEvent.groupBy({
          by: ['sessionId'],
          where: { event: step.event, createdAt: { gte: since } },
        });
        return { ...step, sessions: count.length };
      }),
    );

    // --- 2. Erros de pergunta mais frequentes ---
    const questionErrors = await this.prisma.funnelEvent.groupBy({
      by: ['questionId'],
      where: { event: 'question_error', createdAt: { gte: since } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    // --- 3. Sessoes paradas (criaram conta mas nao completaram a entrevista) ---
    // Pega sessoes que tiveram signup_completed mas nunca interview_completed.
    const signedUpSessions = await this.prisma.funnelEvent.findMany({
      where: { event: 'signup_completed', createdAt: { gte: since } },
      select: { sessionId: true, userId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const completedSessions = new Set(
      (await this.prisma.funnelEvent.findMany({
        where: { event: 'interview_completed', sessionId: { in: signedUpSessions.map((s) => s.sessionId) } },
        select: { sessionId: true },
      })).map((e) => e.sessionId),
    );

    const stalledByEvents = signedUpSessions.filter((s) => !completedSessions.has(s.sessionId));

    // 23/09: BUG REAL confirmado (caso relatado: aluna Mariana ja pagou mas aparecia presa aqui).
    // stalledByEvents e' calculado 100% a partir do HISTORICO de FunnelEvent — se o evento
    // interview_completed nunca chegou a ser gravado (app antigo sem esse evento, sessionId trocou
    // por reinstalacao, falha de rede no exato momento do disparo), a pessoa fica presa nesta lista
    // PARA SEMPRE mesmo tendo terminado a entrevista e pago de verdade depois. Eventos representam
    // o que aconteceu; NUNCA o estado atual. Por isso, pra quem tem userId vinculado, reconciliamos
    // contra a fonte de verdade (OnboardingInterview.completedAt / subscriptionStatus) antes de
    // considerar "parada agora" — quem ja avancou de verdade sai da lista, mesmo com o evento
    // faltando no historico. Sessoes anonimas (sem userId ainda) nao tem como ser reconciliadas —
    // continuam confiando so' no evento, unico dado disponivel pra elas.
    const linkedUserIds = stalledByEvents.map((s) => s.userId).filter((id): id is string => Boolean(id));
    const realStateByUserId = new Map(
      linkedUserIds.length
        ? (await this.prisma.user.findMany({
            where: { id: { in: linkedUserIds } },
            select: { id: true, subscriptionStatus: true, subscriptionManualOverride: true, onboardingInterview: { select: { completedAt: true } } },
          })).map((u) => [u.id, u])
        : [],
    );
    const stalledSessions = stalledByEvents.filter((s) => {
      if (!s.userId) return true; // anonimo: nada pra reconciliar, mantem
      const real = realStateByUserId.get(s.userId);
      if (!real) return true; // usuario nao encontrado (conta removida?) — mantem por seguranca
      const reallyCompletedInterview = Boolean(real.onboardingInterview?.completedAt);
      const reallyHasAccess = hasSubscriptionAccess(real.subscriptionStatus) || real.subscriptionManualOverride;
      return !reallyCompletedInterview && !reallyHasAccess;
    });

    // Para cada sessao parada, pega o ultimo evento e o ultimo erro de pergunta.
    const stalledDetails = await Promise.all(
      stalledSessions.slice(0, 20).map(async (s) => {
        const [lastEvent, lastError, userName] = await Promise.all([
          this.prisma.funnelEvent.findFirst({
            where: { sessionId: s.sessionId },
            orderBy: { createdAt: 'desc' },
            select: { event: true, questionId: true, createdAt: true },
          }),
          this.prisma.funnelEvent.findFirst({
            where: { sessionId: s.sessionId, event: 'question_error' },
            orderBy: { createdAt: 'desc' },
            select: { questionId: true, metadata: true, createdAt: true },
          }),
          s.userId
            ? this.prisma.user.findUnique({ where: { id: s.userId }, select: { name: true } })
            : null,
        ]);
        const hoursAgo = lastEvent ? Math.floor((Date.now() - lastEvent.createdAt.getTime()) / 3600000) : null;
        return {
          sessionId: s.sessionId,
          userId: s.userId,
          userName: userName?.name ?? null,
          signedUpAt: s.createdAt,
          lastEvent: lastEvent?.event ?? null,
          lastQuestionId: lastEvent?.questionId ?? null,
          lastSeenHoursAgo: hoursAgo,
          lastError: lastError
            ? { questionId: lastError.questionId, metadata: lastError.metadata, at: lastError.createdAt }
            : null,
          hasError: Boolean(lastError),
        };
      }),
    );

    // --- 4. Abandono pre-cadastro: acessaram o app mas nunca criaram conta ---
    const allSessionsOpened = await this.prisma.funnelEvent.groupBy({
      by: ['sessionId'],
      where: { event: 'app_opened', createdAt: { gte: since } },
    });
    const signedUpSet = new Set(signedUpSessions.map((s) => s.sessionId));
    const preCadastroDropoff = allSessionsOpened.filter((s) => !signedUpSet.has(s.sessionId)).length;

    return {
      days,
      since,
      funnel: stepCounts,
      questionErrors: questionErrors.map((e) => ({ questionId: e.questionId, count: e._count.id })),
      stalledSessions: stalledDetails,
      preCadastroDropoff,
    };
  }

  // Cron diario 08:00 — alerta Telegram para sessoes paradas ha mais de 24h sem completar entrevista.
  @Cron('0 8 * * *', { timeZone: 'America/Sao_Paulo' })
  async alertStalledSessions() {
    const report = await this.getReport(3); // ultimos 3 dias pra nao repetir alertas antigos
    const stalled = report.stalledSessions.filter(
      (s) => s.lastSeenHoursAgo !== null && s.lastSeenHoursAgo >= 24,
    );
    if (!stalled.length) return;
    const lines = stalled.map((s) => {
      const name = s.userName ? s.userName.split(' ')[0] : `sessão ${s.sessionId.slice(0, 8)}`;
      const lastStep = s.lastEvent ?? 'desconhecido';
      const horas = s.lastSeenHoursAgo ?? '?';
      const erro = s.hasError ? ' ⚠️ com erro' : '';
      return `• ${name} — parou em "${lastStep}"${erro} (${horas}h atrás)`;
    });
    await this.telegram.notifyCoach(
      `🔍 Onboarding travado — ${stalled.length} pessoa(s) parada(s) há mais de 24h:\n${lines.join('\n')}`,
    ).catch(() => null);
  }
}
