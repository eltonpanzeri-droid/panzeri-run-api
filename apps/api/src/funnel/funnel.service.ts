import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../billing/telegram.service';

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
  async record(params: {
    sessionId: string;
    event: string;
    userId?: string | null;
    questionId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    if (!params.sessionId || !params.event) return;
    const event = params.event.toLowerCase().replace(/[^a-z_]/g, '');
    // Eventos desconhecidos ainda sao gravados (cliente pode estar a frente do servidor),
    // mas passam pelo sanitize de nome pra evitar strings arbitrarias grandes.
    await this.prisma.funnelEvent.create({
      data: {
        sessionId: params.sessionId.slice(0, 64),
        userId: params.userId ?? null,
        event,
        questionId: params.questionId?.slice(0, 64) ?? null,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : undefined,
      },
    }).catch((err) => {
      // Nunca propaga erro — dado de analytics nao pode derrubar o fluxo principal.
      this.logger.warn(`FunnelEvent: falha ao gravar ${event}: ${String(err)}`);
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

    const stalledSessions = signedUpSessions.filter((s) => !completedSessions.has(s.sessionId));

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
