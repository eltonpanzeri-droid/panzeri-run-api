import { BadGatewayException, ConflictException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionExecutionLinkService } from '../activity-execution/session-execution-link.service';
import { ActivityNotificationService } from '../activity-execution/activity-notification.service';
import { PhysicalActivityIdentityService } from '../activity-execution/physical-activity-identity.service';
import { WahooService } from './wahoo.service';
import {
  asId, extractWahooProviderMetrics, isCompletedSummary, mapWahooActivity, parseWahooStartedAt,
  WahooSummaryPayload, WahooWorkoutPayload,
} from './wahoo-activity-normalizer';

// Leitura de atividades da Wahoo (Etapa 5, 08/10/2026): Cloud API -> RawExternalActivity -> ActivityLog, pelo MESMO caminho
// canonico da Polar (identidade fisica, reconciliacao com o treino prescrito, notificacao). Somente LEITURA: nada e' enviado.
//
// Regras:
//  - So' treinos a partir de collectFrom (conexao menos 7 dias): nunca importa todo o historico do aluno.
//  - A Wahoo NAO compartilha treinos criados por apps de terceiros (so' o gravado por dispositivo/app Wahoo).
//  - Idempotente: upsert por (provider, userId, externalId). Webhook, rotina de seguranca e botao manual sao gatilhos do MESMO sync.
//  - Limites da Cloud API (producao: 200/5 min, 1000/h, 5000/dia): 1 listagem + 1 chamada por treino NOVO, teto de resumos
//    novos por sync e parada imediata em 429 ou quando o cabecalho X-RateLimit-Remaining chega perto de zero.
//  - Falha em parte dos treinos nao confirma o sync (lastSyncCompletedAt) — a proxima rodada retoma os que faltam.
//  - Sem FIT/serie temporal nesta etapa: so' o resumo. (Parser de FIT e' etapa futura.)

const API_BASE = 'https://api.wahooligan.com';
const PER_PAGE = 30;
const MAX_PAGES = 4;
const MAX_NEW_SUMMARIES_PER_SYNC = 25;
const LOOKBACK_DAYS = 7;
const REQUEST_TIMEOUT_MS = 20_000;
const RATE_LIMIT_FLOOR = 3;
export const WAHOO_PAYLOAD_SCHEMA_VERSION = 'wahoo-cloud-v1-workout-and-summary';

export class CollectionRevokedError extends Error {
  constructor() { super('Coleta Wahoo revogada pelo usuario.'); }
}
class RateLimitedError extends Error {}
class ScopeMissingError extends Error {}

export interface WahooSyncResult {
  status: 'synced' | 'no_new_data' | 'in_progress' | 'disconnected' | 'reauthorization_required' | 'rate_limited';
  imported: number;
}

@Injectable()
export class WahooActivityIngestionService {
  private readonly logger = new Logger(WahooActivityIngestionService.name);
  private readonly syncsInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly wahoo: WahooService,
    private readonly sessionExecutionLink: SessionExecutionLinkService,
    private readonly activityNotifications: ActivityNotificationService,
    private readonly physicalIdentity?: PhysicalActivityIdentityService,
  ) {}

  async sync(userId: string): Promise<WahooSyncResult> {
    if (this.syncsInFlight.has(userId)) return { status: 'in_progress', imported: 0 };
    this.syncsInFlight.add(userId);
    try {
      return await this.runSync(userId);
    } catch (error) {
      if (error instanceof CollectionRevokedError) return { status: 'disconnected', imported: 0 };
      if (error instanceof RateLimitedError) return { status: 'rate_limited', imported: 0 };
      if (error instanceof ScopeMissingError) return { status: 'reauthorization_required', imported: 0 };
      // Falha real: registra para diagnostico (so' o tipo do erro e o status HTTP; nunca token, mensagem livre ou dado de treino).
      await this.audit(userId, 'sync_failed', { errorName: error instanceof Error ? error.name : 'unknown', status: error instanceof HttpException ? error.getStatus() : null });
      throw error;
    } finally {
      this.syncsInFlight.delete(userId);
    }
  }

  private async runSync(userId: string): Promise<WahooSyncResult> {
    const connection = await this.prisma.wahooConnection.findUnique({ where: { userId } });
    if (!connection) throw new NotFoundException('Conta Wahoo nao conectada para este usuario.');
    // Fonte canonica de consentimento: disconnectedAt. Vale para sync manual, rotina de seguranca e webhook.
    if (connection.disconnectedAt || !connection.accessTokenEncrypted) {
      throw new ConflictException('Conta Wahoo desconectada. Conecte novamente para sincronizar.');
    }
    // Conexao feita antes da leitura existir (so' user_read): precisa reautorizar; nenhuma chamada e' feita.
    if (!connection.grantedScopes.split(' ').includes('workouts_read')) throw new ScopeMissingError();

    const collectFrom = connection.collectFrom ?? new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    if (!connection.collectFrom) await this.updateConnectionIfActive(userId, { collectFrom });

    const accessToken = await this.wahoo.getAccessToken(userId);
    let imported = 0;
    let seen = 0;
    let newSummaries = 0;
    const failures: string[] = [];
    let reachedOlder = false;

    for (let page = 1; page <= MAX_PAGES && !reachedOlder; page++) {
      const workouts = await this.listWorkouts(accessToken, page);
      if (workouts.length === 0) break;
      for (const workout of workouts) {
        const startedAt = parseWahooStartedAt(workout.starts);
        const externalId = asId(workout.id);
        if (!startedAt || !externalId) continue;
        if (startedAt < collectFrom) { reachedOlder = true; break; } // listagem em ordem decrescente de inicio
        if (startedAt.getTime() > Date.now() + 3_600_000) continue; // treino futuro/agendado nao e' atividade realizada
        seen++;

        const existing = await this.prisma.rawExternalActivity.findUnique({
          where: { provider_userId_externalId: { provider: 'wahoo', userId, externalId } },
          select: { sourceUpdatedAt: true },
        });
        const listedUpdatedAt = typeof workout.updated_at === 'string' ? new Date(workout.updated_at) : null;
        if (existing && (!listedUpdatedAt || Number.isNaN(listedUpdatedAt.getTime()) || (existing.sourceUpdatedAt && existing.sourceUpdatedAt >= listedUpdatedAt))) continue;

        if (newSummaries >= MAX_NEW_SUMMARIES_PER_SYNC) { reachedOlder = true; break; } // o resto fica para a proxima rodada
        newSummaries++;
        try {
          const summary = await this.fetchSummary(accessToken, externalId);
          if (!isCompletedSummary(summary)) continue; // treino agendado ou sem dados ainda
          await this.ingestWorkout(userId, workout, summary as WahooSummaryPayload, externalId);
          imported++;
        } catch (error) {
          if (error instanceof CollectionRevokedError || error instanceof RateLimitedError || error instanceof ScopeMissingError || error instanceof UnauthorizedException) throw error;
          this.logger.error(`Falha ao importar treino Wahoo: ${error instanceof Error ? error.message : String(error)}`);
          failures.push(externalId);
        }
      }
      if (workouts.length < PER_PAGE) break;
    }

    if (failures.length > 0) {
      throw new InternalServerErrorException(`Sincronizacao Wahoo parcial: ${imported} importado(s), ${failures.length} falha(s). Sera retomada automaticamente.`);
    }
    await this.updateConnectionIfActive(userId, { lastSyncCompletedAt: new Date() });
    return { status: imported > 0 ? 'synced' : 'no_new_data', imported };
  }

  // ── rede ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async api(path: string, accessToken: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('Nao foi possivel contatar a Wahoo.');
    }
    if (response.status === 429) throw new RateLimitedError();
    if (response.status === 401) throw new UnauthorizedException('Token Wahoo invalido ou expirado. Reconecte a conta Wahoo.');
    if (response.status === 403) throw new ScopeMissingError();
    // Cabecalho com 3 valores (dia, hora, 5 min): perto de zero em qualquer janela = para antes de levar 429.
    // Cabecalho ausente/vazio NAO e zero: so conta valor realmente informado.
    const remaining = (response.headers.get('x-ratelimit-remaining') ?? '').split(',').map((v) => v.trim()).filter((v) => v !== '').map(Number).filter((v) => Number.isFinite(v));
    if (remaining.length > 0 && Math.min(...remaining) < RATE_LIMIT_FLOOR) throw new RateLimitedError();
    return response;
  }

  private async listWorkouts(accessToken: string, page: number): Promise<WahooWorkoutPayload[]> {
    const response = await this.api(`/v1/workouts?page=${page}&per_page=${PER_PAGE}`, accessToken);
    if (!response.ok) throw new BadGatewayException(`A Wahoo recusou listar treinos (status ${response.status}).`);
    let body: { workouts?: unknown };
    try { body = await response.json() as { workouts?: unknown }; }
    catch { throw new BadGatewayException('Resposta invalida da Wahoo ao listar treinos.'); }
    return Array.isArray(body.workouts) ? body.workouts.filter((w): w is WahooWorkoutPayload => !!w && typeof w === 'object') : [];
  }

  private async fetchSummary(accessToken: string, workoutId: string): Promise<WahooSummaryPayload | null> {
    const response = await this.api(`/v1/workouts/${workoutId}/workout_summary`, accessToken);
    if (response.status === 404 || response.status === 204) return null; // sem resumo (agendado ou ainda nao enviado)
    if (!response.ok) throw new BadGatewayException(`A Wahoo recusou o resumo do treino (status ${response.status}).`);
    try {
      const body = await response.json();
      return body && typeof body === 'object' ? body as WahooSummaryPayload : null;
    } catch { throw new BadGatewayException('Resposta invalida da Wahoo ao buscar o resumo.'); }
  }

  // ── persistencia ────────────────────────────────────────────────────────────────────────────────────────────────

  private async audit(userId: string, type: string, details: Record<string, unknown>) {
    try {
      await this.prisma.providerConnectionEvent.create({ data: { userId, provider: 'wahoo', type, details: details as never } });
    } catch (failure) {
      this.logger.warn(`Auditoria Wahoo nao gravada: ${failure instanceof Error ? failure.message.slice(0, 120) : 'erro'}`);
    }
  }

  private async updateConnectionIfActive(userId: string, data: Prisma.WahooConnectionUpdateManyMutationInput) {
    await this.prisma.wahooConnection.updateMany({ where: { userId, disconnectedAt: null }, data });
  }

  // Toda escrita de dado coletado passa por aqui: a linha da conexao fica travada (FOR SHARE) ate o commit, entao uma
  // desconexao concorrente espera, e uma escrita que comecar depois dela aborta. Rede fica fora da transacao.
  private async writeIfStillAuthorized<T>(userId: string, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "WahooConnection" WHERE "userId" = ${userId} AND "disconnectedAt" IS NULL FOR SHARE`;
      if (active.length === 0) throw new CollectionRevokedError();
      return write(tx);
    });
  }

  private async ingestWorkout(userId: string, workout: WahooWorkoutPayload, summary: WahooSummaryPayload, externalId: string) {
    const canonical = mapWahooActivity(workout, summary);
    if (!canonical) throw new BadGatewayException('Treino Wahoo sem inicio valido.');
    const sourceUpdatedAt = typeof workout.updated_at === 'string' && !Number.isNaN(new Date(workout.updated_at).getTime()) ? new Date(workout.updated_at) : null;
    const fetchedAt = new Date().toISOString();
    const providerMetrics = (extractWahooProviderMetrics(workout, summary) ?? Prisma.JsonNull) as Prisma.InputJsonValue;

    // Raw primeiro, sempre: o payload bruto fica preservado para reprocessamento mesmo se o canonico falhar depois.
    const { activityLog } = await this.writeIfStillAuthorized(userId, async (tx) => {
      const raw = await tx.rawExternalActivity.upsert({
        where: { provider_userId_externalId: { provider: 'wahoo', userId, externalId } },
        create: { userId, provider: 'wahoo', externalId, payload: { workout, summary } as unknown as Prisma.InputJsonValue, payloadSchemaVersion: WAHOO_PAYLOAD_SCHEMA_VERSION, sourceUpdatedAt, ingestionMeta: { endpoint: `/v1/workouts/${externalId}/workout_summary`, fetchedAt } },
        update: { payload: { workout, summary } as unknown as Prisma.InputJsonValue, sourceUpdatedAt, ingestionMeta: { endpoint: `/v1/workouts/${externalId}/workout_summary`, fetchedAt } },
      });
      const log = await tx.activityLog.upsert({
        where: { provider_userId_externalId: { provider: 'wahoo', userId, externalId } },
        create: { userId, provider: 'wahoo', externalId, rawActivityId: raw.id, ...canonical, providerMetrics },
        update: { rawActivityId: raw.id, ...canonical, providerMetrics },
      });
      return { raw, activityLog: log };
    });

    // Daqui em diante e' tudo melhor esforco: o resumo ja esta salvo e correto, e uma falha adiante nunca desfaz isso.
    await this.physicalIdentity?.evaluateSafely(activityLog.id);
    let classification: string | null = null;
    try {
      classification = await this.sessionExecutionLink.classify(activityLog.id);
    } catch (error) {
      this.logger.warn(`Falha ao classificar atividade ${activityLog.id} no motor de reconciliacao: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await this.activityNotifications.notifyReconciliation(userId, activityLog.id, classification);
    } catch (error) {
      this.logger.warn(`Falha ao notificar sincronizacao da atividade ${activityLog.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
