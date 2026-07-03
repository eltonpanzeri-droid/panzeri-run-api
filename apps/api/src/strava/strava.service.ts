import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
  average_heartrate?: number;
  max_heartrate?: number;
}

@Injectable()
export class StravaService {
  private readonly logger = new Logger(StravaService.name);
  private webhookReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  connectUrl(userId: string) {
    const clientId = this.config.get<string>('STRAVA_CLIENT_ID');
    const redirectUri = this.config.get<string>('STRAVA_REDIRECT_URI');

    if (!clientId || !redirectUri) {
      throw new BadRequestException('Strava ainda nao configurado no servidor.');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'read,activity:read_all',
      state: userId,
    });

    return {
      url: `https://www.strava.com/oauth/authorize?${params.toString()}`,
    };
  }

  async callback(code: string, state: string) {
    if (!code || !state) {
      throw new BadRequestException('Codigo do Strava invalido.');
    }

    const token = await this.exchangeCode(code);

    await this.prisma.stravaConnection.upsert({
      where: { userId: state },
      create: {
        userId: state,
        athleteId: String(token.athlete.id),
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(token.expires_at * 1000),
      },
      update: {
        athleteId: String(token.athlete.id),
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(token.expires_at * 1000),
      },
    });

    await this.sync(state);
    void this.ensureWebhookSubscription().catch((error: unknown) => {
      this.logger.error(`Nao foi possivel ativar o webhook do Strava: ${error instanceof Error ? error.message : String(error)}`);
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

    return {
      imported: activities.length,
    };
  }

  verifyWebhook(mode: string, challenge: string, verifyToken: string) {
    if (mode !== 'subscribe' || !challenge || verifyToken !== this.webhookVerifyToken()) {
      throw new BadRequestException('Validacao do webhook do Strava recusada.');
    }
    return { 'hub.challenge': challenge };
  }

  async handleWebhook(event: {
    object_type: 'activity' | 'athlete';
    object_id: number;
    aspect_type: 'create' | 'update' | 'delete';
    owner_id: number;
    updates?: Record<string, string | boolean>;
  }) {
    try {
      const connection = await this.prisma.stravaConnection.findFirst({
        where: { athleteId: String(event.owner_id) },
      });
      if (!connection) return;

      if (event.object_type === 'athlete' && (event.updates?.authorized === 'false' || event.updates?.authorized === false)) {
        await this.prisma.$transaction([
          this.prisma.stravaActivity.deleteMany({ where: { userId: connection.userId } }),
          this.prisma.stravaConnection.delete({ where: { userId: connection.userId } }),
        ]);
        return;
      }

      if (event.object_type !== 'activity') return;
      if (event.aspect_type === 'delete') {
        await this.prisma.stravaActivity.deleteMany({ where: { stravaId: String(event.object_id) } });
        return;
      }

      const validConnection = await this.getValidConnection(connection.userId);
      const activity = await this.fetchActivity(validConnection.accessToken, event.object_id);
      await this.saveActivity(connection.userId, activity);
    } catch (error) {
      this.logger.error(`Falha ao processar evento do Strava: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async report(userId: string) {
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

    const report = {
      summary: {
        ...summary,
        coachAnalysis: buildCoachAnalysis(summary),
      },
      items,
    };

    await this.prisma.trainingExecutionInsight.upsert({
      where: { planId: plan.id },
      create: {
        userId,
        planId: plan.id,
        summary: toJsonValue(report.summary),
        items: toJsonValue(items),
      },
      update: {
        summary: toJsonValue(report.summary),
        items: toJsonValue(items),
      },
    });

    return report;
  }

  private async getValidConnection(userId: string) {
    const connection = await this.prisma.stravaConnection.findUnique({ where: { userId } });
    if (!connection) {
      throw new BadRequestException('Conecte o Strava primeiro.');
    }

    if (connection.expiresAt.getTime() > Date.now() + 60_000) {
      return connection;
    }

    const refreshed = await this.refreshToken(connection.refreshToken);
    return this.prisma.stravaConnection.update({
      where: { userId },
      data: {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        expiresAt: new Date(refreshed.expires_at * 1000),
      },
    });
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
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
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
        avgPaceSecKm,
        avgHeartRate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
        maxHeartRate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
        raw: toJsonObject(activity),
      },
      update: {
        userId,
        name: activity.name,
        type: activity.sport_type ?? activity.type,
        startDate: new Date(activity.start_date),
        distanceKm,
        movingTimeSec: activity.moving_time,
        avgPaceSecKm,
        avgHeartRate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
        maxHeartRate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
        raw: toJsonObject(activity),
      },
    });
  }

  private async ensureWebhookSubscription() {
    if (this.webhookReady) return;
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
        return existing[0];
      }
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      callback_url: `${this.publicApiUrl()}/strava/webhook`,
      verify_token: this.webhookVerifyToken(),
    });
    const response = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw new Error(`Strava respondeu ${response.status} ao criar webhook.`);
    const subscription = await response.json();
    this.webhookReady = true;
    return subscription;
  }

  private webhookVerifyToken() {
    return this.config.get<string>('STRAVA_WEBHOOK_VERIFY_TOKEN') ?? 'panzeri-run-strava-webhook-2026';
  }

  private publicApiUrl() {
    const configured = this.config.get<string>('APP_PUBLIC_URL');
    if (configured) return configured.replace(/\/$/, '');
    const redirect = this.requiredConfig('STRAVA_REDIRECT_URI');
    return new URL(redirect).origin;
  }

  private requiredConfig(key: string) {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new BadRequestException(`${key} nao configurado.`);
    }
    return value;
  }
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
    normalized.includes('musculaÃ§Ã£o') ||
    normalized.includes('forca') ||
    normalized.includes('forÃ§a')
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
