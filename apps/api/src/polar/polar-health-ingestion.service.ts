import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolarService } from './polar.service';
import { grantedPolarHealthCategories, POLAR_HEALTH_PROVIDER_ID, POLAR_WEARABLE_PROVIDER, type PolarHealthCategory, type PolarHealthRow } from './polar-health-consent';
import { extractPolarList, mapPolarDailyActivity, mapPolarNightlyRecharge, mapPolarSleep } from './polar-health-mapper';

const ACCESSLINK_BASE = 'https://www.polaraccesslink.com';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CONNECTIONS_PER_RUN = 50;
const STALE_AFTER_MS = 60 * 60_000;

export type PolarHealthSyncStatus = 'synced' | 'no_consent' | 'not_connected' | 'disabled' | 'in_progress' | 'token_invalid' | 'rate_limited';
export interface PolarHealthSyncResult {
  status: PolarHealthSyncStatus;
  // Por categoria: HTTP da Polar (0 = falha de rede), registros gravados e ignorados (formato inesperado/sem dado). Nunca ha valores de saude aqui.
  categories: Partial<Record<PolarHealthCategory, { httpStatus: number; written: number; skipped: number }>>;
}

const json = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue));

// Importacao de saude e recuperacao da Polar (23/10/2026) -> WearableSleepSummary / WearableHrvSummary / WearableDailySummary (provider 'polar'). Reaproveita as tabelas e a regra das demais fontes:
// so' grava com a categoria autorizada pela aluna (reconferida DENTRO da transacao, com a linha da autorizacao travada), nunca estima, preserva a origem. Nao toca no fluxo de exercicios.
// LIGADO por POLAR_HEALTH_ENABLED=true (padrao: desligado) — ativar so' depois do diagnostico administrativo.
@Injectable()
export class PolarHealthIngestionService {
  private readonly logger = new Logger(PolarHealthIngestionService.name);
  private readonly inFlight = new Set<string>();

  constructor(private readonly prisma: PrismaService, private readonly polar: PolarService) {}

  enabled(env: Record<string, string | undefined> = process.env): boolean {
    return (env.POLAR_HEALTH_ENABLED ?? '').trim().toLowerCase() === 'true';
  }

  private async get(path: string, token: string): Promise<{ status: number; body: unknown }> {
    try {
      const response = await fetch(`${ACCESSLINK_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.status === 200) return { status: 200, body: await response.json().catch(() => null) };
      return { status: response.status, body: null };
    } catch {
      return { status: 0, body: null };
    }
  }

  // Escrita com a linha da autorizacao TRAVADA em modo compartilhado: a retirada de um grupo espera a escrita terminar e uma escrita que comece depois dela nao encontra o grupo.
  private async writeWhileAuthorized<T>(userId: string, write: (tx: Prisma.TransactionClient, granted: PolarHealthCategory[]) => Promise<T>): Promise<T | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<PolarHealthRow>>`SELECT "disconnectedAt", "grantedCategories", "consentVersion", "consentTextHash" FROM "ProviderConnection" WHERE "provider" = ${POLAR_HEALTH_PROVIDER_ID} AND "userId" = ${userId} FOR SHARE`;
      const granted = grantedPolarHealthCategories(rows[0] ?? null);
      if (granted.length === 0) return null;
      const connection = await tx.polarConnection.findUnique({ where: { userId }, select: { disconnectedAt: true } });
      if (!connection || connection.disconnectedAt) return null;
      return write(tx, granted);
    }, { timeout: 60_000 });
  }

  async sync(userId: string): Promise<PolarHealthSyncResult> {
    const empty = (status: PolarHealthSyncStatus): PolarHealthSyncResult => ({ status, categories: {} });
    if (!this.enabled()) return empty('disabled');
    if (this.inFlight.has(userId)) return empty('in_progress');
    this.inFlight.add(userId);
    try {
      const connection = await this.prisma.polarConnection.findUnique({ where: { userId }, select: { disconnectedAt: true, accessTokenEncrypted: true } });
      if (!connection || connection.disconnectedAt || !connection.accessTokenEncrypted) return empty('not_connected');
      const consent = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider: POLAR_HEALTH_PROVIDER_ID, userId } }, select: { disconnectedAt: true, grantedCategories: true, consentVersion: true, consentTextHash: true } });
      const categories = grantedPolarHealthCategories(consent as PolarHealthRow | null);
      if (categories.length === 0) return empty('no_consent');
      const token = this.polar.decryptAccessToken(connection.accessTokenEncrypted);

      const result: PolarHealthSyncResult = { status: 'synced', categories: {} };
      const plan: Array<{ category: PolarHealthCategory; path: string; keys: string[] }> = [
        { category: 'sleep', path: '/v3/users/sleep', keys: ['nights', 'sleep'] },
        { category: 'hrv', path: '/v3/users/nightly-recharge', keys: ['recharges', 'nightly_recharges', 'nightly-recharge'] },
        { category: 'daily_activity', path: '/v3/users/activities', keys: ['activities', 'activity-log'] },
      ];
      for (const step of plan.filter((p) => categories.includes(p.category))) {
        const { status, body } = await this.get(step.path, token);
        if (status === 429) { result.categories[step.category] = { httpStatus: status, written: 0, skipped: 0 }; result.status = 'rate_limited'; break; }
        if (status === 401) { result.categories[step.category] = { httpStatus: status, written: 0, skipped: 0 }; result.status = 'token_invalid'; break; }
        if (status !== 200) { result.categories[step.category] = { httpStatus: status, written: 0, skipped: 0 }; continue; } // 204/404 = nada novo; 403/outros: registrado, sem erro
        const items = extractPolarList(body, step.keys);
        const stats = await this.write(userId, step.category, items);
        result.categories[step.category] = { httpStatus: status, written: stats.written, skipped: stats.skipped };
      }
      if (result.status === 'synced') {
        await this.prisma.providerConnection.updateMany({ where: { provider: POLAR_HEALTH_PROVIDER_ID, userId, disconnectedAt: null }, data: { lastSyncCompletedAt: new Date() } });
      }
      return result;
    } finally {
      this.inFlight.delete(userId);
    }
  }

  private async write(userId: string, category: PolarHealthCategory, items: unknown[]): Promise<{ written: number; skipped: number }> {
    let written = 0; let skipped = 0;
    for (const item of items) {
      try {
        const ok = await this.writeWhileAuthorized(userId, async (tx, granted) => {
          if (!granted.includes(category)) return false; // retirado no meio do processamento
          const provider = POLAR_WEARABLE_PROVIDER;
          if (category === 'sleep') {
            const m = mapPolarSleep(item);
            if (!m) return null;
            const { calendarDate, startTimeSec, ...rest } = m;
            const data = { ...rest, levels: json(rest.levels), sleepScores: json(rest.sleepScores) };
            // A Polar pode recalcular a noite (outro horario de inicio): a versao nova SUBSTITUI a anterior da mesma fonte e data, para nao duplicar a noite.
            await tx.wearableSleepSummary.deleteMany({ where: { userId, provider, calendarDate, NOT: { startTimeSec } } });
            await tx.wearableSleepSummary.upsert({ where: { userId_provider_calendarDate_startTimeSec: { userId, provider, calendarDate, startTimeSec } }, create: { userId, provider, calendarDate, startTimeSec, ...data }, update: data });
            return true;
          }
          if (category === 'hrv') {
            const m = mapPolarNightlyRecharge(item);
            if (!m) return null;
            const { calendarDate, startTimeSec, ...rest } = m;
            const data = { ...rest, hrvValues: json(rest.hrvValues) };
            await tx.wearableHrvSummary.upsert({ where: { userId_provider_calendarDate_startTimeSec: { userId, provider, calendarDate, startTimeSec } }, create: { userId, provider, calendarDate, startTimeSec, ...data }, update: data });
            return true;
          }
          const m = mapPolarDailyActivity(item);
          if (!m) return null;
          const { calendarDate, startTimeSec, ...data } = m;
          await tx.wearableDailySummary.upsert({ where: { userId_provider_calendarDate_startTimeSec: { userId, provider, calendarDate, startTimeSec } }, create: { userId, provider, calendarDate, startTimeSec, ...data }, update: data });
          return true;
        });
        if (ok === true) written += 1;
        else if (ok === null || ok === false) skipped += 1;
      } catch (error) {
        skipped += 1;
        this.logger.warn(`Registro de saude Polar ignorado (${category}): ${error instanceof Error ? error.message.slice(0, 100) : 'erro'}`);
      }
    }
    return { written, skipped };
  }

  // Rotina periodica (chamada pelo agendador da Polar): so' alunas com autorizacao ativa cuja ultima importacao de saude e' antiga. Nada roda com POLAR_HEALTH_ENABLED desligado.
  async syncStale(now: Date = new Date()): Promise<{ eligible: number; synced: number; failed: number }> {
    if (!this.enabled()) return { eligible: 0, synced: 0, failed: 0 };
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
    const rows = await this.prisma.providerConnection.findMany({
      where: { provider: POLAR_HEALTH_PROVIDER_ID, disconnectedAt: null, OR: [{ lastSyncCompletedAt: null }, { lastSyncCompletedAt: { lt: cutoff } }] },
      // Mais antigas primeiro (nunca sincronizadas na frente): linhas inelegiveis nao ocupam o lote para sempre.
      orderBy: { lastSyncCompletedAt: { sort: 'asc', nulls: 'first' } },
      select: { userId: true }, take: MAX_CONNECTIONS_PER_RUN,
    });
    let synced = 0; let failed = 0;
    for (const { userId } of rows) {
      try {
        const r = await this.sync(userId);
        if (r.status === 'synced') synced += 1;
        else if (r.status === 'rate_limited') { failed += 1; break; }
        else if (r.status === 'no_consent' || r.status === 'not_connected') {
          // Inelegivel agora (texto desatualizado ou Polar desconectada): marca a verificacao para a linha girar e nao ocupar o lote.
          await this.prisma.providerConnection.updateMany({ where: { provider: POLAR_HEALTH_PROVIDER_ID, userId }, data: { lastSyncCompletedAt: now } });
        }
      }
      catch (error) { failed += 1; this.logger.warn(`Importacao de saude Polar falhou: ${error instanceof Error ? error.message.slice(0, 100) : 'erro'}`); }
    }
    return { eligible: rows.length, synced, failed };
  }
}
