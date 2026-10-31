import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkoutDeliveryService } from '../workout-delivery/workout-delivery.service';
import { ProviderConnectionService } from '../provider-hub/provider-connection.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { canonicalModality } from '../activity-execution/canonical-modality';
import { buildCanonicalWorkout, CanonicalWorkout } from '../training-plans/canonical-workout';
import { COROS_PROVIDER_ID } from './coros.connector';
import { CorosMcpClient, CorosMcpError } from './coros-mcp-client';
import { COROS_WORKOUT_TRANSLATOR_VERSION, CorosCourse, translateToCorosCourse } from './coros-workout-spec';

// Publicacao de treinos estruturados no calendario da COROS (30/10/2026): TrainingSession -> CanonicalWorkout -> course -> WorkoutDelivery (provider 'coros_mcp').
// Diferente da Zepp (que recebe uma JANELA de 7 dias republicada todo dia), a COROS recebe UM treino por data (createScheduledWorkout) e depois so' aceita ATUALIZAR esse treino
// (updateScheduledWorkout, pelo idInPlan devolvido na criacao). Ela NAO oferece remover nem mudar de dia (confirmado no catalogo de ferramentas em 30/10/2026). Consequencias, todas honestas:
//  - treino novo => cria uma vez; treino alterado no mesmo dia => atualiza o MESMO treino (nunca cria segundo); sem mudanca => nada e' enviado;
//  - treino que mudou de DIA no programa => cria na data nova e marca o antigo como "retirada pendente" (a aluna o apaga no app da COROS); o mesmo vale para treino removido do programa,
//    para autorizacao retirada e para desconexao: o Panzeri Run NUNCA diz que apagou da COROS;
//  - 'sent' = a COROS ACEITOU o treino; nunca 'delivered_to_device' (a API nao confirma o relogio);
//  - sem rede dentro de transacao de banco; uma operacao por aluna por vez (fila em memoria) e releitura do banco a cada passada.
// Desligado ate COROS_WORKOUT_PUBLISH_ENABLED=true. So' corrida estruturada (sportType 1); musculacao e fortalecimento nao sao enviados (a ferramenta nao aceita forca).
export const COROS_WORKOUT_PROVIDER = 'coros_mcp';
export const WATCH_DELIVERY_PURPOSE = 'watch_delivery';
export const COROS_PUBLISHER_OPTIONS = 'COROS_PUBLISHER_OPTIONS';
export const COROS_WINDOW_DAYS = 7;
const SESSION_DISTANCE_TOLERANCE_KM = 0.06;

export interface CorosPublisherOptions { today?: () => string }

export type SkippedReason = { sessionId: string; reason: string };
type DesiredItem = { sessionId: string; scheduledDate: string; date: string; specHash: string; course: CorosCourse; canonical: CanonicalWorkout; canonicalWarningCodes: string[] };
type ActiveRow = { id: string; trainingSessionId: string; externalWorkoutId: string | null; providerMetadata: unknown };

export type CorosReconcileResult =
  | { status: 'disabled' | 'not_connected' | 'not_authorized' }
  | { status: 'unchanged'; workouts: number; skipped: SkippedReason[] }
  | { status: 'published'; created: number; updated: number; workouts: number; skipped: SkippedReason[]; removalPending: number }
  | { status: 'failed'; kind: string; message: string; created: number; updated: number };

const todayInSaoPauloIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const addDaysIso = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

// O resultado de createScheduledWorkout e' TEXTO em linguagem humana que traz o idInPlan do treino criado (descricao da ferramenta). Tolerante a "idInPlan: X" e JSON.
export function parseIdInPlan(text: string): string | null {
  const match = /idInPlan["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)/i.exec(text);
  return match ? match[1] : null;
}

@Injectable()
export class CorosWorkoutPublisherService {
  private readonly logger = new Logger(CorosWorkoutPublisherService.name);
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly today: () => string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: WorkoutDeliveryService,
    private readonly connections: ProviderConnectionService,
    private readonly consent: ProviderConsentService,
    private readonly client: CorosMcpClient,
    private readonly config: ConfigService,
    @Optional() @Inject(COROS_PUBLISHER_OPTIONS) options?: CorosPublisherOptions,
  ) {
    this.today = options?.today ?? todayInSaoPauloIso;
  }

  isPublishingEnabled(): boolean {
    return this.config.get<string>('COROS_WORKOUT_PUBLISH_ENABLED')?.trim().toLowerCase() === 'true';
  }

  private serialize<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.queues.set(userId, next);
    void next.finally(() => { if (this.queues.get(userId) === next) this.queues.delete(userId); }).catch(() => undefined);
    return next;
  }

  reconcile(userId: string): Promise<CorosReconcileResult> {
    return this.serialize(userId, () => this.reconcileNow(userId));
  }

  async status(userId: string) {
    const today = this.today();
    const desired = await this.computeDesired(userId, today);
    const active = await this.activeRows(userId, today);
    const connected = await this.consent.isAllowed(COROS_PROVIDER_ID, userId, 'profile');
    const authorized = connected && (await this.consent.isAllowed(COROS_PROVIDER_ID, userId, 'profile', WATCH_DELIVERY_PURPOSE));
    const removal = await this.removalPendingRows(userId, today);
    const stamps = active.map((row) => (row.providerMetadata as { sentToCorosAt?: unknown } | null)?.sentToCorosAt).filter((v): v is string => typeof v === 'string').sort();
    const bySession = new Map(active.map((row) => [row.trainingSessionId, row]));
    return {
      publishingEnabled: this.isPublishingEnabled(),
      connected,
      watchDeliveryAuthorized: authorized,
      window: { startDate: today, endDate: addDaysIso(today, COROS_WINDOW_DAYS - 1) },
      eligible: desired.items.length,
      skipped: desired.skipped,
      // "aceito pela COROS" = a API aceitou o treino; NAO significa que o relogio ja' recebeu (a aluna precisa sincronizar o relogio no app da COROS).
      acceptedByCoros: active.length,
      lastAcceptedAt: stamps.length > 0 ? stamps[stamps.length - 1] : null,
      inSync: desired.items.length === active.length && desired.items.every((item) => this.matches(item, bySession.get(item.sessionId))),
      // treinos que ficaram no calendario da COROS e que o Panzeri Run nao consegue apagar (mudaram de dia, foram removidos ou a autorizacao foi retirada)
      removalPending: removal,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------

  private async reconcileNow(userId: string): Promise<CorosReconcileResult> {
    if (!this.isPublishingEnabled()) return { status: 'disabled' };
    const today = this.today();
    const connected = await this.consent.isAllowed(COROS_PROVIDER_ID, userId, 'profile');
    if (!connected) { await this.retireAllActive(userId, 'conta_desconectada'); return { status: 'not_connected' }; }
    const authorized = await this.consent.isAllowed(COROS_PROVIDER_ID, userId, 'profile', WATCH_DELIVERY_PURPOSE);
    if (!authorized) { await this.retireAllActive(userId, 'autorizacao_retirada'); return { status: 'not_authorized' }; }

    const desired = await this.computeDesired(userId, today);
    const active = await this.activeRows(userId, today);
    const activeBySession = new Map(active.map((row) => [row.trainingSessionId, row]));
    const toSend = desired.items.filter((item) => !this.matches(item, activeBySession.get(item.sessionId)));

    // linhas ativas cujo treino saiu do programa (removido, nao mais traduzivel, outro dia): ficam no calendario da COROS e viram "retirada pendente". Treino JA' REALIZADO nao conta.
    const stillDesired = new Set(desired.items.map((item) => item.sessionId));
    const doneSessions = new Set(desired.skipped.filter((s) => s.reason === 'sessao_ja_realizada').map((s) => s.sessionId));
    for (const row of active) {
      if (stillDesired.has(row.trainingSessionId) || doneSessions.has(row.trainingSessionId)) continue;
      await this.markRemovalPending(row.id, 'treino_saiu_do_programa');
    }

    if (toSend.length === 0) return { status: 'unchanged', workouts: desired.items.length, skipped: desired.skipped };
    let token: string;
    try { token = await this.connections.getAccessToken(COROS_PROVIDER_ID, userId, 'profile'); }
    catch (error) { return { status: 'failed', kind: 'token', message: (error as Error).message, created: 0, updated: 0 }; }

    let created = 0;
    let updated = 0;
    for (const item of toSend) {
      const previous = activeBySession.get(item.sessionId);
      const previousDate = (previous?.providerMetadata as { scheduledDate?: string } | null)?.scheduledDate;
      const sameDay = previous && previousDate === item.scheduledDate;
      const idInPlan = sameDay ? previous.externalWorkoutId : null;
      const operation: 'create' | 'update' = sameDay && idInPlan ? 'update' : 'create';
      const row = await this.deliveries.recordAttempt({
        trainingSessionId: item.sessionId,
        provider: COROS_WORKOUT_PROVIDER,
        canonicalWorkout: item.canonical as unknown as Prisma.InputJsonValue,
        externalWorkoutId: idInPlan ?? undefined,
        providerMetadata: { channel: 'coros_mcp', scheduledDate: item.scheduledDate, specHash: item.specHash, translatorVersion: COROS_WORKOUT_TRANSLATOR_VERSION, operation, course: item.course, canonicalWarningCodes: item.canonicalWarningCodes } as unknown as Prisma.InputJsonValue,
      });
      try {
        const text = operation === 'update'
          ? await this.client.callTool(token, 'updateScheduledWorkout', { date: item.date, idInPlan, course: item.course })
          : await this.client.callTool(token, 'createScheduledWorkout', { date: item.date, course: item.course });
        const newId = operation === 'update' ? idInPlan : parseIdInPlan(text);
        await this.deliveries.markSent(row.id, { externalWorkoutId: newId });
        await this.stamp(row.id, { sentToCorosAt: new Date().toISOString(), ...(newId ? {} : { idInPlanMissing: true }) });
        if (previous) {
          // mesmo dia (atualizado): a linha antiga so' deixa de ser a vigente; outro dia: o treino antigo continua na COROS => retirada pendente
          if (operation === 'update') await this.deliveries.markCanceled(previous.id).catch(() => undefined);
          else await this.markRemovalPending(previous.id, 'mudou_de_dia');
        }
        if (operation === 'update') updated += 1; else created += 1;
      } catch (error) {
        const kind = error instanceof CorosMcpError ? error.kind : 'erro';
        const message = (error instanceof Error ? error.message : 'falha').slice(0, 300);
        await this.deliveries.markFailed(row.id, `${kind}: ${message}`).catch(() => undefined);
        this.logger.warn(`Envio de treino a COROS falhou (${kind}) para um aluno.`);
        // autenticacao, limite e rede interrompem a rodada; recusa de UM treino (ex.: data fora do aceito) nao impede os demais
        if (!(error instanceof CorosMcpError) || error.kind !== 'tool_error') return { status: 'failed', kind, message, created, updated };
      }
    }
    return { status: 'published', created, updated, workouts: desired.items.length, skipped: desired.skipped, removalPending: (await this.removalPendingRows(userId, today)).length };
  }

  private async stamp(deliveryId: string, extra: Record<string, unknown>) {
    try {
      const row = await this.prisma.workoutDelivery.findUnique({ where: { id: deliveryId }, select: { providerMetadata: true } });
      const metadata = (row?.providerMetadata && typeof row.providerMetadata === 'object' ? row.providerMetadata : {}) as Record<string, unknown>;
      await this.prisma.workoutDelivery.update({ where: { id: deliveryId }, data: { providerMetadata: { ...metadata, ...extra } as unknown as Prisma.InputJsonValue } });
    } catch (error) {
      this.logger.warn(`Nao consegui registrar o carimbo do treino COROS (entrega ${deliveryId}): ${(error as Error).message}`);
    }
  }

  // Marca como "retirada pendente": a entrega deixa de contar como ativa (status canceled), mas o registro guarda que o treino AINDA esta no calendario da COROS.
  private async markRemovalPending(deliveryId: string, reason: string) {
    await this.stamp(deliveryId, { removalPending: true, removalReason: reason, removalPendingAt: new Date().toISOString() });
    await this.deliveries.markCanceled(deliveryId).catch(() => undefined);
  }

  private async retireAllActive(userId: string, reason: string) {
    const rows = await this.prisma.workoutDelivery.findMany({ where: { provider: COROS_WORKOUT_PROVIDER, status: { in: ['pending', 'sent'] }, trainingSession: { userId } }, select: { id: true, status: true, externalWorkoutId: true } });
    for (const row of rows) {
      if (row.status === 'sent' && row.externalWorkoutId) await this.markRemovalPending(row.id, reason);
      else await this.deliveries.markCanceled(row.id).catch(() => undefined);
    }
  }

  private async activeRows(userId: string, today: string): Promise<ActiveRow[]> {
    const rows = await this.prisma.workoutDelivery.findMany({
      where: { provider: COROS_WORKOUT_PROVIDER, status: 'sent', trainingSession: { userId } },
      orderBy: { requestedAt: 'desc' },
      select: { id: true, trainingSessionId: true, externalWorkoutId: true, providerMetadata: true },
    });
    const latestBySession = new Map<string, ActiveRow>();
    for (const row of rows) if (!latestBySession.has(row.trainingSessionId)) latestBySession.set(row.trainingSessionId, row);
    return [...latestBySession.values()].filter((row) => {
      const date = (row.providerMetadata as { scheduledDate?: string } | null)?.scheduledDate;
      return typeof date === 'string' && date >= today;
    });
  }

  private async removalPendingRows(userId: string, today: string) {
    const rows = await this.prisma.workoutDelivery.findMany({ where: { provider: COROS_WORKOUT_PROVIDER, status: 'canceled', trainingSession: { userId } }, select: { id: true, providerMetadata: true } });
    return rows
      .map((row) => row.providerMetadata as { removalPending?: boolean; scheduledDate?: string; removalReason?: string } | null)
      .filter((meta): meta is { removalPending: true; scheduledDate: string; removalReason?: string } => meta?.removalPending === true && typeof meta.scheduledDate === 'string' && meta.scheduledDate >= today)
      .map((meta) => ({ date: meta.scheduledDate, reason: meta.removalReason ?? null }));
  }

  private matches(item: DesiredItem, row: ActiveRow | undefined): boolean {
    if (!row) return false;
    const meta = (row.providerMetadata ?? {}) as { specHash?: string; scheduledDate?: string };
    return meta.specHash === item.specHash && meta.scheduledDate === item.scheduledDate;
  }

  // O que DEVERIA estar no calendario nos proximos 7 dias. Traduz so' o que ja' foi decidido (estrutura da sessao); recusa o que nao tem representacao fiel.
  private async computeDesired(userId: string, today: string): Promise<{ items: DesiredItem[]; skipped: SkippedReason[] }> {
    const endDate = addDaysIso(today, COROS_WINDOW_DAYS - 1);
    const sessions = await this.prisma.trainingSession.findMany({
      where: { userId, scheduledDate: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${endDate}T00:00:00Z`) }, plan: { status: 'active' } },
      orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }],
      include: { completion: { select: { status: true } }, executionLinks: { where: { status: 'active' }, select: { id: true }, take: 1 } },
    });
    const items: DesiredItem[] = [];
    const skipped: SkippedReason[] = [];
    for (const session of sessions) {
      const skip = (reason: string) => skipped.push({ sessionId: session.id, reason });
      const structure = (session.structure && typeof session.structure === 'object' ? session.structure : {}) as { type?: unknown };
      if (session.origin === 'device_extra' || session.origin === 'student_extra' || structure.type === 'extra') { skip('sessao_extra'); continue; }
      if (canonicalModality(session.modality) !== 'corrida') { skip('modalidade_nao_suportada'); continue; }
      if (structure.type !== 'run') { skip('estrutura_nao_suportada'); continue; }
      if (session.completion || session.executionLinks.length > 0) { skip('sessao_ja_realizada'); continue; }
      const canonical = buildCanonicalWorkout({ id: session.id, modality: session.modality, structure: session.structure });
      const scheduledDate = session.scheduledDate.toISOString().slice(0, 10);
      const translation = translateToCorosCourse(canonical, { distanceKm: session.distanceKm, scheduledDate });
      if (!translation.ok) { skip(translation.refusals[0].code); continue; }
      // A distancia gravada na sessao e a da estrutura precisam concordar (senao nao ha prescricao inequivoca).
      const derivedKm = canonical.derived.totalDistanceMeters / 1000;
      if (session.distanceKm != null && derivedKm > 0 && Math.abs(session.distanceKm - derivedKm) > SESSION_DISTANCE_TOLERANCE_KM) { skip('distancia_inconsistente'); continue; }
      items.push({ sessionId: session.id, scheduledDate, date: translation.date, specHash: translation.specHash, course: translation.course, canonical, canonicalWarningCodes: translation.canonicalWarningCodes });
    }
    return { items, skipped };
  }
}
