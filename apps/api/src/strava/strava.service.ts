import { BadRequestException, Injectable } from '@nestjs/common';
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

    return 'Strava conectado ao Panzeri Run. Pode voltar ao app.';
  }

  async sync(userId: string) {
    const connection = await this.getValidConnection(userId);
    const after = Math.floor(addDays(new Date(), -90).getTime() / 1000);
    const activities = await this.fetchActivities(connection.accessToken, after);

    for (const activity of activities) {
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

    return {
      imported: activities.length,
    };
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
      const status = activity
        ? 'matched_strava'
        : alternateActivity
          ? 'different_strava'
          : completionIsDone
            ? 'matched_manual'
            : completion?.status === 'missed'
              ? 'missed'
              : isFutureSession
                ? 'future'
                : 'not_found';

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
    const matched = items.filter((item) => item.status === 'matched_strava' || item.status === 'matched_manual').length;
    const different = items.filter((item) => item.status === 'different_strava').length;
    const missed = items.filter((item) => item.status === 'missed' || item.status === 'not_found').length;
    const summary = {
      prescribedSessions: items.length,
      matchedSessions: matched,
      differentSessions: different,
      missedSessions: missed,
      adherencePercent: items.length ? Math.round((matched / items.length) * 100) : 0,
      prescribedKm,
      actualKm,
      kmDiff: Number((actualKm - prescribedKm).toFixed(2)),
      prescribedMinutes,
      actualMinutes,
      minutesDiff: actualMinutes - prescribedMinutes,
    };

    return {
      summary: {
        ...summary,
        coachAnalysis: buildCoachAnalysis(summary),
      },
      items,
    };
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

function buildCoachAnalysis(summary: {
  prescribedSessions: number;
  matchedSessions: number;
  differentSessions: number;
  missedSessions: number;
  adherencePercent: number;
  prescribedKm: number;
  actualKm: number;
  kmDiff: number;
  prescribedMinutes: number;
  actualMinutes: number;
  minutesDiff: number;
}) {
  const notes: string[] = [];

  if (summary.adherencePercent >= 80) {
    notes.push('Boa aderencia aos treinos propostos.');
  } else if (summary.adherencePercent >= 50) {
    notes.push('Aderencia parcial: parte importante da semana foi executada, mas ainda houve perdas.');
  } else {
    notes.push('Aderencia baixa aos treinos propostos nesta semana.');
  }

  if (summary.differentSessions > 0) {
    notes.push(`${summary.differentSessions} treino(s) tiveram atividade diferente da prescrita.`);
  }

  if (summary.missedSessions > 0) {
    notes.push(`${summary.missedSessions} treino(s) ficaram sem registro encontrado.`);
  }

  if (summary.kmDiff < -1) {
    notes.push(`Volume de corrida ficou ${Math.abs(summary.kmDiff)} km abaixo do planejado.`);
  } else if (summary.kmDiff > 1) {
    notes.push(`Volume de corrida ficou ${summary.kmDiff} km acima do planejado.`);
  }

  if (summary.minutesDiff < -20) {
    notes.push(`Tempo total ficou ${Math.abs(summary.minutesDiff)} min abaixo do planejado.`);
  } else if (summary.minutesDiff > 20) {
    notes.push(`Tempo total ficou ${summary.minutesDiff} min acima do planejado.`);
  }

  return {
    title: summary.adherencePercent >= 80 ? 'Semana bem executada' : summary.adherencePercent >= 50 ? 'Semana parcialmente executada' : 'Semana abaixo do planejado',
    text: notes.join(' '),
  };
}
