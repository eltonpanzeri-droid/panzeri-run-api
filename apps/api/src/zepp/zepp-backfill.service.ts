import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProviderConnectionService } from '../provider-hub/provider-connection.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { SyncCapability } from '../provider-hub/provider-connector';
import { ZEPP_PROVIDER_ID } from './zepp.connector';

// Backfill inicial (Lote 4): pede a Zepp as atividades dos ULTIMOS 30 DIAS UMA UNICA VEZ por conexao, e SO' se o aluno autorizou a finalidade opcional
// `history_backfill` (consentimento 1.2) e a categoria "Atividades". Documentacao Zepp (Backfill API): GET /wellness-api/rest/backfill/activities com
// summaryStartTimeInSeconds/summaryEndTimeInSeconds (inclusivos, intervalo <= 30 dias = 2.592.000 s); resposta 202 {requestId, status:'ACCEPTED'}; os dados voltam
// de forma ASSINCRONA pelo MESMO webhook (os arquivos entram na mesma fila/pipeline e passam pelo filtro de periodo e de consentimento); limite de 50 pedidos por hora
// por aplicacao (429); evitar pedidos sobrepostos. Por isso: um pedido por conexao (registrado em ProviderConnectionEvent com o requestId), teto interno bem abaixo de
// 50/h, espera apos 429 e nenhum retry imediato. O que a Zepp devolver anterior ao periodo autorizado e' descartado no processamento do evento.
export const ZEPP_BACKFILL_URL = 'https://api-open.zepp.com/wellness-api/rest/backfill/activities';
export const BACKFILL_EVENT = 'backfill_requested';
const MAX_RANGE_SEC = 2_592_000;
const HOURLY_BUDGET = 40; // a Zepp permite 50/h por aplicacao: sobra margem para outros usos
const TIMEOUT_MS = 20_000;

export type BackfillResult =
  | { status: 'requested'; requestId: string | null }
  | { status: 'already_requested' }
  | { status: 'disabled' | 'not_connected' | 'not_authorized' | 'rate_limited' | 'in_progress' }
  | { status: 'failed'; kind: 'auth' | 'forbidden' | 'bad_request' | 'server' | 'network'; httpStatus: number | null };

export type BackfillHttpResult = { ok: true; requestId: string | null } | { ok: false; kind: 'rate_limited' | 'auth' | 'forbidden' | 'bad_request' | 'server' | 'network'; httpStatus: number | null };

@Injectable()
export class ZeppBackfillClient {
  async request(accessToken: string, startSec: number, endSec: number): Promise<BackfillHttpResult> {
    let response: Response;
    try {
      response = await fetch(`${ZEPP_BACKFILL_URL}?summaryStartTimeInSeconds=${startSec}&summaryEndTimeInSeconds=${endSec}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, kind: 'network', httpStatus: null };
    }
    if (response.status === 202) {
      let requestId: string | null = null;
      try { const body = (await response.json()) as { requestId?: unknown }; requestId = typeof body.requestId === 'string' ? body.requestId.slice(0, 80) : null; } catch { requestId = null; }
      return { ok: true, requestId };
    }
    if (response.status === 429) return { ok: false, kind: 'rate_limited', httpStatus: 429 };
    if (response.status === 401) return { ok: false, kind: 'auth', httpStatus: 401 };
    if (response.status === 403) return { ok: false, kind: 'forbidden', httpStatus: 403 };
    if (response.status === 400) return { ok: false, kind: 'bad_request', httpStatus: 400 };
    return { ok: false, kind: 'server', httpStatus: response.status };
  }
}

@Injectable()
export class ZeppBackfillService implements SyncCapability {
  private readonly logger = new Logger(ZeppBackfillService.name);
  private readonly inFlight = new Set<string>();
  private readonly sent: number[] = []; // instantes (ms) dos pedidos da ultima hora, para o teto interno

  constructor(
    private readonly consent: ProviderConsentService,
    private readonly connections: ProviderConnectionService,
    private readonly client: ZeppBackfillClient,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>('ZEPP_BACKFILL_ENABLED')?.trim().toLowerCase() === 'true';
  }

  async request(userId: string, now: Date = new Date()): Promise<BackfillResult> {
    if (!this.isEnabled()) return { status: 'disabled' };
    if (this.inFlight.has(userId)) return { status: 'in_progress' };
    this.inFlight.add(userId);
    try {
      const snapshot = await this.consent.snapshot(ZEPP_PROVIDER_ID, userId);
      if (!snapshot) return { status: 'not_connected' };
      if (!snapshot.purposes.includes('history_backfill') || !snapshot.categories.includes('activity')) return { status: 'not_authorized' };
      if (await this.connections.hasEvent(ZEPP_PROVIDER_ID, userId, BACKFILL_EVENT)) return { status: 'already_requested' };

      const hourAgo = now.getTime() - 3_600_000;
      while (this.sent.length > 0 && this.sent[0] < hourAgo) this.sent.shift();
      if (this.sent.length >= HOURLY_BUDGET) return { status: 'rate_limited' };

      const endSec = Math.floor(now.getTime() / 1000);
      // 30 dias no maximo, e nunca antes do que o aluno autorizou coletar (collectFrom)
      const floor = Math.max(endSec - MAX_RANGE_SEC + 60, snapshot.collectFrom ? Math.floor(snapshot.collectFrom.getTime() / 1000) : 0);
      const startSec = Math.min(floor, endSec - 1);

      let token: string;
      try { token = await this.connections.getAccessToken(ZEPP_PROVIDER_ID, userId, 'activity'); }
      catch { return { status: 'failed', kind: 'auth', httpStatus: null }; }

      this.sent.push(now.getTime());
      const result = await this.client.request(token, startSec, endSec);
      if (!result.ok) {
        if (result.kind === 'rate_limited') return { status: 'rate_limited' };
        this.logger.warn(`Pedido de historico Zepp falhou (${result.kind}).`);
        return { status: 'failed', kind: result.kind, httpStatus: result.httpStatus };
      }
      // Registrado SO' apos a Zepp aceitar (202): garante um unico pedido por conexao e guarda o requestId para suporte.
      await this.connections.recordEvent(ZEPP_PROVIDER_ID, userId, BACKFILL_EVENT, { requestId: result.requestId, startSec, endSec });
      return { status: 'requested', requestId: result.requestId };
    } finally {
      this.inFlight.delete(userId);
    }
  }

  // Contrato generico de sincronizacao ("busca ativa"): aqui equivale a pedir o historico inicial (idempotente).
  async sync(input: { userId: string }): Promise<{ status: 'ok' | 'in_progress' | 'rate_limited' | 'not_connected'; imported?: number }> {
    const result = await this.request(input.userId);
    if (result.status === 'requested' || result.status === 'already_requested') return { status: 'ok' };
    if (result.status === 'rate_limited') return { status: 'rate_limited' };
    if (result.status === 'in_progress') return { status: 'in_progress' };
    return { status: 'not_connected' };
  }

  // A cada 10 minutos, alguns alunos por vez (respeita o teto horario da Zepp): quem conectou com `history_backfill` e ainda nao teve o pedido feito.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async requestPending() {
    if (!this.isEnabled()) return;
    try {
      const userIds = await this.consent.userIdsWithPurpose(ZEPP_PROVIDER_ID, 'history_backfill');
      let handled = 0;
      for (const userId of userIds) {
        if (handled >= 10) break;
        const result = await this.request(userId);
        if (result.status === 'requested') handled += 1;
        if (result.status === 'rate_limited') break;
      }
    } catch (error) {
      this.logger.warn(`Falha ao pedir historico Zepp: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
