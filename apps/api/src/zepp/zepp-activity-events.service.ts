import { Injectable, Logger } from '@nestjs/common';
import { EventOutcome, EventProcessingCapability, InboundEventView } from '../provider-hub/provider-connector';
import { ProviderConnectionService } from '../provider-hub/provider-connection.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { ZEPP_PROVIDER_ID } from './zepp.connector';
import { ZeppFitDownloader } from './zepp-fit-downloader';
import { readZeppFit, ZeppFitError } from './zepp-fit';
import { ZeppActivityIngestionService } from './zepp-activity-ingestion.service';
import { isAllowedCallbackUrl } from './zepp-webhook';

// Processador dos eventos da Zepp na fila duravel (Lote 3). A fila ja' garante: idempotencia por chave, reivindicacao com trava, espera crescente, limite de
// tentativas e o descarte de eventos de aluno sem conexao/categoria autorizada ANTES de chegar aqui. Este servico faz o resto:
//   authorization_change (delete) -> encerra a conexao local (a Zepp ja' revogou; nada e' enviado de volta);
//   activity_file -> revalida consentimento e periodo autorizado, baixa o FIT com o token do aluno, le, filtra por campo e grava no pipeline.
// Desfechos: 'discard' = nunca vai virar dado (sem autorizacao, atividade manual, antes do periodo autorizado, arquivo invalido/expirado); 'retry' = falha transitoria.
const FUTURE_TOLERANCE_MS = 36 * 3_600_000;

@Injectable()
export class ZeppActivityEventService implements EventProcessingCapability {
  private readonly logger = new Logger(ZeppActivityEventService.name);

  constructor(
    private readonly consent: ProviderConsentService,
    private readonly connections: ProviderConnectionService,
    private readonly downloader: ZeppFitDownloader,
    private readonly ingestion: ZeppActivityIngestionService,
  ) {}

  async handle(event: InboundEventView): Promise<EventOutcome> {
    if (event.eventType === 'authorization_change') return this.handleAuthorizationChange(event);
    if (event.eventType === 'activity_file') return this.handleActivityFile(event);
    return { status: 'discard', reason: 'tipo de evento desconhecido' };
  }

  private async handleAuthorizationChange(event: InboundEventView): Promise<EventOutcome> {
    const payload = (event.payload ?? {}) as { changeType?: unknown };
    if (payload.changeType !== 'delete') return { status: 'discard', reason: 'mudanca de autorizacao desconhecida' };
    if (!event.externalAccountId) return { status: 'discard', reason: 'evento sem conta' };
    await this.connections.handleRemoteRevocation(ZEPP_PROVIDER_ID, event.externalAccountId);
    return { status: 'done' };
  }

  private async handleActivityFile(event: InboundEventView): Promise<EventOutcome> {
    const userId = event.userId;
    if (!userId) return { status: 'discard', reason: 'conta desconhecida' };
    const payload = (event.payload ?? {}) as { summaryId?: unknown; callbackURL?: unknown; activityType?: unknown; deviceName?: unknown; startTimeInSeconds?: unknown; activityId?: unknown; manual?: unknown; publishedWorkoutId?: unknown };
    if (typeof payload.summaryId !== 'string' || !isAllowedCallbackUrl(payload.callbackURL)) return { status: 'discard', reason: 'evento de atividade invalido' };
    // "manual" = a pessoa digitou a atividade no aplicativo da Zepp: nao e' execucao objetiva medida pelo relogio.
    if (payload.manual === true) return { status: 'discard', reason: 'atividade manual nao e execucao objetiva' };

    const snapshot = await this.consent.snapshot(ZEPP_PROVIDER_ID, userId);
    if (!snapshot) return { status: 'discard', reason: 'conexao encerrada' };
    if (!snapshot.categories.includes('activity')) return { status: 'discard', reason: 'categoria nao autorizada pelo aluno' };

    const startMs = typeof payload.startTimeInSeconds === 'number' ? payload.startTimeInSeconds * 1000 : null;
    if (startMs !== null && snapshot.collectFrom && startMs < snapshot.collectFrom.getTime()) return { status: 'discard', reason: 'anterior ao periodo autorizado' };

    let token: string;
    try { token = await this.connections.getAccessToken(ZEPP_PROVIDER_ID, userId, 'activity'); }
    catch (error) { return { status: 'retry', reason: `token indisponivel: ${error instanceof Error ? error.message : 'erro'}`.slice(0, 200) }; }

    const downloaded = await this.downloader.download(token, payload.callbackURL as string);
    if (!downloaded.ok) {
      switch (downloaded.kind) {
        case 'expired':
        case 'not_found':
          // O token do link e' de uso unico e vale 24 h: nao ha como baixar de novo por este evento (um novo pedido de historico/backfill reentrega o arquivo).
          this.logger.warn(`FIT Zepp indisponivel (${downloaded.kind}) para o evento ${event.id}; descartado.`);
          return { status: 'discard', reason: `arquivo indisponivel (${downloaded.kind})` };
        case 'forbidden':
        case 'bad_request':
        case 'invalid_url':
        case 'too_large':
          return { status: 'discard', reason: `download recusado (${downloaded.kind})` };
        default:
          return { status: 'retry', reason: `download falhou (${downloaded.kind}${downloaded.httpStatus ? ` ${downloaded.httpStatus}` : ''})` };
      }
    }

    let fit;
    try { fit = await readZeppFit(downloaded.buffer); }
    catch (error) {
      if (error instanceof ZeppFitError) return { status: 'discard', reason: `FIT nao aproveitavel (${error.code})` };
      throw error;
    }
    // O arquivo so' existe em memoria: a partir daqui `downloaded.buffer` nao e' mais usado nem guardado.
    if (snapshot.collectFrom && fit.startedAt.getTime() < snapshot.collectFrom.getTime()) return { status: 'discard', reason: 'anterior ao periodo autorizado' };
    if (fit.startedAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) return { status: 'discard', reason: 'data de inicio no futuro' };

    const result = await this.ingestion.ingest(userId, {
      summaryId: payload.summaryId,
      activityId: typeof payload.activityId === 'string' ? payload.activityId : null,
      activityType: typeof payload.activityType === 'string' ? payload.activityType : null,
      deviceName: typeof payload.deviceName === 'string' ? payload.deviceName : null,
      publishedWorkoutId: typeof payload.publishedWorkoutId === 'string' ? payload.publishedWorkoutId : null,
      source: 'webhook',
    }, fit);
    if (!result.written) return { status: 'discard', reason: 'conexao encerrada ou categoria retirada durante o processamento' };
    return { status: 'done' };
  }
}
