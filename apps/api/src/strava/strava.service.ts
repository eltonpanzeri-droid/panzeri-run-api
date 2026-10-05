import { BadRequestException, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { decryptToken, encryptToken, isEncryptedToken, parseTokenKey } from '../common/token-crypto';
import { deleteStravaData } from './strava-data-deletion';

// Regras Strava implementadas aqui (05/10/2026, auditoria Strava):
//  - OAuth: tentativa propria (state aleatorio, hash no banco, expira, uso unico, atomica); escopo pedido = SO' o
//    necessario (activity:read_all) e conferido no callback.
//  - Tokens cifrados em repouso (AES-256-GCM, STRAVA_TOKEN_ENCRYPTION_KEY); tokens antigos em texto migram sozinhos.
//  - Webhook: o Strava NAO assina os eventos (confirmado na documentacao atual). Autenticidade = verify_token exigido na
//    inscricao (sem valor padrao), subscription_id igual ao da NOSSA inscricao, dono conhecido, janela de tempo e
//    deduplicacao; o conteudo da atividade e' sempre rebuscado na API com o token do aluno (o payload so' traz ids).
//  - Dados Strava sao cache de 7 dias (fetchedAt) e nunca saem do proprio aluno: nada vai para treinador/Admin nem IA.
export const STRAVA_SCOPE = 'activity:read_all';
export const STRAVA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const WEBHOOK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_FUTURE_SKEW_MS = 10 * 60 * 1000;

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: { id: number };
}

interface StravaActivityResponse {
  id: number;
  name?: string;
  type?: string;
  sport_type?: string;
  start_date: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
}

export interface StravaWebhookEventInput {
  object_type?: unknown;
  object_id?: unknown;
  aspect_type?: unknown;
  owner_id?: unknown;
  subscription_id?: unknown;
  event_time?: unknown;
  updates?: unknown;
}

const hashState = (state: string) => createHash('sha256').update(state).digest('hex');

@Injectable()
export class StravaService implements OnModuleInit {
  private readonly logger = new Logger(StravaService.name);
  private webhookReady = false;
  private webhookSubscriptionId: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    setTimeout(() => {
      void this.ensureWebhookSubscription().catch((error: unknown) => {
        this.logger.warn(`Webhook automatico do Strava ainda nao ativo: ${error instanceof Error ? error.message : String(error)}`);
      });
      void this.migrateLegacyTokens().catch((error: unknown) => {
        this.logger.warn(`Migracao de tokens Strava nao concluida: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 5_000);
  }

  // Chave de cifra dos tokens (propria do Strava). Sem ela nenhum token novo e' gravado.
  private tokenKey(): Buffer {
    try {
      return parseTokenKey(this.config.get<string>('STRAVA_TOKEN_ENCRYPTION_KEY'));
    } catch {
      throw new ServiceUnavailableException('Strava ainda nao configurado no servidor.');
    }
  }

  async connectUrl(userId: string) {
    const clientId = this.config.get<string>('STRAVA_CLIENT_ID');
    const redirectUri = this.config.get<string>('STRAVA_REDIRECT_URI');

    if (!clientId || !redirectUri) {
      throw new BadRequestException('Strava ainda nao configurado no servidor.');
    }
    this.tokenKey(); // falha antes de abrir autorizacao se nao houver como guardar o token com seguranca

    // O state bruto so' sai na URL de autorizacao; no banco fica o hash, vinculado ao usuario.
    const state = randomBytes(32).toString('base64url');
    await this.prisma.stravaOAuthAttempt.create({
      data: { stateHash: hashState(state), userId, expiresAt: new Date(Date.now() + STATE_TTL_MS) },
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: STRAVA_SCOPE,
      state,
    });

    return {
      url: `https://www.strava.com/oauth/authorize?${params.toString()}`,
    };
  }

  async callback(query: { code?: unknown; state?: unknown; error?: unknown; scope?: unknown }) {
    const { code, state, error, scope } = query;
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      throw new BadRequestException('Autorizacao do Strava invalida ou expirada. Inicie a conexao novamente no aplicativo.');
    }
    // Consumo atomico: uma tentativa so' vale uma vez. Replay (inclusive reload da pagina) cai aqui e NAO e' sucesso.
    const consumed = await this.prisma.stravaOAuthAttempt.updateMany({
      where: { stateHash: hashState(state), consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new BadRequestException('Esta autorizacao do Strava e invalida, expirou ou ja foi utilizada. Se voce ja conectou, volte ao aplicativo; senao, inicie a conexao novamente.');
    }
    const attempt = await this.prisma.stravaOAuthAttempt.findUnique({ where: { stateHash: hashState(state) }, select: { userId: true } });
    if (!attempt) throw new BadRequestException('Autorizacao do Strava invalida.');
    const user = await this.prisma.user.findUnique({ where: { id: attempt.userId }, select: { id: true } });
    if (!user) {
      throw new BadRequestException('Nao foi possivel identificar o aluno para esta conexao.');
    }

    if (typeof error === 'string' || typeof code !== 'string' || !code || code.length > 2048) {
      throw new BadRequestException('A autorizacao do Strava foi cancelada ou nao concluida.');
    }
    // Escopos realmente concedidos (o aluno pode desmarcar caixas na tela do Strava). Sem o necessario, nada e' gravado.
    const granted = typeof scope === 'string' ? scope.split(/[\s,]+/).filter(Boolean) : [];
    if (!granted.includes(STRAVA_SCOPE)) {
      throw new BadRequestException('Para conectar, o Strava precisa liberar a leitura das suas atividades. Inicie a conexao de novo e mantenha marcada a opcao de ver os dados das atividades.');
    }

    const key = this.tokenKey();
    const token = await this.exchangeCode(code);
    const athleteId = String(token.athlete.id);
    const owner = await this.prisma.stravaConnection.findFirst({ where: { athleteId, userId: { not: user.id } }, select: { userId: true } });
    if (owner) throw new BadRequestException('Esta conta Strava ja esta vinculada a outro aluno.');

    const encrypted = {
      accessToken: encryptToken(token.access_token, key),
      refreshToken: encryptToken(token.refresh_token, key),
      expiresAt: new Date(token.expires_at * 1000),
    };
    await this.prisma.stravaConnection.upsert({
      where: { userId: user.id },
      create: { userId: user.id, athleteId, ...encrypted },
      update: { athleteId, ...encrypted },
    });

    await this.sync(user.id);
    void this.ensureWebhookSubscription().catch((err: unknown) => {
      this.logger.error(`Nao foi possivel ativar o webhook do Strava: ${err instanceof Error ? err.message : String(err)}`);
    });

    return 'Strava conectado ao Panzeri Run. Pode voltar ao app.';
  }

  async status(userId: string) {
    const connection = await this.prisma.stravaConnection.findUnique({ where: { userId } });
    if (!connection) {
      return { connected: false, automaticSync: false, lastActivityAt: null, lastCheckedAt: null };
    }

    let automaticSync = true;
    try {
      await this.ensureWebhookSubscription();
    } catch (error) {
      automaticSync = false;
      this.logger.error(`Webhook do Strava indisponivel: ${error instanceof Error ? error.message : String(error)}`);
    }

    const latestActivity = await this.prisma.stravaActivity.findFirst({
      where: { userId },
      orderBy: { startDate: 'desc' },
    });

    return {
      connected: true,
      automaticSync,
      athleteId: connection.athleteId,
      connectedAt: connection.createdAt,
      lastCheckedAt: connection.updatedAt,
      lastActivityAt: latestActivity?.startDate ?? null,
      lastActivityName: latestActivity?.name ?? null,
    };
  }

  async sync(userId: string) {
    const connection = await this.getValidConnection(userId);
    const after = Math.floor(addDays(new Date(), -90).getTime() / 1000);
    const activities = await this.fetchActivities(connection.accessToken, after);

    for (const activity of activities) await this.saveActivity(userId, activity);

    await this.prisma.stravaConnection.update({ where: { userId }, data: { updatedAt: new Date() } });
    // Sem analise por IA nem cache de insight: dados Strava nao alimentam nenhum agente (politica Strava).
    return {
      imported: activities.length,
    };
  }

  async syncIfStale(userId: string, staleAfterMinutes = 5) {
    const connection = await this.prisma.stravaConnection.findUnique({ where: { userId } });
    if (!connection) return { connected: false, imported: 0 };
    const staleBefore = Date.now() - staleAfterMinutes * 60_000;
    if (connection.updatedAt.getTime() >= staleBefore) return { connected: true, imported: 0, cached: true };
    return this.sync(userId);
  }

  // Valor definido na inscricao do webhook. SEM valor padrao: sem a variavel o webhook fica desativado.
  private webhookVerifyToken(): string | null {
    const value = this.config.get<string>('STRAVA_WEBHOOK_VERIFY_TOKEN')?.trim();
    return value ? value : null;
  }

  verifyWebhook(mode: string, challenge: string, verifyToken: string) {
    const expected = this.webhookVerifyToken();
    if (!expected) throw new ServiceUnavailableException('Webhook do Strava nao configurado no servidor.');
    const received = Buffer.from(String(verifyToken ?? ''));
    const wanted = Buffer.from(expected);
    const valid = received.length === wanted.length && timingSafeEqual(received, wanted);
    if (mode !== 'subscribe' || !challenge || !valid) {
      throw new BadRequestException('Validacao do webhook do Strava recusada.');
    }
    return { 'hub.challenge': challenge };
  }

  // O evento NAO e' assinado pelo Strava: so' e' processado se (1) tem o formato oficial, (2) pertence a NOSSA inscricao
  // (subscription_id), (3) esta dentro da janela de tempo, (4) ainda nao foi processado (dedupe) e (5) o dono e' um aluno
  // conectado. Nada do corpo e' confiado alem de ids: atividades sao rebuscadas na API com o token do aluno.
  async handleWebhook(raw: StravaWebhookEventInput): Promise<'processed' | 'ignored' | 'duplicate'> {
    try {
      const event = parseWebhookEvent(raw);
      if (!event) return 'ignored';

      const expected = await this.expectedSubscriptionId();
      if (expected === null || event.subscription_id !== expected) return 'ignored';

      const ageMs = Date.now() - event.event_time * 1000;
      if (ageMs > WEBHOOK_MAX_AGE_MS || ageMs < -WEBHOOK_FUTURE_SKEW_MS) return 'ignored';

      const dedupeKey = createHash('sha256').update(JSON.stringify([event.object_type, event.object_id, event.aspect_type, event.owner_id, event.event_time, event.updates])).digest('hex');
      try {
        await this.prisma.stravaWebhookEvent.create({ data: { dedupeKey } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'duplicate';
        throw error;
      }

      const connection = await this.prisma.stravaConnection.findFirst({ where: { athleteId: String(event.owner_id) } });
      if (!connection) return 'ignored';

      // Desautorizacao pelo proprio Strava: apaga toda a cadeia de proveniencia Strava deste aluno.
      if (event.object_type === 'athlete') {
        if (event.updates.authorized === 'false' || event.updates.authorized === false) {
          const deleted = await this.prisma.$transaction((tx) => deleteStravaData(tx as never, connection.userId));
          await this.prisma.providerConnectionEvent.create({
            data: { userId: connection.userId, provider: 'strava', type: 'strava_deauthorized', details: { source: 'webhook', deleted } },
          });
          return 'processed';
        }
        return 'ignored';
      }

      if (event.aspect_type === 'delete') {
        await this.prisma.stravaActivity.deleteMany({ where: { stravaId: String(event.object_id), userId: connection.userId } });
        return 'processed';
      }

      const validConnection = await this.getValidConnection(connection.userId);
      const activity = await this.fetchActivity(validConnection.accessToken, event.object_id);
      await this.saveActivity(connection.userId, activity);
      return 'processed';
    } catch (error) {
      this.logger.error(`Falha ao processar evento do Strava: ${error instanceof Error ? error.message : String(error)}`);
      return 'ignored';
    }
  }

  // Desconexao pelo proprio aluno: para a coleta NA HORA (apaga tokens e toda a cadeia Strava numa transacao) e so' depois
  // avisa o Strava (revogacao e' melhor esforco; falha externa nao desfaz a revogacao local). Idempotente.
  async disconnect(userId: string) {
    const connection = await this.prisma.stravaConnection.findUnique({ where: { userId } });
    let accessToken: string | null = null;
    if (connection) {
      try { accessToken = this.readToken(connection.accessToken); } catch { accessToken = null; }
    }
    const deleted = await this.prisma.$transaction((tx) => deleteStravaData(tx as never, userId));
    let stravaRevocation: 'revoked' | 'failed' | 'skipped' = 'skipped';
    if (connection) {
      stravaRevocation = accessToken ? await this.revokeAtStrava(accessToken) : 'failed';
      await this.prisma.providerConnectionEvent.create({
        data: { userId, provider: 'strava', type: 'strava_disconnected', details: { stravaRevocation, deleted } },
      });
    }
    return { status: connection ? 'disconnected' : 'not_connected', stravaRevocation, deleted };
  }

  // POST /oauth/revoke (endpoint de revogacao vigente do Strava): token no corpo, autenticacao Basic do app.
  private async revokeAtStrava(token: string): Promise<'revoked' | 'failed'> {
    try {
      const clientId = this.requiredConfig('STRAVA_CLIENT_ID');
      const clientSecret = this.requiredConfig('STRAVA_CLIENT_SECRET');
      const response = await fetch('https://www.strava.com/oauth/revoke', {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
      return response.ok ? 'revoked' : 'failed';
    } catch {
      return 'failed';
    }
  }

  // Retencao: dados Strava sao cache de 7 dias desde a ultima busca. Tambem apaga resquicios de derivados e eventos de
  // webhook antigos. Roda todo dia e antes de cada sincronizacao manual.
  @Cron('30 4 * * *')
  async purgeExpiredData() {
    const cutoff = new Date(Date.now() - STRAVA_CACHE_TTL_MS);
    const activities = await this.prisma.stravaActivity.deleteMany({ where: { fetchedAt: { lt: cutoff } } });
    await this.prisma.stravaWebhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } });
    await this.prisma.stravaOAuthAttempt.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    // Derivados nunca mais sao gerados; qualquer linha restante (ex.: backup antigo restaurado) e' removida.
    await this.prisma.trainingExecutionInsight.deleteMany({});
    await this.prisma.stravaAnalysisCache.deleteMany({});
    return { activities: activities.count };
  }

  // Tokens gravados em texto antes desta correcao passam a ser cifrados (idempotente; so' roda com a chave configurada).
  async migrateLegacyTokens() {
    let key: Buffer;
    try { key = parseTokenKey(this.config.get<string>('STRAVA_TOKEN_ENCRYPTION_KEY')); } catch { return { migrated: 0 }; }
    const connections = await this.prisma.stravaConnection.findMany({ select: { userId: true, accessToken: true, refreshToken: true } });
    let migrated = 0;
    for (const connection of connections) {
      if (isEncryptedToken(connection.accessToken) && isEncryptedToken(connection.refreshToken)) continue;
      await this.prisma.stravaConnection.update({
        where: { userId: connection.userId },
        data: {
          accessToken: isEncryptedToken(connection.accessToken) ? connection.accessToken : encryptToken(connection.accessToken, key),
          refreshToken: isEncryptedToken(connection.refreshToken) ? connection.refreshToken : encryptToken(connection.refreshToken, key),
        },
      });
      migrated++;
    }
    return { migrated };
  }

  private async expectedSubscriptionId(): Promise<number | null> {
    if (this.webhookSubscriptionId !== null) return this.webhookSubscriptionId;
    try {
      const subscription = await this.ensureWebhookSubscription();
      return typeof subscription === 'object' && subscription && typeof (subscription as { id?: unknown }).id === 'number'
        ? (subscription as { id: number }).id
        : this.webhookSubscriptionId;
    } catch {
      return null;
    }
  }

  // 31/08: `skipCache` deixa chamar isso de um endpoint que precisa ser leitura pura de verdade
  // (ver WeeklyCheckInService.getStatus) sem gravar o cache de trainingExecutionInsight abaixo —
  // achado por auto-revisao ao notar que essa gravacao acontecia toda vez que o aluno so' checava
  // se falta o check-in semanal, contrariando a mesma regra que ja vale pra current() (nunca
  // escrever so' por causa de alguem consultando um dado).
  async report(userId: string, context: { trigger?: string; activityId?: string; skipCache?: boolean } = {}) {
    if (!(await this.shouldAnalyze(userId))) {
      return { summary: null, items: [], analysisInactive: true };
    }
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: { sessions: { orderBy: { scheduledDate: 'asc' }, include: { completion: true } } },
    });

    if (!plan) {
      return { summary: null, items: [] };
    }

    const activities = await this.prisma.stravaActivity.findMany({
      where: {
        userId,
        startDate: {
          gte: plan.startDate,
          lte: plan.endDate ?? addDays(plan.startDate, 6),
        },
      },
      orderBy: { startDate: 'asc' },
    });

    const usedActivityIds = new Set<string>();
    const sessionMatches = plan.sessions.map((session) => {
      const activity = activities.find(
        (candidate) =>
          !usedActivityIds.has(candidate.id) &&
          sameDay(candidate.startDate, session.scheduledDate) &&
          activityMatchesSession(candidate, session.modality),
      );
      if (activity) {
        usedActivityIds.add(activity.id);
      }
      return { session, activity };
    });

    const items = sessionMatches.map(({ session, activity }) => {
      const alternateActivity = activity
        ? null
        : activities.find((candidate) => !usedActivityIds.has(candidate.id) && sameDay(candidate.startDate, session.scheduledDate)) ?? null;
      if (alternateActivity) {
        usedActivityIds.add(alternateActivity.id);
      }
      const foundActivity = activity ?? alternateActivity;
      const completion = session.completion;
      const completionIsDone = completion?.status === 'done' || completion?.status === 'adjusted';
      const isFutureSession = startOfDay(session.scheduledDate).getTime() > startOfDay(new Date()).getTime();
      const prescribedDistance = session.distanceKm ?? null;
      const prescribedDuration = session.durationMin ?? null;
      const actualDistance = foundActivity?.distanceKm ?? completion?.distanceKm ?? null;
      const actualDuration = foundActivity?.movingTimeSec ? Math.round(foundActivity.movingTimeSec / 60) : completion?.durationMin ?? null;
      const sameModalityExecutionStatus = executionMatchesPrescription({
        prescribedDistance,
        actualDistance,
        prescribedDuration,
        actualDuration,
        modality: session.modality,
      })
        ? 'as_prescribed'
        : 'same_modality_changed_execution';
      const status = activity
        ? sameModalityExecutionStatus
        : alternateActivity
          ? 'different_modality'
          : completionIsDone
            ? sameModalityExecutionStatus
            : completion?.status === 'missed'
              ? 'not_done'
              : isFutureSession
                ? 'future'
                : 'not_done';

      return {
        sessionId: session.id,
        day: session.weekday,
        date: formatDate(session.scheduledDate),
        title: session.title,
        modality: session.modality,
        prescribedDistance,
        actualDistance,
        distanceDiff: activity && prescribedDistance !== null && actualDistance !== null ? Number((actualDistance - prescribedDistance).toFixed(2)) : null,
        prescribedDuration,
        actualDuration,
        durationDiff: activity && prescribedDuration !== null && actualDuration !== null ? actualDuration - prescribedDuration : null,
        pace: foundActivity?.avgPaceSecKm ? formatPace(foundActivity.avgPaceSecKm) : null,
        source: foundActivity ? 'strava' : completionIsDone ? 'manual' : null,
        status,
        activityName: foundActivity?.name ?? null,
        activityType: foundActivity?.type ?? null,
        actualModality: foundActivity ? modalityFromActivity(foundActivity) : null,
        completionStatus: completion?.status ?? null,
        perceivedEffort: completion?.perceivedEffort ?? null,
      };
    });

    const prescribedKm = sum(items.map((item) => item.prescribedDistance));
    const actualKm = sum(items.map((item) => item.actualDistance));
    const prescribedMinutes = sum(items.map((item) => item.prescribedDuration));
    const actualMinutes = sum(items.map((item) => item.actualDuration));
    const asPrescribed = items.filter((item) => item.status === 'as_prescribed').length;
    const sameModalityChanged = items.filter((item) => item.status === 'same_modality_changed_execution').length;
    const different = items.filter((item) => item.status === 'different_modality').length;
    const missed = items.filter((item) => item.status === 'not_done').length;
    const future = items.filter((item) => item.status === 'future').length;
    const eligibleItems = items.filter((item) => item.status !== 'future');
    const eligiblePrescribedKm = sum(eligibleItems.map((item) => item.prescribedDistance));
    const eligiblePrescribedMinutes = sum(eligibleItems.map((item) => item.prescribedDuration));
    const eligibleActualKm = sum(eligibleItems.map((item) => item.actualDistance));
    const eligibleActualMinutes = sum(eligibleItems.map((item) => item.actualDuration));
    const eligibleSessions = eligibleItems.length;
    const executedSessions = asPrescribed + sameModalityChanged + different;
    const summary = {
      prescribedSessions: items.length,
      eligibleSessions,
      asPrescribedSessions: asPrescribed,
      sameModalityChangedSessions: sameModalityChanged,
      differentSessions: different,
      missedSessions: missed,
      futureSessions: future,
      executedSessions,
      executionPercent: eligibleSessions ? Math.round((executedSessions / eligibleSessions) * 100) : 0,
      adherencePercent: eligibleSessions ? Math.round((asPrescribed / eligibleSessions) * 100) : 0,
      prescribedKm,
      actualKm,
      kmDiff: Number((actualKm - prescribedKm).toFixed(2)),
      prescribedMinutes,
      actualMinutes,
      minutesDiff: actualMinutes - prescribedMinutes,
      eligiblePrescribedKm,
      eligibleActualKm,
      eligibleKmDiff: Number((eligibleActualKm - eligiblePrescribedKm).toFixed(2)),
      eligiblePrescribedMinutes,
      eligibleActualMinutes,
      eligibleMinutesDiff: eligibleActualMinutes - eligiblePrescribedMinutes,
    };

    const progression = await this.progressionMetrics(userId);
    const report = {
      summary: {
        ...summary,
        coachAnalysis: buildCoachAnalysis(summary),
        progression,
        analysisAgent: {
          version: 'strava-analysis-v1',
          trigger: context.trigger ?? 'report_request',
          activityId: context.activityId ?? null,
          analyzedAt: new Date().toISOString(),
        },
      },
      items,
    };

    // O resumo e' calculado sob demanda para o PROPRIO aluno e nunca persistido (sem cache de insight Strava).

    return report;
  }

  private async progressionMetrics(userId: string) {
    const now = new Date();
    const currentStart = addDays(now, -28);
    const previousStart = addDays(now, -56);
    const activities = await this.prisma.stravaActivity.findMany({
      where: { userId, startDate: { gte: previousStart } },
      orderBy: { startDate: 'asc' },
    });
    const runs = activities.filter((activity) => modalityFromActivity(activity) === 'corrida');
    const current = aggregateRunPeriod(runs.filter((activity) => activity.startDate >= currentStart));
    const previous = aggregateRunPeriod(runs.filter((activity) => activity.startDate < currentStart));
    const distanceChangePercent = percentChange(current.distanceKm, previous.distanceKm);
    const durationChangePercent = percentChange(current.durationMin, previous.durationMin);
    return {
      last28Days: current,
      previous28Days: previous,
      distanceChangePercent,
      durationChangePercent,
      loadTrend: distanceChangePercent === null ? 'sem_base_anterior' : distanceChangePercent > 10 ? 'aumentando' : distanceChangePercent < -10 ? 'reduzindo' : 'estavel',
    };
  }

  private async shouldAnalyze(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, subscriptionStatus: true },
    });
    return Boolean(user && user.accountStatus === 'active' && ['active', 'manual_active', 'grace'].includes(user.subscriptionStatus));
  }

  // Le um token gravado: cifrado (padrao) ou texto legado (migrado assim que houver chave).
  private readToken(stored: string): string {
    return isEncryptedToken(stored) ? decryptToken(stored, this.tokenKey()) : stored;
  }

  private async getValidConnection(userId: string) {
    const connection = await this.prisma.stravaConnection.findUnique({ where: { userId } });
    if (!connection) {
      throw new BadRequestException('Conecte o Strava primeiro.');
    }
    const key = this.tokenKey();
    let accessToken = this.readToken(connection.accessToken);
    let refreshToken = this.readToken(connection.refreshToken);
    let expiresAt = connection.expiresAt;

    if (expiresAt.getTime() <= Date.now() + 60_000) {
      const refreshed = await this.refreshToken(refreshToken);
      accessToken = refreshed.access_token;
      refreshToken = refreshed.refresh_token;
      expiresAt = new Date(refreshed.expires_at * 1000);
      await this.prisma.stravaConnection.update({
        where: { userId },
        data: { accessToken: encryptToken(accessToken, key), refreshToken: encryptToken(refreshToken, key), expiresAt },
      });
    } else if (!isEncryptedToken(connection.accessToken) || !isEncryptedToken(connection.refreshToken)) {
      await this.prisma.stravaConnection.update({
        where: { userId },
        data: { accessToken: encryptToken(accessToken, key), refreshToken: encryptToken(refreshToken, key) },
      });
    }
    return { userId, athleteId: connection.athleteId, accessToken, refreshToken, expiresAt };
  }

  private async exchangeCode(code: string) {
    return this.tokenRequest({
      client_id: this.requiredConfig('STRAVA_CLIENT_ID'),
      client_secret: this.requiredConfig('STRAVA_CLIENT_SECRET'),
      code,
      grant_type: 'authorization_code',
    });
  }

  private async refreshToken(refreshToken: string) {
    return this.tokenRequest({
      client_id: this.requiredConfig('STRAVA_CLIENT_ID'),
      client_secret: this.requiredConfig('STRAVA_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
  }

  private async tokenRequest(body: Record<string, string>) {
    // A Strava sempre recusou essa troca com "Authorization Error" / recurso "Application"
    // invalido — nunca variando entre diferentes codigos/alunas, mesmo com client_id/secret
    // confirmados corretos e o servico recem-reiniciado (descartando env desatualizada). O corpo
    // ia como JSON; a documentacao da Strava usa form-urlencoded para /oauth/token, e e o mesmo
    // formato que ja funciona na criacao do webhook (ensureWebhookSubscription, via
    // URLSearchParams) — trocado para o mesmo formato aqui.
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      body: new URLSearchParams(body),
    });

    if (!response.ok) {
      this.logger.warn(`Strava recusou a troca de token (status ${response.status}).`);
      throw new BadRequestException('Nao consegui autenticar com o Strava.');
    }

    return (await response.json()) as StravaTokenResponse;
  }

  private async fetchActivities(accessToken: string, after: number) {
    const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new BadRequestException('Nao consegui buscar atividades no Strava.');
    }

    return (await response.json()) as StravaActivityResponse[];
  }

  private async fetchActivity(accessToken: string, activityId: number) {
    const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new BadRequestException('Nao consegui buscar a atividade recebida do Strava.');
    return (await response.json()) as StravaActivityResponse;
  }

  private async saveActivity(userId: string, activity: StravaActivityResponse) {
    const distanceKm = activity.distance ? Number((activity.distance / 1000).toFixed(3)) : null;
    const avgPaceSecKm = distanceKm && activity.moving_time ? Math.round(activity.moving_time / distanceKm) : null;
    await this.prisma.stravaActivity.upsert({
      where: { stravaId: String(activity.id) },
      create: {
        userId,
        stravaId: String(activity.id),
        name: activity.name,
        type: activity.sport_type ?? activity.type,
        startDate: new Date(activity.start_date),
        distanceKm,
        movingTimeSec: activity.moving_time,
        elapsedTimeSec: activity.elapsed_time ?? null,
        avgPaceSecKm,
        avgHeartRate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
        maxHeartRate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
        cadence: activity.average_cadence ? Math.round(activity.average_cadence) : null,
        elevationGainM: activity.total_elevation_gain ?? null,
        raw: toJsonObject(activity),
        fetchedAt: new Date(),
      },
      update: {
        userId,
        name: activity.name,
        type: activity.sport_type ?? activity.type,
        startDate: new Date(activity.start_date),
        distanceKm,
        movingTimeSec: activity.moving_time,
        elapsedTimeSec: activity.elapsed_time ?? null,
        avgPaceSecKm,
        avgHeartRate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
        maxHeartRate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
        cadence: activity.average_cadence ? Math.round(activity.average_cadence) : null,
        elevationGainM: activity.total_elevation_gain ?? null,
        raw: toJsonObject(activity),
        fetchedAt: new Date(),
      },
    });
  }

  private async ensureWebhookSubscription() {
    if (this.webhookReady) return { id: this.webhookSubscriptionId };
    const clientId = this.requiredConfig('STRAVA_CLIENT_ID');
    const clientSecret = this.requiredConfig('STRAVA_CLIENT_SECRET');
    const listUrl = new URL('https://www.strava.com/api/v3/push_subscriptions');
    listUrl.searchParams.set('client_id', clientId);
    listUrl.searchParams.set('client_secret', clientSecret);
    const existingResponse = await fetch(listUrl);
    if (existingResponse.ok) {
      const existing = (await existingResponse.json()) as Array<{ id: number }>;
      if (existing.length > 0) {
        this.webhookReady = true;
        this.webhookSubscriptionId = existing[0].id;
        return existing[0];
      }
    }

    // So' criar uma inscricao exige o verify token (listar a existente nao): sem valor padrao.
    const verifyToken = this.webhookVerifyToken();
    if (!verifyToken) throw new Error('STRAVA_WEBHOOK_VERIFY_TOKEN nao configurado (nao e possivel criar o webhook).');
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      callback_url: `${this.publicApiUrl()}/strava/webhook`,
      verify_token: verifyToken,
    });
    const response = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw new Error(`Strava respondeu ${response.status} ao criar webhook.`);
    const subscription = (await response.json()) as { id?: number };
    this.webhookReady = true;
    this.webhookSubscriptionId = typeof subscription.id === 'number' ? subscription.id : null;
    return subscription;
  }

  private publicApiUrl() {
    const configured = this.config.get<string>('APP_PUBLIC_URL');
    if (configured) return configured.replace(/\/$/, '');
    const redirect = this.requiredConfig('STRAVA_REDIRECT_URI');
    return new URL(redirect).origin;
  }

  // Endereco do app da aluna (PWA), diferente do dominio da API — usado so para trazer a
  // aluna de volta ao app depois que ela autoriza o Strava, ja que o callback do OAuth
  // acontece no dominio da API (STRAVA_REDIRECT_URI), nao no dominio que ela realmente usa.
  studentAppUrl() {
    const configured = this.config.get<string>('STUDENT_APP_URL');
    return configured ? configured.replace(/\/$/, '') : null;
  }

  private requiredConfig(key: string) {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new BadRequestException(`${key} nao configurado.`);
    }
    return value;
  }
}

function parseWebhookEvent(raw: StravaWebhookEventInput) {
  const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (!raw || typeof raw !== 'object') return null;
  if ((raw.object_type !== 'activity' && raw.object_type !== 'athlete')
    || (raw.aspect_type !== 'create' && raw.aspect_type !== 'update' && raw.aspect_type !== 'delete')
    || !isInt(raw.object_id) || !isInt(raw.owner_id) || !isInt(raw.subscription_id) || !isInt(raw.event_time)) return null;
  const updates = raw.updates && typeof raw.updates === 'object' && !Array.isArray(raw.updates) ? raw.updates as Record<string, unknown> : {};
  // Evento de atleta so' faz sentido sobre o proprio dono.
  if (raw.object_type === 'athlete' && raw.object_id !== raw.owner_id) return null;
  return {
    object_type: raw.object_type, aspect_type: raw.aspect_type, object_id: raw.object_id, owner_id: raw.owner_id,
    subscription_id: raw.subscription_id, event_time: raw.event_time, updates,
  };
}

function aggregateRunPeriod(activities: Array<{
  distanceKm: number | null;
  movingTimeSec: number | null;
  avgHeartRate: number | null;
}>) {
  const distanceKm = Number(activities.reduce((total, activity) => total + (activity.distanceKm ?? 0), 0).toFixed(2));
  const movingSeconds = activities.reduce((total, activity) => total + (activity.movingTimeSec ?? 0), 0);
  const heartRates = activities.map((activity) => activity.avgHeartRate).filter((value): value is number => value !== null);
  return {
    sessions: activities.length,
    distanceKm,
    durationMin: Math.round(movingSeconds / 60),
    longestDistanceKm: Number(Math.max(0, ...activities.map((activity) => activity.distanceKm ?? 0)).toFixed(2)),
    averagePaceSecKm: distanceKm > 0 ? Math.round(movingSeconds / distanceKm) : null,
    averagePace: distanceKm > 0 ? formatPace(Math.round(movingSeconds / distanceKm)) : null,
    averageHeartRate: heartRates.length ? Math.round(heartRates.reduce((total, value) => total + value, 0) / heartRates.length) : null,
  };
}

function percentChange(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function sameDay(left: Date, right: Date) {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function activityMatchesSession(activity: { type: string | null; name: string | null }, modality: string) {
  const normalized = `${activity.type ?? ''} ${activity.name ?? ''}`.toLowerCase();
  if (modality === 'bike') {
    return normalized.includes('ride') || normalized.includes('bike');
  }
  if (modality === 'corrida' || modality === 'esteira') {
    return normalized.includes('run');
  }
  if (modality === 'forca' || modality === 'fortalecimento_corredores') {
    return (
      normalized.includes('weight') ||
      normalized.includes('strength') ||
      normalized.includes('workout') ||
      normalized.includes('training') ||
      normalized.includes('treinamento') ||
      normalized.includes('peso') ||
      normalized.includes('musculacao') ||
      normalized.includes('musculação') ||
      normalized.includes('forca') ||
      normalized.includes('força')
    );
  }
  return false;
}

function modalityFromActivity(activity: { type: string | null; name: string | null }) {
  const normalized = `${activity.type ?? ''} ${activity.name ?? ''}`.toLowerCase();
  if (normalized.includes('ride') || normalized.includes('bike')) {
    return 'bike';
  }
  if (normalized.includes('run')) {
    return 'corrida';
  }
  if (
    normalized.includes('weight') ||
    normalized.includes('strength') ||
    normalized.includes('workout') ||
    normalized.includes('training') ||
    normalized.includes('treinamento') ||
    normalized.includes('peso') ||
    normalized.includes('musculacao') ||
    normalized.includes('musculação') ||
    normalized.includes('forca') ||
    normalized.includes('força')
  ) {
    return 'forca';
  }
  return 'outra';
}

function executionMatchesPrescription(input: {
  prescribedDistance: number | null;
  actualDistance: number | null;
  prescribedDuration: number | null;
  actualDuration: number | null;
  modality: string;
}) {
  if (input.modality === 'forca' || input.modality === 'fortalecimento_corredores') {
    return withinTolerance(input.prescribedDuration, input.actualDuration, 12, 0.25);
  }

  const distanceOk = input.prescribedDistance === null || withinTolerance(input.prescribedDistance, input.actualDistance, 0.75, 0.15);
  const durationOk = input.prescribedDuration === null || withinTolerance(input.prescribedDuration, input.actualDuration, 10, 0.2);

  return distanceOk && durationOk;
}

function withinTolerance(prescribed: number | null, actual: number | null, absoluteTolerance: number, relativeTolerance: number) {
  if (prescribed === null || actual === null) {
    return false;
  }
  const allowedDifference = Math.max(absoluteTolerance, Math.abs(prescribed) * relativeTolerance);
  return Math.abs(actual - prescribed) <= allowedDifference;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function sum(values: Array<number | null>) {
  const total = values.reduce<number>((currentTotal, value) => currentTotal + (value ?? 0), 0);
  return Number(total.toFixed(2));
}

function formatDate(date: Date) {
  return `${date.getUTCDate().toString().padStart(2, '0')}/${(date.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}

function formatPace(secondsPerKm: number) {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
}

function toJsonObject(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function buildCoachAnalysis(summary: {
  prescribedSessions: number;
  eligibleSessions: number;
  asPrescribedSessions: number;
  sameModalityChangedSessions: number;
  differentSessions: number;
  missedSessions: number;
  futureSessions: number;
  executedSessions: number;
  executionPercent: number;
  adherencePercent: number;
  prescribedKm: number;
  actualKm: number;
  kmDiff: number;
  prescribedMinutes: number;
  actualMinutes: number;
  minutesDiff: number;
  eligiblePrescribedKm: number;
  eligibleActualKm: number;
  eligibleKmDiff: number;
  eligiblePrescribedMinutes: number;
  eligibleActualMinutes: number;
  eligibleMinutesDiff: number;
}) {
  const notes: string[] = [];

  notes.push(`${summary.asPrescribedSessions} ${plural(summary.asPrescribedSessions, 'treino teve modalidade e execucao conforme a prescricao', 'treinos tiveram modalidade e execucao conforme a prescricao')}.`);
  notes.push(`${summary.sameModalityChangedSessions} ${plural(summary.sameModalityChangedSessions, 'treino manteve a modalidade proposta, mas com execucao diferente', 'treinos mantiveram a modalidade proposta, mas com execucao diferente')}.`);
  notes.push(`${summary.differentSessions} ${plural(summary.differentSessions, 'treino foi realizado em modalidade diferente da proposta', 'treinos foram realizados em modalidade diferente da proposta')}.`);
  notes.push(`${summary.missedSessions} ${plural(summary.missedSessions, 'treino previsto ate agora nao teve registro', 'treinos previstos ate agora nao tiveram registro')}.`);

  if (summary.eligibleKmDiff < -1) {
    notes.push(`Volume registrado ate agora: ${summary.eligibleActualKm} km de ${summary.eligiblePrescribedKm} km planejados.`);
  } else if (summary.eligibleKmDiff > 1) {
    notes.push(`Volume registrado ate agora ficou ${summary.eligibleKmDiff} km acima do planejado.`);
  }

  if (summary.eligibleMinutesDiff < -20) {
    notes.push(`Tempo registrado ate agora: ${summary.eligibleActualMinutes} min de ${summary.eligiblePrescribedMinutes} min planejados.`);
  } else if (summary.eligibleMinutesDiff > 20) {
    notes.push(`Tempo registrado ate agora ficou ${summary.eligibleMinutesDiff} min acima do planejado.`);
  }

  if (summary.futureSessions > 0) {
    notes.push(`${summary.futureSessions} ${plural(summary.futureSessions, 'treino ainda esta', 'treinos ainda estao')} programado(s) para os proximos dias.`);
  }

  return {
    title: 'Leitura da execucao semanal',
    text: notes.join(' '),
  };
}

function plural(count: number, singular: string, pluralText: string) {
  return count === 1 ? singular : pluralText;
}
