import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { EventOutcome } from '../provider-hub/provider-connector';
import { GARMIN_PROVIDER_ID } from './garmin.connector';
import { GARMIN_FIT_MAX_BYTES, GarminFileNotice, GarminFitError, GarminFitExtras, isGarminCallbackUrl, readGarminFit } from './garmin-fit';

// Processa o aviso de arquivo FIT da Garmin (09/11/2026). Ordem pensada para NAO gastar o download unico (24 h, o segundo recebe 410):
//  1. confere conexao e autorizacao ('activity' + 'activity_sensors': dinamica de corrida e metricas por volta sao dados de sensores);
//  2. SO' ENTAO exige que a atividade ja' exista (os detalhes em JSON chegam por outro push; se ainda nao chegaram, tenta de novo mais tarde SEM baixar);
//  3. baixa (fora de qualquer transacao de banco), le e grava o resumo em ActivityLog.providerMetrics.garmin.fit; o arquivo e' descartado.
// Idempotente: gravar de novo o mesmo arquivo so' substitui o mesmo resumo.
const DOWNLOAD_TIMEOUT_MS = 20_000;

@Injectable()
export class GarminFitService {
  private readonly logger = new Logger(GarminFitService.name);

  constructor(private readonly prisma: PrismaService, private readonly consent: ProviderConsentService) {}

  // Separado para os testes poderem trocar a rede. Nunca registra o endereco (carrega um token).
  protected async download(url: string): Promise<{ status: number; body: Buffer | null }> {
    const response = await fetch(url, { headers: { Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'error' });
    if (!response.ok) return { status: response.status, body: null };
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > GARMIN_FIT_MAX_BYTES) return { status: 413, body: null };
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, body };
  }

  async handle(userId: string, notice: Partial<GarminFileNotice> | null): Promise<EventOutcome> {
    if (!notice || notice.fileType !== 'FIT' || typeof notice.activityId !== 'string' || !isGarminCallbackUrl(notice.callbackURL)) return { status: 'discard', reason: 'aviso de arquivo invalido' };
    const snapshot = await this.consent.snapshot(GARMIN_PROVIDER_ID, userId);
    if (!snapshot) return { status: 'discard', reason: 'conexao encerrada' };
    if (!snapshot.categories.includes('activity') || !snapshot.categories.includes('activity_sensors')) return { status: 'discard', reason: 'categoria nao autorizada pela aluna' };
    const log = await this.prisma.activityLog.findUnique({ where: { provider_userId_externalId: { provider: GARMIN_PROVIDER_ID, userId, externalId: notice.activityId } }, select: { id: true } });
    if (!log) return { status: 'retry', reason: 'a atividade ainda nao chegou (detalhes em JSON); o arquivo sera baixado depois' };

    let downloaded: { status: number; body: Buffer | null };
    try {
      downloaded = await this.download(notice.callbackURL);
    } catch (error) {
      return { status: 'retry', reason: `falha de rede ao baixar o arquivo: ${error instanceof Error ? error.name : 'erro'}` };
    }
    if (downloaded.status === 410) return { status: 'discard', reason: 'arquivo ja baixado ou expirado (24 h, download unico)' };
    if (!downloaded.body) return downloaded.status >= 500 || downloaded.status === 429 ? { status: 'retry', reason: `Garmin respondeu ${downloaded.status}` } : { status: 'discard', reason: `Garmin respondeu ${downloaded.status}` };

    let extras: GarminFitExtras;
    try {
      extras = await readGarminFit(downloaded.body);
    } catch (error) {
      // Arquivo ilegivel nao melhora com nova tentativa (e o download ja' foi gasto).
      if (error instanceof GarminFitError) return { status: 'discard', reason: `${error.code}: ${error.message}`.slice(0, 200) };
      throw error;
    }
    const written = await this.consent.writeWhileAuthorized(GARMIN_PROVIDER_ID, userId, async (tx, granted) => {
      if (!granted.categories.includes('activity') || !granted.categories.includes('activity_sensors')) return false;
      const current = await tx.activityLog.findUnique({ where: { id: log.id }, select: { providerMetrics: true } });
      const base = current?.providerMetrics && typeof current.providerMetrics === 'object' && !Array.isArray(current.providerMetrics) ? (current.providerMetrics as Record<string, unknown>) : {};
      const garmin = base.garmin && typeof base.garmin === 'object' && !Array.isArray(base.garmin) ? (base.garmin as Record<string, unknown>) : {};
      const providerMetrics = { ...base, garmin: { ...garmin, fit: { laps: extras.laps, runningDynamics: extras.dynamics, readAt: new Date().toISOString() } } };
      await tx.activityLog.update({ where: { id: log.id }, data: { providerMetrics: providerMetrics as unknown as Prisma.InputJsonValue } });
      return true;
    });
    if (!written) return { status: 'discard', reason: 'conexao encerrada ou categoria retirada durante o processamento' };
    this.logger.log(`Arquivo FIT da Garmin lido (atividade ${log.id}): ${extras.laps.length} volta(s)${extras.dynamics ? ', com dinamica de corrida' : ''}.`);
    return { status: 'done' };
  }
}
