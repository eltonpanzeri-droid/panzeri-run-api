import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CorosMcpClient, CorosMcpError } from './coros-mcp-client';
import { dayAnchorSec, parseDailyHealth, parseRestingHeartRate, parseSleepHrv, parseSleepOverview } from './coros-health-records';

// Importacao de SAUDE da COROS (sono, HRV, FC de repouso, atividade diaria) por consulta (30/10/2026). Mesmas tabelas Wearable* da Zepp, com provider 'coros'. So' grava o que a aluna autorizou
// por categoria (sleep, hrv, daily_activity, resting_heart_rate); consulta os ultimos 7 dias (limite das ferramentas) e e' idempotente (upsert pela chave natural). Uma consulta por aluna a cada
// HEALTH_MIN_INTERVAL_MS no maximo (os dados de saude mudam devagar). Ver os avisos de "nao validado com dados reais" em coros-health-records.ts.
export const COROS_WEARABLE_PROVIDER = 'coros';
export const COROS_HEALTH_CATEGORIES = ['sleep', 'hrv', 'daily_activity', 'resting_heart_rate'] as const;
export const HEALTH_MIN_INTERVAL_MS = 3 * 3_600_000;
const HEALTH_DAYS = 7;

export interface CorosHealthResult { sleep: number; hrv: number; daily: number; skipped: number; ran: boolean }

@Injectable()
export class CorosHealthSyncService {
  private readonly logger = new Logger(CorosHealthSyncService.name);
  private readonly lastRunAt = new Map<string, number>();

  constructor(private readonly prisma: PrismaService, private readonly client: CorosMcpClient) {}

  async run(userId: string, token: string, categories: readonly string[], now: Date = new Date(), force = false): Promise<CorosHealthResult> {
    const result: CorosHealthResult = { sleep: 0, hrv: 0, daily: 0, skipped: 0, ran: false };
    const wantSleep = categories.includes('sleep');
    const wantHrv = categories.includes('hrv');
    const wantDaily = categories.includes('daily_activity');
    const wantResting = categories.includes('resting_heart_rate');
    if (!wantSleep && !wantHrv && !wantDaily && !wantResting) return result;
    const last = this.lastRunAt.get(userId);
    if (!force && last !== undefined && now.getTime() - last < HEALTH_MIN_INTERVAL_MS) return result;
    this.lastRunAt.set(userId, now.getTime());
    result.ran = true;

    const call = async (tool: string): Promise<string | null> => {
      try {
        return await this.client.callTool(token, tool, { days: HEALTH_DAYS });
      } catch (error) {
        // Falha de uma consulta nao derruba as demais; erro de autenticacao e' tratado pela rotina de atividades.
        this.logger.warn(`COROS ${tool} falhou (${error instanceof CorosMcpError ? error.kind : 'erro'}) para um aluno.`);
        return null;
      }
    };

    if (wantSleep) {
      const text = await call('querySleepOverview');
      for (const night of text ? parseSleepOverview(text) : []) {
        if (night.startTimeSec === null || night.startOffsetSec === null) { result.skipped += 1; this.logger.warn('COROS sono: noite sem horario absoluto na resposta; nao gravada (nunca estimada).'); continue; }
        const data = {
          startOffsetSec: night.startOffsetSec, durationSec: night.durationSec, deepSleepSec: night.deepSleepSec, lightSleepSec: night.lightSleepSec, remSleepSec: night.remSleepSec, awakeSec: night.awakeSec,
          scoreValue: night.scoreValue, endTimeSec: night.endTimeSec, providerSummaryId: `coros|sleep|${night.calendarDate}`,
        };
        await this.prisma.$transaction([
          this.prisma.wearableSleepSummary.deleteMany({ where: { userId, provider: COROS_WEARABLE_PROVIDER, calendarDate: night.calendarDate, NOT: { startTimeSec: night.startTimeSec } } }),
          this.prisma.wearableSleepSummary.upsert({
            where: { userId_provider_calendarDate_startTimeSec: { userId, provider: COROS_WEARABLE_PROVIDER, calendarDate: night.calendarDate, startTimeSec: night.startTimeSec } },
            create: { userId, provider: COROS_WEARABLE_PROVIDER, calendarDate: night.calendarDate, startTimeSec: night.startTimeSec, ...data },
            update: data,
          }),
        ]);
        result.sleep += 1;
      }
    }

    if (wantHrv) {
      const text = await call('querySleepHrv');
      for (const day of text ? parseSleepHrv(text) : []) {
        const startTimeSec = dayAnchorSec(day.calendarDate);
        const data = { startOffsetSec: 0, lastNightAvg: day.averageMs, providerSummaryId: `coros|hrv|${day.calendarDate}` };
        await this.prisma.wearableHrvSummary.upsert({
          where: { userId_provider_calendarDate_startTimeSec: { userId, provider: COROS_WEARABLE_PROVIDER, calendarDate: day.calendarDate, startTimeSec } },
          create: { userId, provider: COROS_WEARABLE_PROVIDER, calendarDate: day.calendarDate, startTimeSec, ...data },
          update: data,
        });
        result.hrv += 1;
      }
    }

    if (wantDaily || wantResting) {
      const merged = new Map<string, { steps: number | null; distanceMeters: number | null; resting: number | null }>();
      if (wantDaily) {
        const text = await call('queryDailyHealthData');
        for (const day of text ? parseDailyHealth(text) : []) merged.set(day.calendarDate, { steps: day.steps, distanceMeters: day.distanceMeters, resting: null });
      }
      if (wantResting) {
        const text = await call('queryRestingHeartRate');
        for (const day of text ? parseRestingHeartRate(text) : []) {
          const current = merged.get(day.calendarDate) ?? { steps: null, distanceMeters: null, resting: null };
          merged.set(day.calendarDate, { ...current, resting: day.bpm });
        }
      }
      for (const [calendarDate, day] of merged) {
        if (day.steps === null && day.distanceMeters === null && day.resting === null) continue;
        const startTimeSec = dayAnchorSec(calendarDate);
        // Cada campo so' e' gravado se a categoria dele foi autorizada (atividade diaria x FC de repouso sao autorizacoes independentes).
        const data = {
          startOffsetSec: 0, providerSummaryId: `coros|daily|${calendarDate}`,
          steps: wantDaily ? day.steps : null, distanceMeters: wantDaily ? day.distanceMeters : null, restingHeartRateBpm: wantResting ? day.resting : null,
        };
        await this.prisma.wearableDailySummary.upsert({
          where: { userId_provider_calendarDate_startTimeSec: { userId, provider: COROS_WEARABLE_PROVIDER, calendarDate, startTimeSec } },
          create: { userId, provider: COROS_WEARABLE_PROVIDER, calendarDate, startTimeSec, ...data },
          update: data,
        });
        result.daily += 1;
      }
    }
    return result;
  }
}
