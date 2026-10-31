import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderConnectionService } from '../provider-hub/provider-connection.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { SyncCapability } from '../provider-hub/provider-connector';
import { readZeppFit, ZeppFitError } from '../zepp/zepp-fit';
import { COROS_PROVIDER_ID } from './coros.connector';
import { CorosMcpClient, CorosMcpError } from './coros-mcp-client';
import { CorosFitDownloader } from './coros-fit-downloader';
import { CorosActivityIngestionService } from './coros-activity-ingestion.service';
import { isFitLimitMessage, parseSportRecords, ymd } from './coros-sport-records';

// Importacao de atividades da COROS por CONSULTA periodica (30/10/2026). A COROS so' tem webhook na Partner API (em analise), entao: a cada 30 minutos (e por pedido da aluna) cada conexao
// com a categoria "Atividades" lista as atividades recentes (querySportRecords), obtem o link do arquivo FIT de cada uma que ainda nao foi importada (queryActivityFitFileDownloadUrls) e grava pelo
// pipeline existente. Regras:
//  - so' com a conexao ativa E a categoria `activity` autorizada; nada anterior a `collectFrom` (periodo autorizado), exceto os ultimos 30 dias se a aluna deu `history_backfill`;
//  - o limite da COROS e' de 50 arquivos por usuario a cada 24 h (compartilhado entre download e links): no maximo MAX_PER_RUN por rodada e, ao receber erro de limite, para e deixa o resto
//    para a proxima rodada (nada e' marcado como importado sem ter sido gravado);
//  - idempotente: a chave e' o labelId; atividade ja' gravada nao baixa o arquivo de novo; uma rodada por aluna por vez; falha de uma atividade nao derruba as demais;
//  - desligada ate COROS_SYNC_ENABLED=true.
export const MAX_PER_RUN = 10;
export const BACKFILL_DAYS = 30;
export const DEFAULT_LOOKBACK_DAYS = 3;
const DAY_MS = 86_400_000;

export type CorosSyncStatus = 'ok' | 'in_progress' | 'rate_limited' | 'not_connected' | 'disabled' | 'failed';
export interface CorosSyncResult { status: CorosSyncStatus; imported: number; pending: number; failed: number }

@Injectable()
export class CorosSyncService implements SyncCapability {
  private readonly logger = new Logger(CorosSyncService.name);
  private readonly inFlight = new Set<string>();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ProviderConsentService,
    private readonly connections: ProviderConnectionService,
    private readonly client: CorosMcpClient,
    private readonly downloader: CorosFitDownloader,
    private readonly ingestion: CorosActivityIngestionService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>('COROS_SYNC_ENABLED')?.trim().toLowerCase() === 'true';
  }

  async sync(input: { userId: string }): Promise<{ status: 'ok' | 'in_progress' | 'rate_limited' | 'not_connected'; imported?: number }> {
    const result = await this.run(input.userId);
    const status = result.status === 'disabled' || result.status === 'failed' ? 'not_connected' : result.status;
    return { status, imported: result.imported };
  }

  async run(userId: string, now: Date = new Date()): Promise<CorosSyncResult> {
    const empty = (status: CorosSyncStatus): CorosSyncResult => ({ status, imported: 0, pending: 0, failed: 0 });
    if (!this.isEnabled()) return empty('disabled');
    if (this.inFlight.has(userId)) return empty('in_progress');
    this.inFlight.add(userId);
    try {
      const snapshot = await this.consent.snapshot(COROS_PROVIDER_ID, userId);
      if (!snapshot || !snapshot.categories.includes('activity')) return empty('not_connected');
      const connection = await this.connections.syncState(COROS_PROVIDER_ID, userId);
      if (!connection.connected) return empty('not_connected');

      // janela: do ultimo ciclo completo (com folga de 2 dias para atividade que sobe tarde do relogio) ou, na primeira vez, o periodo que a aluna autorizou
      const backfill = snapshot.purposes.includes('history_backfill');
      const authorizedFrom = snapshot.collectFrom ?? new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * DAY_MS);
      const floor = backfill ? new Date(now.getTime() - BACKFILL_DAYS * DAY_MS) : authorizedFrom;
      const firstFrom = backfill ? floor : authorizedFrom;
      const from = connection.lastSyncCompletedAt ? new Date(connection.lastSyncCompletedAt.getTime() - 2 * DAY_MS) : firstFrom;
      const start = new Date(Math.max(from.getTime(), floor.getTime()));

      let token: string;
      try { token = await this.connections.getAccessToken(COROS_PROVIDER_ID, userId, 'activity'); } catch { return empty('failed'); }

      let listText: string;
      try {
        listText = await this.client.callTool(token, 'querySportRecords', { startDate: ymd(start), endDate: ymd(now), limit: 100 });
      } catch (error) {
        return this.failure(error, empty);
      }
      const records = parseSportRecords(listText)
        .filter((record) => record.startTimestamp === null || record.startTimestamp * 1000 >= start.getTime() - DAY_MS)
        .sort((a, b) => (a.startTimestamp ?? 0) - (b.startTimestamp ?? 0));

      const known = await this.prisma.activityLog.findMany({ where: { userId, provider: COROS_PROVIDER_ID, externalId: { in: records.map((r) => r.labelId) } }, select: { externalId: true } });
      const knownIds = new Set(known.map((row) => row.externalId));
      const todo = records.filter((record) => !knownIds.has(record.labelId));

      let imported = 0;
      let failed = 0;
      let rateLimited = false;
      for (const record of todo.slice(0, MAX_PER_RUN)) {
        try {
          const urls = await this.client.callTool(token, 'queryActivityFitFileDownloadUrls', { labelId: record.labelId, sportType: record.sportType, limit: 1 });
          const downloaded = await this.downloader.download(urls);
          if (!downloaded.ok) { failed += 1; this.logger.warn(`Download do FIT da COROS falhou (${downloaded.kind}).`); continue; }
          const fit = await readZeppFit(downloaded.buffer);
          const outcome = await this.ingestion.ingest(userId, { labelId: record.labelId, sportType: record.sportType, source: 'sync' }, fit);
          if (outcome.written) imported += 1;
        } catch (error) {
          if (error instanceof CorosMcpError && (error.kind === 'rate_limited' || (error.kind === 'tool_error' && isFitLimitMessage(error.message)))) { rateLimited = true; break; }
          if (error instanceof CorosMcpError && error.kind === 'auth') return this.failure(error, empty);
          failed += 1;
          this.logger.warn(`Atividade COROS nao importada (${error instanceof ZeppFitError ? 'arquivo FIT invalido' : error instanceof Error ? error.name : 'erro'}).`);
        }
      }
      const pending = Math.max(0, todo.length - imported - failed);
      // So' avanca a janela quando nada ficou para tras (limite, falha ou excedente da rodada): assim a proxima rodada retoma do mesmo ponto.
      if (!rateLimited && failed === 0 && todo.length <= MAX_PER_RUN) {
        await this.connections.markSyncCompleted(COROS_PROVIDER_ID, userId, now).catch(() => undefined);
      }
      return { status: rateLimited ? 'rate_limited' : 'ok', imported, pending, failed };
    } finally {
      this.inFlight.delete(userId);
    }
  }

  private failure(error: unknown, empty: (status: CorosSyncStatus) => CorosSyncResult): CorosSyncResult {
    if (error instanceof CorosMcpError && error.kind === 'rate_limited') return empty('rate_limited');
    this.logger.warn(`Sincronizacao COROS falhou (${error instanceof CorosMcpError ? error.kind : 'erro'}) para um aluno.`);
    return empty('failed');
  }

  // Rede de seguranca: a cada 30 minutos, uma aluna por vez, para quem tem a conexao ativa com a categoria "Atividades".
  @Cron(CronExpression.EVERY_30_MINUTES)
  async syncAll() {
    if (!this.isEnabled() || this.running) return;
    this.running = true;
    try {
      const userIds = await this.connections.connectedUserIds(COROS_PROVIDER_ID);
      let imported = 0;
      for (const userId of userIds) {
        try { imported += (await this.run(userId)).imported; } catch (error) { this.logger.warn(`Sincronizacao COROS falhou para um aluno: ${(error as Error).message}`); }
      }
      if (imported > 0) this.logger.log(`COROS: ${userIds.length} aluno(s) verificado(s), ${imported} atividade(s) importada(s).`);
    } catch (error) {
      this.logger.warn(`Falha na rotina de sincronizacao da COROS: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
